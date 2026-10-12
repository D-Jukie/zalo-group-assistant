// Shapes of the bot API's JSON. Kept in step with src/types.ts in the bot.

export type ViolationRule = "link" | "badWord" | "spam";

export const violationRules: readonly ViolationRule[] = ["link", "badWord", "spam"];

export const ruleLabels: Record<ViolationRule, string> = { link: "Link", badWord: "Từ cấm", spam: "Spam" };

export function totalViolations(counts: Record<ViolationRule, number>): number {
  return violationRules.reduce((sum, rule) => sum + counts[rule], 0);
}

// "At least count times within windowSeconds", with a switch.
export type RateRule = { enabled: boolean; count: number; windowSeconds: number };

// What the spam guard looks for in a group: bursts of messages, repeated text, contact details.
export type SpamSettings = { flood: RateRule; repeat: RateRule; contact: { enabled: boolean } };

// Kicking belongs to a feature: each rule has its own switch, count and time window.
export type KickRule = RateRule;

export type Group = {
  groupId: string;
  name: string;
  memberCount: number;
  // Master switch: while it is off the bot ignores the group completely.
  botEnabled: boolean;
  linkGuardEnabled: boolean;
  badWordFilterEnabled: boolean;
  spamGuardEnabled: boolean;
  spamSettings: SpamSettings;
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
  // The rest only count groups where the bot is switched on.
  linkGuard: number;
  badWordFilter: number;
  spamGuard: number;
  kicking: number;
};

export type GroupToggle = "bot" | "links" | "bad-words" | "spam";

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
