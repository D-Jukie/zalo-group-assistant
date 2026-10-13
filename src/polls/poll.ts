import type { PollDetail } from "zca-js";
import { isRecord, uniqueStrings } from "../utils.js";

export const maxPollQuestionLength = 200;
export const maxPollOptions = 30;
export const maxPollOptionLength = 200;
export const maxPollGroups = 100;
// A deadline has to leave time to vote, and is not set further ahead than this.
export const minPollLifeMs = 60 * 1000;
export const maxPollLifeMs = 365 * 24 * 60 * 60 * 1000;

// What a poll lets its voters do, as Zalo has it.
export type PollSettings = Readonly<{
  allowMultiChoices: boolean;
  allowAddNewOption: boolean;
  hideVotePreview: boolean;
  isAnonymous: boolean;
}>;

// `expiresAt` is the moment the poll closes by itself, in milliseconds; left out for one that stays open.
export type NewPoll = PollSettings & Readonly<{ question: string; options: readonly string[]; expiresAt?: number }>;

// What creating the poll came to in one group. `pollId` is Zalo's id of the poll there.
export type PollGroup = Readonly<{ groupId: string; groupName: string; ok: boolean; error?: string; pollId?: number }>;

// A poll made from the dashboard: one question put to several groups. Zalo keeps a separate poll in
// each group; this is what ties them together, and what their results are read by.
export type StoredPoll = NewPoll & Readonly<{ id: string; createdAt: number; groups: readonly PollGroup[] }>;

export type PollVoter = Readonly<{ userId: string; name: string }>;

// One group's results. Voters are named unless the poll is anonymous, in which case Zalo gives
// only the counts; `notVoted` is then left empty as well, since nobody can be ruled out.
export type PollGroupResults = Readonly<{
  groupId: string;
  groupName: string;
  error?: string;
  closed: boolean;
  anonymous: boolean;
  memberCount: number;
  voterCount: number;
  options: readonly Readonly<{ content: string; votes: number; voters: readonly PollVoter[] }>[];
  notVoted: readonly PollVoter[];
}>;

// Checks a request to create a poll: { question, options, groupIds }, the four switches, and
// optionally expiresAt. `at` is the present moment, which the deadline is measured from.
export function parsePollRequest(body: unknown, at: number): Readonly<{ poll: NewPoll; groupIds: readonly string[] }> | string {
  if (!isRecord(body)) return "Thiếu nội dung bình chọn";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question === "") return "Hãy nhập câu hỏi";
  if (question.length > maxPollQuestionLength) return `Câu hỏi dài tối đa ${maxPollQuestionLength} ký tự`;
  const rawOptions: unknown = body.options;
  if (!Array.isArray(rawOptions) || !rawOptions.every((item): item is string => typeof item === "string")) return "Danh sách lựa chọn không hợp lệ";
  const typed = rawOptions.map((item) => item.trim()).filter((item) => item !== "");
  const options = uniqueStrings(typed);
  if (options.length !== typed.length) return "Các lựa chọn không được trùng nhau";
  if (options.length < 2) return "Hãy nhập ít nhất hai lựa chọn";
  if (options.length > maxPollOptions) return `Tối đa ${maxPollOptions} lựa chọn`;
  if (options.some((option) => option.length > maxPollOptionLength)) return `Mỗi lựa chọn dài tối đa ${maxPollOptionLength} ký tự`;
  const rawGroupIds: unknown = body.groupIds;
  if (!Array.isArray(rawGroupIds) || !rawGroupIds.every((item): item is string => typeof item === "string")) return "Danh sách nhóm không hợp lệ";
  const groupIds = uniqueStrings(rawGroupIds);
  if (groupIds.length === 0) return "Hãy chọn ít nhất một nhóm";
  if (groupIds.length > maxPollGroups) return `Mỗi lần chỉ tạo được cho tối đa ${maxPollGroups} nhóm`;
  const expiresAt: unknown = body.expiresAt ?? undefined;
  if (expiresAt !== undefined) {
    if (typeof expiresAt !== "number" || !Number.isInteger(expiresAt)) return "Thời hạn không hợp lệ";
    if (expiresAt < at + minPollLifeMs) return "Thời hạn phải ở tương lai, ít nhất một phút nữa";
    if (expiresAt > at + maxPollLifeMs) return "Thời hạn xa nhất là một năm nữa";
  }
  return {
    poll: { question, options, allowMultiChoices: body.allowMultiChoices === true, allowAddNewOption: body.allowAddNewOption === true, hideVotePreview: body.hideVotePreview === true, isAnonymous: body.isAnonymous === true, ...(expiresAt === undefined ? {} : { expiresAt }) },
    groupIds,
  };
}

// Puts names to a poll's votes and works out who has not voted. `members` are the group's members
// as far as they could be read; a voter who is not among them (they left, say) is named by their id.
export function pollResults(group: Readonly<{ groupId: string; groupName: string }>, detail: PollDetail, members: readonly PollVoter[]): PollGroupResults {
  const nameOf = new Map(members.map((member) => [member.userId, member.name]));
  const voted = new Set<string>();
  const options = detail.options.map((option) => {
    const voters = (Array.isArray(option.voters) ? option.voters : []).map((userId) => ({ userId, name: nameOf.get(userId) ?? userId }));
    for (const voter of voters) voted.add(voter.userId);
    return { content: option.content, votes: option.votes, voters };
  });
  const anonymous = detail.is_anonymous;
  return {
    ...group,
    closed: detail.closed,
    anonymous,
    memberCount: members.length,
    voterCount: anonymous ? detail.num_vote : voted.size,
    options,
    notVoted: anonymous ? [] : members.filter((member) => !voted.has(member.userId)),
  };
}
