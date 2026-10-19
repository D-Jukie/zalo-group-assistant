import type { AdminGroupView } from "../types.js";

// "owner" and "deputy" are the groups where the bot is trưởng nhóm and phó nhóm; "member" the rest.
export const groupFilters = ["all", "enabled", "owner", "deputy", "member"] as const;

export type GroupFilter = (typeof groupFilters)[number];

export type GroupQuery = Readonly<{ text: string; filter: GroupFilter; page: number; pageSize: number }>;

export type GroupPage = Readonly<{ items: readonly AdminGroupView[]; total: number; page: number; pageSize: number }>;

// Counts for the dashboard, so it does not need the whole group list.
export type GroupSummary = Readonly<{
  total: number;
  botAdmin: number;
  enabled: number;
  // The rest only count groups where the bot is switched on.
  linkGuard: number;
  badWordFilter: number;
  spamGuard: number;
  kicking: number;
}>;

// Zalo group IDs are about 19 digits long, so a short number such as "10" appears inside many of them.
// Text is only treated as (part of) an ID when it is at least this many digits and nothing else.
const minIdSearchLength = 6;

// Lower case without Vietnamese diacritics, so "nhom ban hang" finds "Nhóm bán hàng".
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase();
}

function matchesFilter(group: AdminGroupView, filter: GroupFilter): boolean {
  if (filter === "enabled") return group.botEnabled;
  if (filter === "owner") return group.botRole === "owner";
  if (filter === "deputy") return group.botRole === "admin";
  if (filter === "member") return group.botRole === "member";
  return true;
}

function isKicking(group: AdminGroupView): boolean {
  return group.botIsAdmin
    && ((group.linkGuardEnabled && group.kickRules.link.enabled)
      || (group.badWordFilterEnabled && group.kickRules.badWord.enabled)
      || (group.spamGuardEnabled && group.kickRules.spam.enabled));
}

// One page of the groups whose name contains the text, or whose ID contains it when the text is a
// long enough run of digits, and that pass the filter.
// A page number past the end returns the last page instead of an empty one.
export function searchGroups(groups: readonly AdminGroupView[], query: GroupQuery): GroupPage {
  const needle = fold(query.text.trim());
  const looksLikeId = needle.length >= minIdSearchLength && /^\d+$/u.test(needle);
  const matches = groups.filter((group) => matchesFilter(group, query.filter)
    && (needle.length === 0 || fold(group.name).includes(needle) || (looksLikeId && group.groupId.includes(needle))));
  const pageCount = Math.max(1, Math.ceil(matches.length / query.pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  return {
    items: matches.slice((page - 1) * query.pageSize, page * query.pageSize),
    total: matches.length,
    page,
    pageSize: query.pageSize,
  };
}

export function summarizeGroups(groups: readonly AdminGroupView[]): GroupSummary {
  const enabled = groups.filter((group) => group.botEnabled);
  return {
    total: groups.length,
    botAdmin: groups.filter((group) => group.botIsAdmin).length,
    enabled: enabled.length,
    linkGuard: enabled.filter((group) => group.linkGuardEnabled).length,
    badWordFilter: enabled.filter((group) => group.badWordFilterEnabled).length,
    spamGuard: enabled.filter((group) => group.spamGuardEnabled).length,
    kicking: enabled.filter(isKicking).length,
  };
}
