import { ThreadType, type API, type GroupEvent, type Message } from "zca-js";
import { writeLog } from "../logger.js";
import type { Store } from "../storage/store.js";
import { defaultKickRules, type AdminGroupView, type LiveGroupInfo } from "../types.js";
import { isRecord, now } from "../utils.js";
import { Enforcer } from "./enforcer.js";
import type { BotFeature } from "./feature.js";
import { RecentMessages } from "./recent-messages.js";

export class SimpleBot {
  private readonly groupCache = new Map<string, Readonly<{ info: LiveGroupInfo; expiresAt: number }>>();
  private groupListInFlight: Promise<AdminGroupView[]> | undefined;
  private readonly recentMessages = new RecentMessages();
  private readonly enforcer: Enforcer;

  public constructor(
    private readonly api: API,
    private readonly store: Store,
    public readonly ownId: string,
    private readonly features: readonly BotFeature[],
  ) {
    this.enforcer = new Enforcer(api, store);
  }

  public async start(): Promise<void> {
    await this.syncAllGroups();
    this.registerListeners();
    this.api.listener.start();
  }

  public stop(): void {
    this.api.listener.stop();
  }

  public async sendToUser(userId: string, text: string): Promise<void> {
    await this.api.sendMessage(text, userId, ThreadType.User);
  }

  public async findUserIdByPhone(phoneNumber: string): Promise<string> {
    const user = await this.api.findUser(phoneNumber);
    return user.uid;
  }

  public async syncAllGroups(): Promise<void> {
    const result = await this.api.getAllGroups();
    for (const groupId of Object.keys(result.gridVerMap)) {
      try {
        await this.syncGroup(groupId);
      } catch {
        // Ignore groups that are no longer available.
      }
    }
  }

  public async isBotAdminIn(groupId: string): Promise<boolean> {
    const info = await this.currentGroup(groupId);
    return info !== undefined && this.isBotAdmin(info);
  }

  // Every group the account is in; the bot only needs admin rights to delete and kick.
  public async listGroups(): Promise<AdminGroupView[]> {
    // The admin page polls this from every open tab; share one Zalo round trip between overlapping requests.
    this.groupListInFlight ??= this.loadGroups().finally(() => {
      this.groupListInFlight = undefined;
    });
    return this.groupListInFlight;
  }

  private async loadGroups(): Promise<AdminGroupView[]> {
    const result = await this.api.getAllGroups();
    const groups: AdminGroupView[] = [];
    for (const groupId of Object.keys(result.gridVerMap)) {
      try {
        const cached = this.groupCache.get(groupId);
        let info = cached !== undefined && cached.expiresAt > now() ? cached.info : undefined;
        if (info === undefined) {
          const response = await this.api.getGroupInfo(groupId);
          info = response.gridInfoMap[groupId];
          if (info === undefined) continue;
          this.groupCache.set(groupId, { info, expiresAt: now() + 10_000 });
        }
        const stored = await this.store.getGroup(groupId);
        groups.push({
          groupId: info.groupId,
          name: info.name,
          creatorId: info.creatorId,
          adminIds: info.adminIds,
          memberCount: info.totalMember,
          botEnabled: stored?.botEnabled ?? false,
          badWordFilterEnabled: stored?.badWordFilterEnabled ?? false,
          kickEnabled: stored?.kickEnabled ?? false,
          kickRules: stored?.kickRules ?? defaultKickRules,
          botIsAdmin: this.isBotAdmin(info),
          updatedAt: now(),
        });
      } catch {
        // Ignore groups that are no longer available.
      }
    }
    return groups.sort((left, right) => Number(right.botIsAdmin) - Number(left.botIsAdmin) || left.name.localeCompare(right.name));
  }

  public async syncGroup(groupId: string): Promise<LiveGroupInfo> {
    const response = await this.api.getGroupInfo(groupId);
    const info = response.gridInfoMap[groupId] as LiveGroupInfo | undefined;
    if (info === undefined) throw new Error(`Không tìm thấy thông tin nhóm ${groupId}`);
    await this.store.upsertGroup(info);
    this.groupCache.set(groupId, { info, expiresAt: now() + 10_000 });
    return info;
  }

  private async currentGroup(groupId: string): Promise<LiveGroupInfo | undefined> {
    const cached = this.groupCache.get(groupId);
    if (cached !== undefined && cached.expiresAt > now()) return cached.info;
    try {
      return await this.syncGroup(groupId);
    } catch {
      return cached?.info;
    }
  }

  private isGroupAdmin(info: LiveGroupInfo, userId: string): boolean {
    return info.creatorId === userId || info.adminIds.some((adminId) => adminId === userId);
  }

  private isBotAdmin(info: LiveGroupInfo): boolean {
    return this.isGroupAdmin(info, this.ownId);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.type !== ThreadType.Group || message.isSelf) return;
    const groupId = message.threadId;
    const userId = message.data.uidFrom;
    if (this.recentMessages.isDuplicate(groupId, message.data.msgId || message.data.cliMsgId)) return;
    let group = await this.store.getGroup(groupId);
    // Nothing to do in a group with every rule switched off, so skip the Zalo lookup.
    if (group !== undefined && !group.botEnabled && !group.badWordFilterEnabled) return;
    const info = await this.currentGroup(groupId);
    if (info === undefined) return;
    group ??= await this.store.getGroup(groupId);
    if (group === undefined) return;
    const botIsAdmin = this.isBotAdmin(info);
    const context = {
      message,
      groupId,
      userId,
      info,
      group,
      senderIsAdmin: this.isGroupAdmin(info, userId),
      botIsAdmin,
      reportViolation: this.enforcer.forMessage({ message, group, botIsAdmin }),
    };
    await Promise.all(this.features.map(async (feature) => {
      try {
        await feature.onGroupMessage?.(context);
      } catch (error: unknown) {
        // A failing feature must not stop the others.
        writeLog("[FEATURE FAILED]", "red", {
          feature: feature.name,
          group: groupId,
          user: userId,
          error: error instanceof Error ? error.message : String(error),
        }, "error");
      }
    }));
  }

  private registerListeners(): void {
    this.api.listener.on("connected", () => undefined);
    this.api.listener.on("message", (message: Message) => {
      void this.handleMessage(message).catch(() => undefined);
    });
    this.api.listener.on("group_event", (event: GroupEvent) => {
      void this.handleGroupEvent(event).catch(() => undefined);
    });
    this.api.listener.on("error", () => undefined);
  }

  private async handleGroupEvent(event: GroupEvent): Promise<void> {
    this.groupCache.delete(event.threadId);
    const rawData: unknown = (event as { data?: unknown }).data;
    const data = isRecord(rawData) ? rawData : undefined;
    if (data !== undefined) await this.store.patchGroupEvent(event.threadId, data, event.type);
    try {
      await this.syncGroup(event.threadId);
    } catch {
      // Ignore transient group refresh failures.
    }
    if (data !== undefined) await this.store.patchGroupEvent(event.threadId, data, event.type);
  }
}
