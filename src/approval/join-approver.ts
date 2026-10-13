import { GroupEventType, type API, type GroupEvent } from "zca-js";
import { writeLog } from "../logger.js";
import type { JoinApplicant, JoinReview, JoinReviewResult, LiveGroupInfo, PendingJoinList, StoredGroup } from "../types.js";
import { now } from "../utils.js";
import { failedCriteria, freeSlots, pickApprovals } from "./join-approval.js";

// The waiting lists are also looked at on a timer, in case a request came in while the listener was down.
const sweepIntervalMs = 5 * 60 * 1000;
// Zalo returns the profiles of several accounts in one request; this many at a time.
const profileBatchSize = 100;

// What Zalo answers for each account when a request is decided.
const reviewErrors: Readonly<Record<number, string>> = {
  166: "Bot không đủ quyền duyệt thành viên",
  170: "Không còn trong danh sách chờ",
  178: "Đã ở trong nhóm",
};

type ApproverApi = Pick<API, "getPendingGroupMembers" | "reviewPendingMemberRequest" | "getUserInfo"> & Readonly<{ listener: Pick<API["listener"], "on"> }>;

type Groups = Readonly<{ ownId: string; syncGroup(groupId: string): Promise<LiveGroupInfo>; isInGroup(groupId: string): Promise<boolean> }>;

