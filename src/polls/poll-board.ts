import type { API } from "zca-js";
import type { AdminGroupView, MemberProfile } from "../types.js";
import { pollResults, type NewPoll, type PollGroup, type PollGroupResults, type StoredPoll } from "./poll.js";

// A pause between two groups, so a poll for many groups is not fired at Zalo all at once.
const pauseBetweenGroupsMs = 300;

type PollApi = Pick<API, "createPoll" | "getPollDetail" | "lockPoll">;

type PollGroups = Readonly<{
  listGroups(): Promise<AdminGroupView[]>;
  listMembers(groupId: string): Promise<Readonly<{ members: readonly MemberProfile[] }>>;
}>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "" && error.message !== "null") return error.message;
  const code: unknown = isCoded(error) ? error.code : undefined;
  return typeof code === "number" || typeof code === "string" ? `Zalo báo lỗi mã ${code}` : "Zalo không cho biết lý do";
}

function isCoded(error: unknown): error is { code: unknown } {
  return typeof error === "object" && error !== null && "code" in error;
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, pauseBetweenGroupsMs));
}

// Zalo's polls ("Bình chọn") for the groups the bot is switched on in: one question put to several
// groups, the votes read back with names, and closing.
export class PollBoard {
  public constructor(private readonly api: PollApi, private readonly groups: PollGroups, private readonly pauseMs = pauseBetweenGroupsMs) {}

  // Creates the poll in each group, one after another. The answer says what happened in each.
  // Zalo takes a poll's deadline as the moment it closes, in milliseconds, and 0 for none.
  public async create(poll: NewPoll, groupIds: readonly string[]): Promise<PollGroup[]> {
    const groups = new Map((await this.groups.listGroups()).filter((group) => group.botEnabled).map((group) => [group.groupId, group]));
    const results: PollGroup[] = [];
    for (const [index, groupId] of groupIds.entries()) {
      const group = groups.get(groupId);
      if (group === undefined) {
        results.push({ groupId, groupName: "", ok: false, error: "Bot không ở trong nhóm này hoặc chưa được bật" });
        continue;
      }
      if (index > 0 && this.pauseMs > 0) await pause();
      try {
        const created = await this.api.createPoll({ question: poll.question, options: [...poll.options], allowMultiChoices: poll.allowMultiChoices, allowAddNewOption: poll.allowAddNewOption, hideVotePreview: poll.hideVotePreview, isAnonymous: poll.isAnonymous, ...(poll.expiresAt === undefined ? {} : { expiredTime: poll.expiresAt }) }, groupId);
        results.push({ groupId, groupName: group.name, ok: true, pollId: created.poll_id });
      } catch (error: unknown) {
        results.push({ groupId, groupName: group.name, ok: false, error: errorMessage(error) });
      }
    }
    return results;
  }

  // The votes in every group the poll was created in, read from Zalo now. A group whose poll or
  // members cannot be read is answered with the reason, and the others still come.
  public async results(poll: StoredPoll): Promise<PollGroupResults[]> {
    const results: PollGroupResults[] = [];
    for (const [index, group] of poll.groups.filter((item) => item.ok && item.pollId !== undefined).entries()) {
      if (index > 0 && this.pauseMs > 0) await pause();
      const identity = { groupId: group.groupId, groupName: group.groupName };
      try {
        const detail = await this.api.getPollDetail(group.pollId ?? 0);
        const { members } = await this.groups.listMembers(group.groupId);
        results.push(pollResults(identity, detail, members.map((member) => ({ userId: member.userId, name: member.name }))));
      } catch (error: unknown) {
        results.push({ ...identity, error: errorMessage(error), closed: false, anonymous: false, memberCount: 0, voterCount: 0, options: [], notVoted: [] });
      }
    }
    return results;
  }

  // Closes the poll in every group, so nobody can vote any more. The answer says what happened in each.
  public async lock(poll: StoredPoll): Promise<Readonly<{ groupId: string; groupName: string; ok: boolean; error?: string }>[]> {
    const results: { groupId: string; groupName: string; ok: boolean; error?: string }[] = [];
    for (const [index, group] of poll.groups.filter((item) => item.ok && item.pollId !== undefined).entries()) {
      if (index > 0 && this.pauseMs > 0) await pause();
      try {
        await this.api.lockPoll(group.pollId ?? 0);
        results.push({ groupId: group.groupId, groupName: group.groupName, ok: true });
      } catch (error: unknown) {
        results.push({ groupId: group.groupId, groupName: group.groupName, ok: false, error: errorMessage(error) });
      }
    }
    return results;
  }
}
