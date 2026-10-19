import { ThreadType, type API, type GroupEvent, type Message } from "zca-js";
import { noActivity, type ActivityRecorder } from "../activity/activity-log.js";
import { writeLog } from "../logger.js";
import type { Store } from "../storage/store.js";
import type { AdminGroupView, BlockedMember, BotStatus, GroupRole, LiveGroupInfo, MemberAddition, MemberProfile, MemberRemoval, SentMessageRef, StoredGroup } from "../types.js";
import { isRecord, now } from "../utils.js";
import { Enforcer } from "./enforcer.js";
import type { BotFeature } from "./feature.js";
import { OwnMessages } from "./own-messages.js";
import { RecentMessages } from "./recent-messages.js";
import { readInviteLink, readZaloSettings, settingsUpdate, type InviteLink, type ZaloGroupSettings } from "./zalo-settings.js";

const groupInfoTtlMs = 10_000;
// How long the list of groups the account belongs to is trusted before Zalo is asked again.
const membershipTtlMs = 15_000;
// Zalo returns the details of several groups in one request; this many at a time.
const groupInfoBatchSize = 50;
// A group's member profiles are read again after this long.
const memberTtlMs = 5 * 60 * 1000;
// Zalo returns the profiles of several accounts in one request; this many at a time.
const profileBatchSize = 100;
// Zalo lists a group's blocked accounts a page at a time.
const blockedPageSize = 50;
const maxBlockedPages = 20;
// A pause between two look-ups of a phone number, so a list is not fired at Zalo all at once.
const phoneLookupDelayMs = 400;

export class SimpleBot {
  private readonly groupCache = new Map<string, Readonly<{ info: LiveGroupInfo; expiresAt: number }>>();
  private membership: Readonly<{ ids: ReadonlySet<string>; expiresAt: number }> | undefined;
  private readonly memberCache = new Map<string, Readonly<{ members: readonly MemberProfile[]; complete: boolean; expiresAt: number }>>();
  private readonly recentMessages = new RecentMessages();
  private readonly startedAt = now();
  private profile: Readonly<{ displayName: string; avatar: string }> = { displayName: "", avatar: "" };
  private connected = false;
  private connectionChangedAt = now();
  private groupMessagesSeen = 0;
  private readonly enforcer: Enforcer;
  // The ids of what the bot itself sent, as Zalo echoes them.
  public readonly ownMessages = new OwnMessages();