type ApproverStore = Readonly<{
  getGroup(groupId: string): Promise<StoredGroup | undefined>;
  listGroups(): Promise<StoredGroup[]>;
  logJoinReview(groupId: string, review: Omit<JoinReview, "at">): Promise<void>;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAdmin(info: LiveGroupInfo, userId: string): boolean {
  return info.creatorId === userId || info.adminIds.includes(userId);
}

// Decides the requests to join a group: by itself for the applicants who meet the group's criteria,
// and on an admin's word for the rest. It never lets in more people than the group has room for.
export class JoinApprover {
  private timer: NodeJS.Timeout | undefined;
  private readonly busy = new Set<string>();

  public constructor(
    private readonly api: ApproverApi,
    private readonly groups: Groups,
    private readonly store: ApproverStore,
  ) {}

  // Starts watching for requests, and goes through the waiting lists now and every few minutes.
  public start(): void {
    this.api.listener.on("group_event", (event: GroupEvent) => {
      if (event.type === GroupEventType.JOIN_REQUEST) void this.process(event.threadId);
    });
    void this.sweep();
    this.timer ??= setInterval(() => void this.sweep(), sweepIntervalMs);
  }

  public stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // Everyone waiting to be let into the group, each with the criteria they fail, and how much room is left.
  public async listPending(groupId: string): Promise<PendingJoinList> {
    const [info, group] = await Promise.all([this.groups.syncGroup(groupId), this.store.getGroup(groupId)]);
    const applicants = isAdmin(info, this.groups.ownId) ? await this.applicants(groupId) : [];
    const at = now();
    return {
      items: applicants.map((applicant) => ({ ...applicant, reasons: group === undefined ? [] : failedCriteria(applicant, group.joinApproval, at) })),
      memberCount: info.totalMember,
      maxMembers: info.maxMember,
      freeSlots: freeSlots(info.totalMember, info.maxMember),
      approvalRequired: info.setting.joinAppr === 1,
      botIsAdmin: isAdmin(info, this.groups.ownId),
    };
  }

  // Lets the given applicants in, or turns them away, on an admin's decision.
  public async review(groupId: string, userIds: readonly string[], approve: boolean): Promise<JoinReviewResult[]> {
    const info = await this.groups.syncGroup(groupId);
    if (!isAdmin(info, this.groups.ownId)) throw new Error("Bot phải là trưởng hoặc phó nhóm thì mới duyệt được thành viên");
    const names = new Map((await this.applicants(groupId)).map((applicant) => [applicant.userId, applicant.name]));
    // Approving stops where the group is full; the rest stay in the waiting list.
    const slots = approve ? freeSlots(info.totalMember, info.maxMember) : userIds.length;
    const decided = userIds.slice(0, slots);
    const results = decided.length === 0 ? [] : await this.decide(groupId, decided, approve, "manual", names, []);
    const full = userIds.slice(slots).map((userId): JoinReviewResult => ({ userId, name: names.get(userId) ?? "", ok: false, error: `Nhóm đã đủ ${info.maxMember} thành viên` }));
    return [...results, ...full];
  }

  // Lets in the applicants who meet the group's criteria, while the group has room. Does nothing for a
  // group where the bot is off, the feature is off, or the bot has no admin rights.
  public async process(groupId: string): Promise<void> {
    if (this.busy.has(groupId)) return;
    this.busy.add(groupId);
    try {
      const group = await this.store.getGroup(groupId);
      if (group === undefined || !group.botEnabled || !group.joinApproval.enabled) return;
      if (!await this.groups.isInGroup(groupId)) return;
      const info = await this.groups.syncGroup(groupId);
      if (!isAdmin(info, this.groups.ownId)) return;
      const slots = freeSlots(info.totalMember, info.maxMember);
      if (slots === 0) return;
      const applicants = await this.applicants(groupId);
      const approved = pickApprovals(applicants, group.joinApproval, now(), slots);
      if (approved.length === 0) return;
      const names = new Map(approved.map((applicant) => [applicant.userId, applicant.name]));
      const results = await this.decide(groupId, approved.map((applicant) => applicant.userId), true, "auto", names, []);
      writeLog("[JOIN APPROVED]", "green", { group: groupId, approved: String(results.filter((result) => result.ok).length), waiting: String(applicants.length - approved.length), room: String(slots) });
    } catch (error: unknown) {
      writeLog("[JOIN APPROVAL FAILED]", "red", { group: groupId, error: errorMessage(error) }, "error");
    } finally {
      this.busy.delete(groupId);
    }
  }

  private async sweep(): Promise<void> {
    try {
      for (const group of await this.store.listGroups()) {
        if (group.botEnabled && group.joinApproval.enabled) await this.process(group.groupId);
      }
    } catch (error: unknown) {
      writeLog("[JOIN APPROVAL FAILED]", "red", { error: errorMessage(error) }, "error");
    }
  }

  // The waiting list with what the criteria need to know about each account.
  private async applicants(groupId: string): Promise<JoinApplicant[]> {
    const response = await this.api.getPendingGroupMembers(groupId);
    const waiting: readonly Readonly<{ uid: string; dpn: string; avatar: string }>[] = Array.isArray(response.users) ? response.users : [];
    const createdAt = new Map<string, number>();
    for (let start = 0; start < waiting.length; start += profileBatchSize) {
      try {
        const profiles = await this.api.getUserInfo(waiting.slice(start, start + profileBatchSize).map((user) => user.uid));
        for (const profile of Object.values(profiles.changed_profiles)) {
          // Zalo gives the creation time in seconds.
          if (typeof profile.createdTs === "number" && profile.createdTs > 0) createdAt.set(profile.userId, profile.createdTs * 1000);
        }
      } catch {
        // Without the profiles the ages are simply unknown, and nobody passes an age requirement.
      }
    }
    return waiting.map((user) => ({ userId: user.uid, name: user.dpn, avatar: user.avatar, accountCreatedAt: createdAt.get(user.uid) ?? null }));
  }

  private async decide(groupId: string, userIds: readonly string[], approve: boolean, by: JoinReview["by"], names: ReadonlyMap<string, string>, reasons: readonly string[]): Promise<JoinReviewResult[]> {
    const statuses: Readonly<Record<string, number | undefined>> = await this.api.reviewPendingMemberRequest({ members: [...userIds], isApprove: approve }, groupId);
    // The group has just changed size; its stored details are brought up to date for whoever looks next.
    if (approve) await this.groups.syncGroup(groupId).catch(() => undefined);
    const results: JoinReviewResult[] = [];
    for (const userId of userIds) {
      const status = statuses[userId] ?? 0;
      const name = names.get(userId) ?? "";
      if (status === 0) {
        results.push({ userId, name, ok: true });
        await this.store.logJoinReview(groupId, { userId, userName: name, decision: approve ? "approved" : "rejected", by, reasons: [...reasons] });
      } else {
        results.push({ userId, name, ok: false, error: reviewErrors[status] ?? `Zalo báo lỗi mã ${status}` });
      }
    }
    return results;
  }
}
