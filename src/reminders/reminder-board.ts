import { ReminderRepeatMode, ThreadType, type API } from "zca-js";
import type { AdminGroupView, GroupReminder, NewReminder, ReminderCreateResult, ReminderList, ReminderMember, ReminderRepeat, ReminderResponses, ScheduledReminderMessage } from "../types.js";
import { asString, isRecord, now, uniqueStrings } from "../utils.js";
import { nextOccurrence, parseBoardReminder, sortReminders, type BoardReminder } from "./reminder.js";
import { sendGroupMessage } from "./reminder-messenger.js";

// A group's board is read again after this long. Changes the bot hears about (or makes) drop it sooner.
const boardTtlMs = 5 * 60 * 1000;
// How many groups are read from Zalo at the same time.
const readConcurrency = 4;
const boardPageSize = 50;
const maxBoardPages = 5;
// Pause between groups when one reminder goes to many of them, so the account does not post in a burst.
const createPauseMs = 200;
const memberBatchSize = 100;

const repeatModes: Readonly<Record<ReminderRepeat, ReminderRepeatMode>> = {
  none: ReminderRepeatMode.None,
  daily: ReminderRepeatMode.Daily,
  weekly: ReminderRepeatMode.Weekly,
  monthly: ReminderRepeatMode.Monthly,
};

type ReminderApi = Pick<API, "createReminder" | "removeReminder" | "getListReminder" | "getReminderResponses" | "getGroupMembersInfo" | "sendMessage">;

// Where the messages that wait for a reminder's time are kept.
type MessageQueue = Readonly<{
  addReminderMessage(message: Omit<ScheduledReminderMessage, "id">): Promise<void>;
  removeReminderMessages(groupId: string, reminderId: string): Promise<void>;
  listReminderMessageKeys(): Promise<Set<string>>;
}>;

type GroupSource = Readonly<{ ownId: string; listGroups(): Promise<AdminGroupView[]> }>;

// Zalo answers some requests with an error code and no text at all, which reaches here as the message "null".
function hasNoMessage(error: unknown): boolean {
  return error instanceof Error && (error.message === "" || error.message === "null");
}

function errorMessage(error: unknown): string {
  if (!hasNoMessage(error)) return error instanceof Error ? error.message : String(error);
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "number" || typeof code === "string" ? `Zalo báo lỗi mã ${code}` : "Zalo không cho biết lý do";
}

// Zalo's own reminders ("Nhắc hẹn") in the groups the bot is switched on for: reading every group's
// board, creating one reminder in several groups, removing one, and listing who answered.
export class ReminderBoard {
  private readonly boards = new Map<string, Readonly<{ items: readonly BoardReminder[]; expiresAt: number }>>();
  private readonly loading = new Map<string, Promise<readonly BoardReminder[]>>();

  public constructor(
    private readonly api: ReminderApi,
    private readonly groups: GroupSource,
    private readonly queue: MessageQueue,
    private readonly pauseMs = createPauseMs,
  ) {}

  // Call when something happened in a group, so its board is read again next time.
  public forget(groupId: string): void {
    this.boards.delete(groupId);
  }

  // Reminders are only read from and created in groups the bot is switched on for.
  public async listGroups(): Promise<AdminGroupView[]> {
    return (await this.groups.listGroups()).filter((group) => group.botEnabled);
  }

  // Every reminder in every switched-on group. With `refresh` nothing remembered is used.
  public async list(refresh = false): Promise<ReminderList> {
    const groups = await this.listGroups();
    if (refresh) this.boards.clear();
    const items: BoardReminder[] = [];
    const failed: { groupId: string; groupName: string; error: string }[] = [];
    for (let start = 0; start < groups.length; start += readConcurrency) {
      await Promise.all(groups.slice(start, start + readConcurrency).map(async (group) => {
        try {
          // The name is taken from the group as it is now, in case it was renamed since the board was read.
          for (const reminder of await this.board(group)) items.push({ ...reminder, groupName: group.name });
        } catch (error: unknown) {
          failed.push({ groupId: group.groupId, groupName: group.name, error: errorMessage(error) });
        }
      }));
    }
    const at = now();
    const waiting = await this.queue.listReminderMessageKeys();
    const reminders = items.map((item): GroupReminder => ({
      ...item,
      nextTime: nextOccurrence(item.startTime, item.repeat, at),
      dueMessage: waiting.has(`${item.groupId}:${item.reminderId}`),
    }));
    return { items: sortReminders(reminders), groupCount: groups.length, failed, fetchedAt: at };
  }

