import { ThreadType, type API, type GroupEvent, type Message } from "zca-js";
import { writeLog } from "../logger.js";
import type { Store } from "../storage/store.js";
import type { AdminGroupView, BotStatus, LiveGroupInfo, StoredGroup } from "../types.js";
import { isRecord, now } from "../utils.js";
import { Enforcer } from "./enforcer.js";
import type { BotFeature } from "./feature.js";
import { RecentMessages } from "./recent-messages.js";

export class SimpleBot {
  private readonly groupCache = new Map<string, Readonly<{ info: LiveGroupInfo; expiresAt: number }>>();
  private readonly recentMessages = new RecentMessages();
  private readonly startedAt = now();
  private profile: Readonly<{ displayName: string; avatar: string }> = { displayName: "", avatar: "" };
  private connected = false;
  private connectionChangedAt = now();
  private groupMessagesSeen = 0;
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
    await this.loadProfile();
    await this.syncAllGroups();
    this.registerListeners();
    this.api.listener.start();
  }

  public stop(): void {
    this.api.listener.stop();
  }

  public status(): BotStatus {
    return {
      userId: this.ownId,
      displayName: this.profile.displayName,
      avatar: this.profile.avatar,
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor((now() - this.startedAt) / 1000),
      connected: this.connected,
      connectionChangedAt: this.connectionChangedAt,
      groupMessagesSeen: this.groupMessagesSeen,
      violationsHandled: this.enforcer.handledMessageCount,
    };
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

  // Every group the account is in, as last synced from Zalo (at start-up, on group events and while moderating).
  // Reading the stored copy keeps the dashboard fast; syncAllGroups refreshes it on demand.
  public async listGroups(): Promise<AdminGroupView[]> {
    const groups = await this.store.listGroups();
    return groups
      .map((group) => this.toView(group, this.isGroupAdmin(group, this.ownId)))
      .sort((left, right) => Number(right.botIsAdmin) - Number(left.botIsAdmin) || left.name.localeCompare(right.name));
  }

  // One group with its admin rights checked against Zalo right now.
  public async getGroup(groupId: string): Promise<AdminGroupView | undefined> {
    const info = await this.currentGroup(groupId);
    const group = await this.store.getGroup(groupId);
    if (group === undefined) return undefined;
    return this.toView(group, this.isGroupAdmin(info ?? group, this.ownId));
  }

  private toView(group: StoredGroup, botIsAdmin: boolean): AdminGroupView {
    return {
      groupId: group.groupId,
      name: group.name,
      creatorId: group.creatorId,
      adminIds: group.adminIds,
      memberCount: group.memberCount ?? 0,
      botEnabled: group.botEnabled,
      linkGuardEnabled: group.linkGuardEnabled,
      badWordFilterEnabled: group.badWordFilterEnabled,
      kickRules: group.kickRules,
      botIsAdmin,
      updatedAt: group.updatedAt,
    };
  }

  public async syncGroup(groupId: string): Promise<LiveGroupInfo> {
    const response = await this.api.getGroupInfo(groupId);
    const info = response.gridInfoMap[groupId] as LiveGroupInfo | undefined;
    if (info === undefined) throw new Error(`Không tìm thấy thông tin nhóm ${groupId}`);
    await this.store.upsertGroup(info);
    this.groupCache.set(groupId, { info, expiresAt: now() + 10_000 });
    return info;
  }

  // The name and avatar are only for display, so the bot starts without them if Zalo refuses.
  private async loadProfile(): Promise<void> {
    try {
      const { profile } = await this.api.fetchAccountInfo();
      this.profile = { displayName: profile.displayName || profile.zaloName, avatar: profile.avatar };
    } catch {
      // Keep the empty profile.
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.connectionChangedAt = now();
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

  private isGroupAdmin(info: Readonly<{ creatorId: string; adminIds: readonly string[] }>, userId: string): boolean {
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
    // A group the bot has not been switched on for is ignored entirely: nothing is checked, counted or recorded.
    if (group !== undefined && !group.botEnabled) return;
    const info = await this.currentGroup(groupId);
    if (info === undefined) return;
    group ??= await this.store.getGroup(groupId);
    if (group === undefined || !group.botEnabled) return;
    this.groupMessagesSeen += 1;
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
    this.api.listener.on("connected", () => this.setConnected(true));
    this.api.listener.on("disconnected", () => this.setConnected(false));
    this.api.listener.on("closed", () => this.setConnected(false));
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
