import { GroupEventType, ThreadType, type API, type GroupEvent } from "zca-js";
import { noActivity, type ActivityRecorder } from "../activity/activity-log.js";
import { writeLog } from "../logger.js";
import type { StoredGroup } from "../types.js";
import { isRecord } from "../utils.js";
import { welcomeMessage, type Newcomer } from "./welcome.js";

// How long the bot waits after someone joins before it says hello, so that people who come in
// together (an admin approving a whole waiting list, say) are welcomed in one message.
const gatherMs = 4000;

type WelcomeApi = Pick<API, "sendMessage" | "listener">;

type WelcomeStore = Readonly<{ getGroup(groupId: string): Promise<StoredGroup | undefined> }>;

// The people an event says have joined, as far as they can be read from it.
function newcomers(event: GroupEvent): Newcomer[] {
  const data: unknown = event.data;
  const members: unknown = isRecord(data) ? data.updateMembers : undefined;
  if (!Array.isArray(members)) return [];
  return members.flatMap((member: unknown): Newcomer[] => (isRecord(member) && typeof member.id === "string" && member.id !== "" ? [{ userId: member.id, name: typeof member.dName === "string" ? member.dName : "" }] : []));
}

// Welcomes people who join a group, with the words that group's admin wrote. Each group switches it
// on by itself; nothing is said in a group where the bot or the welcome is off.
export class Welcomer {
  // Who is waiting to be welcomed in each group, and the timer that will do it.
  private readonly waiting = new Map<string, Readonly<{ members: Map<string, Newcomer>; timer: NodeJS.Timeout }>>();

  public constructor(
    private readonly api: WelcomeApi,
    private readonly store: WelcomeStore,
    private readonly ownId: string,
    private readonly activity: ActivityRecorder = noActivity,
    private readonly delayMs = gatherMs,
  ) {}

  public start(): void {
    this.api.listener.on("group_event", (event: GroupEvent) => {
      if (event.type === GroupEventType.JOIN) this.noteJoin(event.threadId, newcomers(event));
    });
  }

  public stop(): void {
    for (const entry of this.waiting.values()) clearTimeout(entry.timer);
    this.waiting.clear();
  }

  // Remembers who joined; they are welcomed together once nobody else has joined for a moment.
  public noteJoin(groupId: string, members: readonly Newcomer[]): void {
    // The bot does not welcome itself into a group it was just added to.
    const others = members.filter((member) => member.userId !== this.ownId);
    if (others.length === 0) return;
    const current = this.waiting.get(groupId);
    if (current !== undefined) clearTimeout(current.timer);
    const gathered = current?.members ?? new Map<string, Newcomer>();
    for (const member of others) gathered.set(member.userId, member);
    const timer = setTimeout(() => void this.welcome(groupId), this.delayMs);
    this.waiting.set(groupId, { members: gathered, timer });
  }

  // Says hello to everyone gathered for the group. The settings are read now, so a welcome switched
  // off a moment ago is not sent.
  public async welcome(groupId: string): Promise<void> {
    const entry = this.waiting.get(groupId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.waiting.delete(groupId);
    const members = Array.from(entry.members.values());
    const names = members.map((member) => member.name || member.userId).join(", ");
    try {
      const group = await this.store.getGroup(groupId);
      if (group === undefined || !group.botEnabled || !group.welcome.enabled || group.welcome.text === "") return;
      const [first] = members;
      const record = { category: "messages", actor: "bot", title: "Chào thành viên mới", detail: names, groupId, groupName: group.name, ...(members.length === 1 && first !== undefined ? { userId: first.userId, userName: first.name } : {}) } as const;
      try {
        await this.api.sendMessage(welcomeMessage(group.welcome.text, members, group.name || "nhóm", group.memberCount ?? 0), groupId, ThreadType.Group);
        writeLog("[WELCOME]", "cyan", { group: groupId, members: String(members.length) });
        this.activity.record(record);
      } catch (error: unknown) {
        const reason = error instanceof Error && error.message !== "" && error.message !== "null" ? error.message : "Zalo không cho biết lý do";
        writeLog("[WELCOME FAILED]", "red", { group: groupId, error: reason }, "error");
        this.activity.record({ ...record, ok: false, error: reason });
      }
    } catch (error: unknown) {
      writeLog("[WELCOME FAILED]", "red", { group: groupId, error: error instanceof Error ? error.message : String(error) }, "error");
    }
  }
}