  // Creates the same reminder in each group, one after another. A group that fails does not stop the rest.
  // The reminder's own messages follow it: one posted at once, one queued for the reminder's time.
  public async create(reminder: NewReminder, groupIds: readonly string[]): Promise<ReminderCreateResult[]> {
    const groups = new Map((await this.listGroups()).map((group) => [group.groupId, group]));
    const results: ReminderCreateResult[] = [];
    for (const [index, groupId] of groupIds.entries()) {
      const group = groups.get(groupId);
      if (group === undefined) {
        results.push({ groupId, groupName: "", ok: false, error: "Bot không ở trong nhóm này hoặc chưa được bật" });
        continue;
      }
      if (index > 0 && this.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
      try {
        const created: unknown = await this.api.createReminder({ title: reminder.title, startTime: reminder.startTime, repeat: repeatModes[reminder.repeat] }, groupId, ThreadType.Group);
        this.forget(groupId);
        const warning = await this.sendMessages(reminder, group, created);
        results.push({ groupId, groupName: group.name, ok: true, ...(warning === undefined ? {} : { warning }) });
      } catch (error: unknown) {
        results.push({ groupId, groupName: group.name, ok: false, error: errorMessage(error) });
      }
    }
    return results;
  }

  public async remove(groupId: string, reminderId: string): Promise<void> {
    await this.api.removeReminder(reminderId, groupId, ThreadType.Group);
    this.forget(groupId);
    await this.queue.removeReminderMessages(groupId, reminderId);
  }

  // Posts and queues the messages of a reminder that was just created. Returns what went wrong, if anything:
  // the reminder itself exists either way.
  private async sendMessages(reminder: NewReminder, group: AdminGroupView, created: unknown): Promise<string | undefined> {
    const problems: string[] = [];
    if (reminder.onCreate !== undefined) {
      try {
        await sendGroupMessage(this.api, group.groupId, reminder.onCreate);
      } catch (error: unknown) {
        problems.push(`Không gửi được tin nhắn khi tạo: ${errorMessage(error)}`);
      }
    }
    if (reminder.onDue !== undefined) {
      try {
        const reminderId = await this.createdReminderId(reminder, group, created);
        if (reminderId === undefined) throw new Error("không tìm thấy nhắc hẹn vừa tạo trên Zalo");
        await this.queue.addReminderMessage({ ...reminder.onDue, groupId: group.groupId, reminderId, title: reminder.title, dueAt: reminder.startTime, startTime: reminder.startTime, repeat: reminder.repeat });
      } catch (error: unknown) {
        problems.push(`Không hẹn được tin nhắn khi đến giờ: ${errorMessage(error)}`);
      }
    }
    return problems.length === 0 ? undefined : problems.join("; ");
  }

  // The ID Zalo gave the new reminder: taken from its answer, or looked up on the group's board when the answer has none.
  private async createdReminderId(reminder: NewReminder, group: AdminGroupView, created: unknown): Promise<string | undefined> {
    const answered = isRecord(created) ? asString(created.id) ?? asString(created.reminderId) ?? asString(created.topicId) : undefined;
    if (answered !== undefined && answered !== "") return answered;
    const board = await this.board(group);
    return board.find((item) => item.createdByBot && item.startTime === reminder.startTime && item.title === reminder.title)?.reminderId;
  }

  // Who answered a reminder. Names come from Zalo; a member whose name cannot be read is listed by ID.
  public async responses(reminderId: string): Promise<ReminderResponses> {
    const response: Partial<Awaited<ReturnType<ReminderApi["getReminderResponses"]>>> = await this.api.getReminderResponses(reminderId);
    const accepted = uniqueStrings(response.acceptMember ?? []);
    const rejected = uniqueStrings(response.rejectMember ?? []);
    const names = await this.memberNames([...accepted, ...rejected]);
    const toMembers = (userIds: readonly string[]): ReminderMember[] => userIds.map((userId) => ({ userId, name: names.get(userId) ?? "" }));
    return { accepted: toMembers(accepted), rejected: toMembers(rejected) };
  }

  private async memberNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    for (let start = 0; start < userIds.length; start += memberBatchSize) {
      try {
        const { profiles } = await this.api.getGroupMembersInfo(userIds.slice(start, start + memberBatchSize));
        // Zalo writes member IDs here with a "_0" suffix.
        for (const [key, profile] of Object.entries(profiles)) names.set((profile.id || key).replace(/_0$/u, ""), profile.displayName || profile.zaloName);
      } catch {
        // The answers are still worth showing without names.
      }
    }
    return names;
  }

  private async board(group: AdminGroupView): Promise<readonly BoardReminder[]> {
    const cached = this.boards.get(group.groupId);
    if (cached !== undefined && cached.expiresAt > now()) return cached.items;
    // Two requests for the same group share one read.
    let loading = this.loading.get(group.groupId);
    if (loading === undefined) {
      loading = this.readBoard(group).finally(() => this.loading.delete(group.groupId));
      this.loading.set(group.groupId, loading);
    }
    return loading;
  }

  private async readBoard(group: AdminGroupView): Promise<readonly BoardReminder[]> {
    const found = new Map<string, BoardReminder>();
    for (let page = 1; page <= maxBoardPages; page += 1) {
      let entries: readonly unknown[];
      try {
        // A group with nothing on its board may come back as no list at all.
        const listed: unknown = await this.api.getListReminder({ page, count: boardPageSize }, group.groupId, ThreadType.Group);
        entries = Array.isArray(listed) ? listed : [];
      } catch (error: unknown) {
        // For a group that has never had a reminder Zalo returns an error without a message instead of an empty list.
        if (!hasNoMessage(error)) throw error;
        entries = [];
      }
      const before = found.size;
      for (const entry of entries) {
        const reminder = parseBoardReminder(entry, group, this.groups.ownId);
        if (reminder !== undefined) found.set(reminder.reminderId, reminder);
      }
      // Stop at a short page, and at a page that only repeats what is already known.
      if (entries.length < boardPageSize || found.size === before) break;
    }
    const items = Array.from(found.values());
    this.boards.set(group.groupId, { items, expiresAt: now() + boardTtlMs });
    return items;
  }
}