  public constructor(
    private readonly api: API,
    private readonly store: Store,
    public readonly ownId: string,
    private readonly features: readonly BotFeature[],
    private readonly activity: ActivityRecorder = noActivity,
  ) {
    this.enforcer = new Enforcer(api, store, activity);
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

  // Everyone in a group with their name, picture and the date their Zalo account was created.
  // `complete` is false when Zalo only handed over part of a large group's member list.
  // The profiles are remembered for a few minutes; `refresh` reads them again.
  public async listMembers(groupId: string, refresh = false): Promise<Readonly<{ members: readonly MemberProfile[]; complete: boolean }>> {
    const cached = this.memberCache.get(groupId);
    if (!refresh && cached !== undefined && cached.expiresAt > now()) return cached;
    const info = await this.syncGroup(groupId);
    // Zalo lists members as "<id>_<version>".
    // Either list may be missing from what Zalo sends, whatever the declared type says.
    const listed: readonly string[] = info.memVerList ?? (Array.isArray(info.memberIds) ? info.memberIds : []);
    const memberIds = Array.from(new Set(listed.map((item) => item.split("_")[0] ?? "").filter((id) => id !== "")));
    const profiles = new Map<string, MemberProfile>();
    for (let start = 0; start < memberIds.length; start += profileBatchSize) {
      const response = await this.api.getUserInfo(memberIds.slice(start, start + profileBatchSize));
      for (const profile of Object.values(response.changed_profiles)) {
        // Zalo gives the creation time in seconds.
        const created = typeof profile.createdTs === "number" && profile.createdTs > 0 ? profile.createdTs * 1000 : null;
        profiles.set(profile.userId, { userId: profile.userId, name: profile.displayName || profile.zaloName, avatar: profile.avatar, accountCreatedAt: created });
      }
    }
    // A member Zalo returned no profile for is still a member.
    const members = memberIds.map((userId) => profiles.get(userId) ?? { userId, name: "", avatar: "", accountCreatedAt: null });
    const result = { members, complete: memberIds.length >= info.totalMember, expiresAt: now() + memberTtlMs };
    this.memberCache.set(groupId, result);
    return result;
  }

  // Removes members from a group and, with `block`, stops them from joining it again. The account
  // needs admin rights; it cannot remove itself or the owner, and only the owner can remove a deputy.
  // Members that may not be removed are answered with the reason and the rest still go.
  public async removeMembers(groupId: string, userIds: readonly string[], block: boolean): Promise<MemberRemoval[]> {
    const info = await this.syncGroup(groupId);
    if (!this.isBotAdmin(info)) throw new Error("Bot phải là trưởng hoặc phó nhóm thì mới xóa được thành viên khỏi nhóm");
    const botIsOwner = info.creatorId === this.ownId;
    const refusal = (userId: string): string | undefined => {
      if (userId === this.ownId) return "Bot không tự xóa chính mình; dùng “Rời nhóm” ở trang Nhóm";
      if (userId === info.creatorId) return "Không xóa được trưởng nhóm";
      if (!botIsOwner && info.adminIds.includes(userId)) return "Chỉ trưởng nhóm mới xóa được phó nhóm";
      return undefined;
    };
    const allowed = userIds.filter((userId) => refusal(userId) === undefined);
    const rejected = new Set<string>();
    let warning: string | undefined;
    if (allowed.length > 0) {
      for (const userId of (await this.api.removeUserFromGroup(allowed, groupId)).errorMembers) rejected.add(userId);
      const removed = allowed.filter((userId) => !rejected.has(userId));
      if (block && removed.length > 0) {
        try {
          await this.api.addGroupBlockedMember(removed, groupId);
        } catch (error: unknown) {
          warning = `Đã xóa khỏi nhóm nhưng chưa chặn được: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      this.groupCache.delete(groupId);
      this.memberCache.delete(groupId);
    }
    return userIds.map((userId): MemberRemoval => {
      const reason = refusal(userId) ?? (rejected.has(userId) ? "Zalo từ chối xóa thành viên này" : undefined);
      if (reason !== undefined) return { userId, ok: false, error: reason };
      return { userId, ok: true, ...(warning === undefined ? {} : { warning }) };
    });
  }

  // Makes members deputies of the group, or ordinary members again. Only the group's owner can.
  // Members it makes no sense for are answered with the reason and the rest still go.
  public async setDeputies(groupId: string, userIds: readonly string[], deputy: boolean): Promise<MemberRemoval[]> {
    const info = await this.syncGroup(groupId);
    if (info.creatorId !== this.ownId) throw new Error(`Chỉ trưởng nhóm mới ${deputy ? "đặt" : "gỡ"} được phó nhóm; bot không phải trưởng nhóm của nhóm này`);
    const refusal = (userId: string): string | undefined => {
      if (userId === this.ownId) return "Bot đang là trưởng nhóm";
      const isDeputy = info.adminIds.includes(userId);
      if (deputy && isDeputy) return "Đã là phó nhóm";
      if (!deputy && !isDeputy) return "Không phải phó nhóm";
      return undefined;
    };
    const allowed = userIds.filter((userId) => refusal(userId) === undefined);
    if (allowed.length > 0) {
      if (deputy) await this.api.addGroupDeputy(allowed, groupId);
      else await this.api.removeGroupDeputy(allowed, groupId);
      this.groupCache.delete(groupId);
    }
    return userIds.map((userId): MemberRemoval => {
      const reason = refusal(userId);
      return reason === undefined ? { userId, ok: true } : { userId, ok: false, error: reason };
    });
  }

  // Hands the group over to another member. The bot is an ordinary member of it afterwards, and
  // only the new owner can undo this.
  public async transferOwnership(groupId: string, userId: string): Promise<void> {
    const info = await this.syncGroup(groupId);
    if (info.creatorId !== this.ownId) throw new Error("Chỉ trưởng nhóm mới chuyển được quyền trưởng nhóm; bot không phải trưởng nhóm của nhóm này");
    if (userId === this.ownId) throw new Error("Bot đang là trưởng nhóm");
    await this.api.changeGroupOwner(userId, groupId);
    this.groupCache.delete(groupId);
  }

  // Adds the accounts behind some phone numbers to a group. Each number is looked up by itself, with
  // a pause in between; the accounts found are then added in one request. The answer says, number by
  // number, who was added and why the others were not.
  public async addMembersByPhone(groupId: string, phones: readonly string[]): Promise<MemberAddition[]> {
    await this.syncGroup(groupId);
    const present = new Set((await this.listMembers(groupId, true)).members.map((member) => member.userId));
    const found = new Map<string, Readonly<{ userId: string; name: string }>>();
    const problems = new Map<string, string>();
    for (const [index, phone] of phones.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, phoneLookupDelayMs));
      try {
        const user = await this.api.findUser(phone);
        const account = { userId: user.uid, name: user.display_name || user.zalo_name };
        found.set(phone, account);
        if (present.has(account.userId)) problems.set(phone, "Đã ở trong nhóm");
        else if (Array.from(found.entries()).some(([other, item]) => other !== phone && item.userId === account.userId)) problems.set(phone, "Trùng tài khoản với một số khác trong danh sách");
      } catch {
        problems.set(phone, "Không tìm thấy tài khoản Zalo, hoặc tài khoản không cho tìm bằng số điện thoại");
      }
    }
    const adding = phones.filter((phone) => !problems.has(phone)).map((phone) => found.get(phone)?.userId).filter((userId): userId is string => userId !== undefined);
    if (adding.length > 0) {
      const rejected = new Set((await this.api.addUserToGroup(adding, groupId)).errorMembers);
      for (const phone of phones) {
        const account = found.get(phone);
        if (account !== undefined && !problems.has(phone) && rejected.has(account.userId)) problems.set(phone, "Zalo từ chối thêm tài khoản này; họ có thể đã chặn việc được thêm vào nhóm");
      }
      this.groupCache.delete(groupId);
      this.memberCache.delete(groupId);
    }
    return phones.map((phone): MemberAddition => {
      const account = found.get(phone);
      const error = problems.get(phone);
      return { phone, ok: error === undefined, ...(account === undefined ? {} : account), ...(error === undefined ? {} : { error }) };
    });
  }

  // Takes back messages the bot sent to a group. Zalo needs both ids of a message; one whose second
  // id never arrived cannot be taken back. Throws with the reason when not every message went.
  public async recallMessages(groupId: string, messages: readonly SentMessageRef[]): Promise<void> {
    const problems: string[] = [];
    for (const message of messages) {
      const cliMsgId = message.cliMsgId ?? this.ownMessages.clientIdOf(message.msgId);
      if (cliMsgId === undefined) {
        problems.push("thiếu mã tin nhắn do Zalo không gửi lại");
        continue;
      }
      try {
        await this.api.undo({ msgId: message.msgId, cliMsgId }, groupId, ThreadType.Group);
      } catch (error: unknown) {
        problems.push(error instanceof Error && error.message !== "" && error.message !== "null" ? error.message : "Zalo từ chối, có thể đã quá thời gian cho phép thu hồi");
      }
    }
    if (problems.length > 0) throw new Error(Array.from(new Set(problems)).join("; "));
  }

  // Everyone the group has blocked from joining again.
  public async listBlockedMembers(groupId: string): Promise<BlockedMember[]> {
    const blocked: BlockedMember[] = [];
    for (let page = 1; page <= maxBlockedPages; page += 1) {
      const response = await this.api.getGroupBlockedMember({ page, count: blockedPageSize }, groupId);
      const members: readonly Readonly<{ id: string; dName: string; zaloName: string; avatar: string }>[] = Array.isArray(response.blocked_members) ? response.blocked_members : [];
      for (const member of members) blocked.push({ userId: member.id, name: member.dName || member.zaloName, avatar: member.avatar });
      if (response.has_more !== 1 || members.length === 0) break;
    }
    return blocked;
  }

  // Lets blocked accounts join the group again.
  public async unblockMembers(groupId: string, userIds: readonly string[]): Promise<void> {
    await this.api.removeGroupBlockedMember([...userIds], groupId);
  }

  // Takes the account out of a group. The group's owner cannot simply walk away: ownership has to be
  // handed to another member in Zalo first, so that the group still has someone in charge.
  public async leaveGroup(groupId: string): Promise<void> {
    const info = await this.syncGroup(groupId);
    if (info.creatorId === this.ownId) throw new Error("Bot đang là trưởng nhóm; hãy chuyển quyền trưởng nhóm cho người khác trước khi rời");
    await this.api.leaveGroup(groupId);
    this.groupCache.delete(groupId);
    this.membership = undefined;
  }

  // The settings Zalo keeps for the group, read afresh, and whether the bot may change them.
  public async zaloSettings(groupId: string): Promise<Readonly<{ settings: ZaloGroupSettings; canEdit: boolean }>> {
    const info = await this.syncGroup(groupId);
    return { settings: readZaloSettings(info.setting), canEdit: this.isBotAdmin(info) };
  }

  // Changes some of Zalo's settings for the group. The others are read first and sent along unchanged.
  public async updateZaloSettings(groupId: string, change: Partial<ZaloGroupSettings>): Promise<Readonly<{ settings: ZaloGroupSettings; canEdit: boolean }>> {
    const info = await this.syncGroup(groupId);
    if (!this.isBotAdmin(info)) throw new Error("Bot phải là trưởng hoặc phó nhóm thì mới đổi được cài đặt nhóm");
    await this.api.updateGroupSettings(settingsUpdate(info.setting, change), groupId);
    return this.zaloSettings(groupId);
  }

  public async inviteLink(groupId: string): Promise<InviteLink> {
    return readInviteLink(await this.api.getGroupLinkDetail(groupId));
  }

  // Switches the group's invite link on or off. Switching it off makes the link stop working.
  public async setInviteLink(groupId: string, enabled: boolean): Promise<InviteLink> {
    if (enabled) return readInviteLink(await this.api.enableGroupLink(groupId));
    await this.api.disableGroupLink(groupId);
    return { enabled: false };
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
      .map((group) => this.toView(group, this.roleIn(group)))
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
      views.push(this.toView(group, this.roleIn(this.groupCache.get(groupId)?.info ?? group)));
    }
    return views;
  }

  // One group with its admin rights checked against Zalo right now; undefined once the bot has left it.
  public async getGroup(groupId: string): Promise<AdminGroupView | undefined> {
    if (!await this.isInGroup(groupId)) return undefined;
    const info = await this.currentGroup(groupId);
    const group = await this.store.getGroup(groupId);
    if (group === undefined) return undefined;
    return this.toView(group, this.roleIn(info ?? group));
  }

  private toView(group: StoredGroup, botRole: GroupRole): AdminGroupView {
    return {
      groupId: group.groupId,
      name: group.name,
      creatorId: group.creatorId,
      adminIds: group.adminIds,
      memberCount: group.memberCount ?? 0,
      botEnabled: group.botEnabled,
      linkGuardEnabled: group.linkGuardEnabled,
      badWordFilterEnabled: group.badWordFilterEnabled,
      spamGuardEnabled: group.spamGuardEnabled,
      spamSettings: group.spamSettings,
      joinApproval: group.joinApproval,
      commands: group.commands,
      welcome: group.welcome,
      quietHours: group.quietHours,
      kickRules: group.kickRules,
      botIsAdmin: botRole !== "member",
      botRole,
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
    this.activity.record(connected ? { category: "system", actor: "bot", title: "Kết nối Zalo" } : { category: "system", actor: "bot", title: "Mất kết nối Zalo", ok: false });
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

  // The bot's place in the group: owner, deputy or ordinary member.
  private roleIn(info: Readonly<{ creatorId: string; adminIds: readonly string[] }>): GroupRole {
    if (info.creatorId === this.ownId) return "owner";
    return info.adminIds.some((adminId) => adminId === this.ownId) ? "admin" : "member";
  }

  private isGroupAdmin(info: Readonly<{ creatorId: string; adminIds: readonly string[] }>, userId: string): boolean {
    return info.creatorId === userId || info.adminIds.some((adminId) => adminId === userId);
  }

  private isBotAdmin(info: LiveGroupInfo): boolean {
    return this.isGroupAdmin(info, this.ownId);
  }

  private async handleMessage(message: Message): Promise<void> {
    // A message of the bot's own comes back with the id that taking it back needs; nothing else is done with it.
    if (message.isSelf) {
      this.ownMessages.note(String(message.data.msgId), String(message.data.cliMsgId));
      return;
    }
    if (message.type !== ThreadType.Group) return;
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
    // Someone may have joined or left.
    this.memberCache.delete(event.threadId);
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
