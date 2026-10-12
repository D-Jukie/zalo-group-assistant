import type { GroupInfo } from "zca-js";

export type JsonRecord = Record<string, unknown>;

export type LiveGroupInfo = GroupInfo & Readonly<{ memVerList?: readonly string[] }>;

export type ViolationRule = "link" | "badWord";

export const violationRules: readonly ViolationRule[] = ["link", "badWord"];

// Each feature decides for itself whether breaking its rule can get a member kicked: when enabled,
// a member is removed after `count` violations of that rule within `windowSeconds`.
export type KickRule = Readonly<{ enabled: boolean; count: number; windowSeconds: number }>;

export type KickRules = Readonly<Record<ViolationRule, KickRule>>;

// Kicking is off for every feature until an admin turns it on. The numbers are the starting point
// once they do: link spam comes in bursts, so its window is short; insults are judged over a longer stretch.
export const defaultKickRules: KickRules = {
  link: { enabled: false, count: 3, windowSeconds: 10 },
  badWord: { enabled: false, count: 3, windowSeconds: 10 * 60 },
};

export type StoredGroup = Readonly<{
  groupId: string;
  name: string;
  creatorId: string;
  adminIds: readonly string[];
  memberCount: number | null;
  // Master switch: while it is off the bot ignores the group completely, whatever the rules below say.
  botEnabled: boolean;
  linkGuardEnabled: boolean;
  badWordFilterEnabled: boolean;
  kickRules: KickRules;
  updatedAt: number;
}>;

export type AdminGroupView = Readonly<{
  groupId: string;
  name: string;
  creatorId: string;
  adminIds: readonly string[];
  memberCount: number;
  botEnabled: boolean;
  linkGuardEnabled: boolean;
  badWordFilterEnabled: boolean;
  kickRules: KickRules;
  // Without admin rights the bot cannot delete or kick, so it only records violations.
  botIsAdmin: boolean;
  updatedAt: number;
}>;

// What the admin page shows about the running bot.
export type BotStatus = Readonly<{
  userId: string;
  // Empty when Zalo did not return the profile.
  displayName: string;
  avatar: string;
  startedAt: number;
  uptimeSeconds: number;
  // Whether the message listener is connected to Zalo right now, and since when.
  connected: boolean;
  connectionChangedAt: number;
  // Since the bot started.
  groupMessagesSeen: number;
  violationsHandled: number;
}>;

// The per-group on/off switches.
export type GroupSetting = "botEnabled" | "linkGuardEnabled" | "badWordFilterEnabled";

export type ViolationMatch = Readonly<{ rule: ViolationRule; detail: string }>;

// "recorded" means the bot did not try to delete the message because it has no admin rights in the group.
export type ViolationMessageStatus = "recorded" | "deleted" | "deleteFailed";

// What a member sent when they broke a rule, kept so an admin can review deleted messages.
export type ViolationMessage = Readonly<{
  messageId: string;
  userId: string;
  userName: string;
  matches: readonly ViolationMatch[];
  text: string;
  link: string | null;
  messageType: string;
  status: ViolationMessageStatus;
  at: number;
}>;

// A logged message together with the group it was sent in, for the cross-group activity feed.
export type RecentViolation = ViolationMessage & Readonly<{ groupId: string; groupName: string }>;

// Violating messages per calendar day (server time zone), split by rule.
export type DailyViolations = Readonly<{ date: string } & Record<ViolationRule, number>>;

// One member's all-time record in one group, for the statistics.
export type MemberViolations = Readonly<{
  userId: string;
  userName: string;
  counts: Readonly<Record<ViolationRule, number>>;
  kicks: number;
  lastRule: ViolationRule;
  lastAt: number;
}>;
