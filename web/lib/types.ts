// Shapes of the bot API's JSON. Kept in step with src/types.ts in the bot.

export type ViolationRule = "link" | "badWord";

export const violationRules: readonly ViolationRule[] = ["link", "badWord"];

export const ruleLabels: Record<ViolationRule, string> = { link: "Link", badWord: "Từ cấm" };

// Kicking belongs to a feature: each rule has its own switch, count and time window.
export type KickRule = { enabled: boolean; count: number; windowSeconds: number };

export type Group = {
  groupId: string;
  name: string;
  memberCount: number;
  // Master switch: while it is off the bot ignores the group completely.
  botEnabled: boolean;
  linkGuardEnabled: boolean;
  badWordFilterEnabled: boolean;
  kickRules: Record<ViolationRule, KickRule>;
  botIsAdmin: boolean;
  updatedAt: number;
};

// One page of the groups table, already searched and filtered by the bot.
export type GroupPage = { items: Group[]; total: number; page: number; pageSize: number };

// Counts across every group, for pages that do not need the list itself.
export type GroupSummary = {
  total: number;
  botAdmin: number;
  enabled: number;
  // The next three only count groups where the bot is switched on.
  linkGuard: number;
  badWordFilter: number;
  kicking: number;
};

export type GroupToggle = "bot" | "links" | "bad-words";

export type BotStatus = {
  userId: string;
  displayName: string;
  avatar: string;
  startedAt: number;
  uptimeSeconds: number;
  connected: boolean;
  connectionChangedAt: number;
  groupMessagesSeen: number;
  violationsHandled: number;
};

export type ViolationMatch = { rule: ViolationRule; detail: string };

export type ViolationMessageStatus = "recorded" | "deleted" | "deleteFailed";

export type ViolationMessage = {
  messageId: string;
  userId: string;
  userName: string;
  matches: ViolationMatch[];
  text: string;
  link: string | null;
  messageType: string;
  status: ViolationMessageStatus;
  at: number;
};

export type RecentViolation = ViolationMessage & { groupId: string; groupName: string };

export type DailyViolations = { date: string } & Record<ViolationRule, number>;

export type Overview = { series: DailyViolations[]; recent: RecentViolation[] };

export type MemberViolations = {
  userId: string;
  userName: string;
  counts: Record<ViolationRule, number>;
  kicks: number;
  lastRule: ViolationRule;
  lastAt: number;
};
