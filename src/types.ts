import type { GroupInfo } from "zca-js";

export type JsonRecord = Record<string, unknown>;

export type LiveGroupInfo = GroupInfo & Readonly<{ memVerList?: readonly string[] }>;

export type ViolationRule = "link" | "badWord";

export const violationRules: readonly ViolationRule[] = ["link", "badWord"];

// A member is removed after `count` violations of one rule within `windowSeconds`; count 0 never kicks for that rule.
export type KickRule = Readonly<{ count: number; windowSeconds: number }>;

export type KickRules = Readonly<Record<ViolationRule, KickRule>>;

// What applies once an admin switches kicking on for a group. Link spam comes in bursts, so its
// window is short; insults are judged over a longer stretch.
export const defaultKickRules: KickRules = {
  link: { count: 3, windowSeconds: 10 },
  badWord: { count: 3, windowSeconds: 10 * 60 },
};

export type StoredGroup = Readonly<{
  groupId: string;
  name: string;
  creatorId: string;
  adminIds: readonly string[];
  memberCount: number | null;
  botEnabled: boolean;
  badWordFilterEnabled: boolean;
  // Master switch for kicking; it can only be turned on while the bot is an admin of the group.
  kickEnabled: boolean;
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
  badWordFilterEnabled: boolean;
  kickEnabled: boolean;
  kickRules: KickRules;
  // Without admin rights the bot cannot delete or kick, so it only records violations.
  botIsAdmin: boolean;
  updatedAt: number;
}>;

// The per-group on/off switches.
export type GroupSetting = "botEnabled" | "badWordFilterEnabled" | "kickEnabled";

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

// One member's all-time record in one group, for the statistics.
export type MemberViolations = Readonly<{
  userId: string;
  userName: string;
  counts: Readonly<Record<ViolationRule, number>>;
  kicks: number;
  lastRule: ViolationRule;
  lastAt: number;
}>;
