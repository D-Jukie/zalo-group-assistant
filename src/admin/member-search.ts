import type { GroupMember } from "../types.js";

export const memberSorts = ["name", "violations", "newest"] as const;

export type MemberSort = (typeof memberSorts)[number];

export type MemberQuery = Readonly<{ text: string; sort: MemberSort; page: number; pageSize: number }>;

export type MemberPage = Readonly<{ items: readonly GroupMember[]; total: number; page: number; pageSize: number }>;

// Lower case without Vietnamese diacritics, so "nguyen" finds "Nguyễn".
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase();
}

const byName = (left: GroupMember, right: GroupMember): number => (left.name || left.userId).localeCompare(right.name || right.userId, "vi");

const orders: Readonly<Record<MemberSort, (left: GroupMember, right: GroupMember) => number>> = {
  name: byName,
  // Most violations first.
  violations: (left, right) => right.violations - left.violations || right.kicks - left.kicks || byName(left, right),
  // Youngest Zalo account first; accounts whose age is unknown go last.
  newest: (left, right) => (right.accountCreatedAt ?? 0) - (left.accountCreatedAt ?? 0) || byName(left, right),
};

// The owner comes first, then the deputies, then everyone else.
const roleRank: Readonly<Record<GroupMember["role"], number>> = { owner: 0, admin: 1, member: 2 };

// One page of a group's members: those whose name or ID contains the text. The owner and the deputies
// lead the list; within each of those three the members are in the asked order.
// A page number past the end gives the last page.
export function searchMembers(members: readonly GroupMember[], query: MemberQuery): MemberPage {
  const needle = fold(query.text.trim());
  const matching = needle === "" ? [...members] : members.filter((member) => fold(member.name).includes(needle) || member.userId.includes(needle));
  matching.sort((left, right) => roleRank[left.role] - roleRank[right.role] || orders[query.sort](left, right));
  const pageCount = Math.max(1, Math.ceil(matching.length / query.pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  return { items: matching.slice((page - 1) * query.pageSize, page * query.pageSize), total: matching.length, page, pageSize: query.pageSize };
}
