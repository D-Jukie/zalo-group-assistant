import { ThreadType, type API, type GroupEvent, type Message } from "zca-js";
import { writeLog } from "../logger.js";
import type { Store } from "../storage/store.js";
import type { AdminGroupView, BotStatus, LiveGroupInfo, StoredGroup } from "../types.js";
import { isRecord, now } from "../utils.js";
import { Enforcer } from "./enforcer.js";
import type { BotFeature } from "./feature.js";
import { RecentMessages } from "./recent-messages.js";

const groupInfoTtlMs = 10_000;
// How long the list of groups the account belongs to is trusted before Zalo is asked again.
const membershipTtlMs = 15_000;
// Zalo returns the details of several groups in one request; this many at a time.
const groupInfoBatchSize = 50;

export class SimpleBot {
  private readonly groupCache = new Map<string, Readonly<{ info: LiveGroupInfo; expiresAt: number }>>();
  private membership: Readonly<{ ids: ReadonlySet<string>; expiresAt: number }> | undefined;
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

  // Re-reads from Zalo which groups the account is in and the details of every one of them.
  public async syncAllGroups(): Promise<void> {
    this.membership = undefined;
    const groupIds = Array.from(await this.memberGroupIds());
    for (let start = 0; start < groupIds.length; start += groupInfoBatchSize) {
      try {
        await this.fetchGroups(groupIds.slice(start, start + groupInfoBatchSize));
      } catch {
        // One failed batch must not stop the rest; those groups keep their stored copy.
      }
    }
  }

  // Whether the account is in the group right now. Settings saved for a group it has since left
  // stay in the database, but nothing may act on them.
  public async isInGroup(groupId: string): Promise<boolean> {
    return (await this.memberGroupIds()).has(groupId);
  }

  public async isBotAdminIn(groupId: string): Promise<boolean> {
    const info = await this.currentGroup(groupId);
    return info !== undefined && this.isBotAdmin(info);
  }

  // Every group the account is in right now. Which groups those are comes from Zalo, so a group
  // the bot has left never shows up; their saved settings and names come from the stored copy,
  // which refreshGroups brings up to date for the groups actually being looked at.
  public async listGroups(): Promise<AdminGroupView[]> {
    const memberIds = await this.memberGroupIds();
    let stored = await this.store.listGroups();
    const known = new Set(stored.map((group) => group.groupId));
    const unknown = Array.from(memberIds).filter((groupId) => !known.has(groupId));
    if (unknown.length > 0) {
      // Groups joined since the last sync have no stored copy yet.
      await this.fetchGroups(unknown);
      stored = await this.store.listGroups();
    }
    return stored
      .filter((group) => memberIds.has(group.groupId))
      .map((group) => this.toView(group, this.isGroupAdmin(group, this.ownId)))
      .sort((left, right) => Number(right.botIsAdmin) - Number(left.botIsAdmin) || left.name.localeCompare(right.name));
  }

  // The given groups with details read from Zalo now (one request for all of them), in the same order.
  // A group Zalo reports the account has left is dropped. If Zalo cannot be reached the stored copies are used.
  public async refreshGroups(groupIds: readonly string[]): Promise<AdminGroupView[]> {
    const stale = groupIds.filter((groupId) => (this.groupCache.get(groupId)?.expiresAt ?? 0) <= now());
    let removed: ReadonlySet<string> = new Set();
    try {
      removed = await this.fetchGroups(stale);
    } catch {
      // Keep going with what is stored.
    }
    const views: AdminGroupView[] = [];
    for (const groupId of groupIds) {
      if (removed.has(groupId)) {
        this.membership = undefined;
        continue;
      }
      const group = await this.store.getGroup(groupId);
      if (group === undefined) continue;
      views.push(this.toView(group, this.isGroupAdmin(this.groupCache.get(groupId)?.info ?? group, this.ownId)));
    }
    return views;
  }

  // One group with its admin rights checked against Zalo right now; undefined once the bot has left it.
  public async getGroup(groupId: string): Promise<AdminGroupView | undefined> {
    if (!await this.isInGroup(groupId)) return undefined;
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
    this.groupCache.set(groupId, { info, expiresAt: now() + groupInfoTtlMs });
    return info;
  }

  private async memberGroupIds(): Promise<ReadonlySet<string>> {
    if (this.membership !== undefined && this.membership.expiresAt > now()) return this.membership.ids;
    const result = await this.api.getAllGroups();
    const ids = new Set(Object.keys(result.gridVerMap));
    this.membership = { ids, expiresAt: now() + membershipTtlMs };
    return ids;
  }

  // Reads the details of many groups in as few requests as possible and saves them.
  // Returns the IDs Zalo says the account is no longer a member of.
  private async fetchGroups(groupIds: readonly string[]): Promise<ReadonlySet<string>> {
    const removed = new Set<string>();
    for (let start = 0; start < groupIds.length; start += groupInfoBatchSize) {
      const response = await this.api.getGroupInfo(groupIds.slice(start, start + groupInfoBatchSize));
      for (const [groupId, info] of Object.entries(response.gridInfoMap)) {
        await this.store.upsertGroup(info);
        this.groupCache.set(groupId, { info, expiresAt: now() + groupInfoTtlMs });
      }
      for (const groupId of response.removedsGroup ?? []) removed.add(groupId);
    }
    return removed;
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
    // The event may be the account joining or leaving a group.
    this.membership = undefined;
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
