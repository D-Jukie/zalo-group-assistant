import type { GroupInfo } from "zca-js";

export type JsonRecord = Record<string, unknown>;

export type LiveGroupInfo = GroupInfo & Readonly<{ memVerList?: readonly string[] }>;

export type ViolationRule = "link" | "badWord" | "spam";

export const violationRules: readonly ViolationRule[] = ["link", "badWord", "spam"];

// "At least `count` times within `windowSeconds`", with a switch.
export type RateRule = Readonly<{ enabled: boolean; count: number; windowSeconds: number }>;

// Each feature decides for itself whether breaking its rule can get a member kicked: when enabled,
// a member is removed after `count` violations of that rule within `windowSeconds`.
export type KickRule = RateRule;

export type KickRules = Readonly<Record<ViolationRule, KickRule>>;

// Kicking is off for every feature until an admin turns it on. The numbers are the starting point
// once they do: link spam comes in bursts, so its window is short; insults are judged over a longer stretch.
export const defaultKickRules: KickRules = {
  link: { enabled: false, count: 3, windowSeconds: 10 },
  badWord: { enabled: false, count: 3, windowSeconds: 10 * 60 },
  spam: { enabled: false, count: 3, windowSeconds: 60 },
};

// What the spam guard looks for in a group. Each check has its own switch.
export type SpamSettings = Readonly<{
  // Any messages at all arriving in a burst from one member.
  flood: RateRule;
  // The same text sent again and again by one member.
  repeat: RateRule;
  // A phone number or bank account in the message.
  contact: Readonly<{ enabled: boolean }>;
}>;

// Contact details are off by default because members share phone numbers for ordinary reasons too.
export const defaultSpamSettings: SpamSettings = {
  flood: { enabled: true, count: 5, windowSeconds: 10 },
  repeat: { enabled: true, count: 3, windowSeconds: 60 },
  contact: { enabled: false },
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
  spamGuardEnabled: boolean;
  spamSettings: SpamSettings;
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
  spamGuardEnabled: boolean;
  spamSettings: SpamSettings;
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
export type GroupSetting = "botEnabled" | "linkGuardEnabled" | "badWordFilterEnabled" | "spamGuardEnabled";

export type ViolationMatch = Readonly<{ rule: ViolationRule; detail: string }>;

// "recorded" means the bot did not try to delete the message because it has no admin rights in the group.
export type ViolationMessageStatus = "recorded" | "deleted" | "deleteFailed";

export const violationMessageStatuses: readonly ViolationMessageStatus[] = ["recorded", "deleted", "deleteFailed"];

// What the violation log can be narrowed down by. Every part is optional.
export type ViolationLogFilter = Readonly<{
  // Found in the sender's name or ID, the message, its link, what it matched, or the group's name.
  text?: string;
  rule?: ViolationRule;
  status?: ViolationMessageStatus;
  // The period the message was sent in, both ends included.
  from?: number;
  to?: number;
}>;

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

// A member of a group as Zalo describes them, before the bot's own records are added.
export type MemberProfile = Readonly<{
  userId: string;
  name: string;
  avatar: string;
  // When the Zalo account was created; null when Zalo does not say.
  accountCreatedAt: number | null;
}>;

// A row of a group's member list.
export type GroupMember = MemberProfile & Readonly<{
  role: "owner" | "admin" | "member";
  isBot: boolean;
  // All-time violations in this group, and how often the bot removed them from it.
  violations: number;
  kicks: number;
}>;

// What removing one member from a group came to. `warning` is set when they were removed but could
// not be blocked from coming back.
export type MemberRemoval = Readonly<{ userId: string; ok: boolean; error?: string; warning?: string }>;

// Someone a group has blocked from joining again.
export type BlockedMember = Readonly<{ userId: string; name: string; avatar: string }>;

export const reminderRepeats = ["none", "daily", "weekly", "monthly"] as const;

export type ReminderRepeat = (typeof reminderRepeats)[number];

// A reminder on a group's Zalo board, whoever created it.
export type GroupReminder = Readonly<{
  reminderId: string;
  groupId: string;
  groupName: string;
  title: string;
  emoji: string;
  startTime: number;
  repeat: ReminderRepeat;
  // When it goes off next; null once a reminder that does not repeat has passed.
  nextTime: number | null;
  creatorId: string;
  createdByBot: boolean;
  createdAt: number;
  // How many members answered "tham gia" and "từ chối".
  accepted: number;
  rejected: number;
  // Whether the bot still has a message of its own to send when this reminder's time comes.
  dueMessage: boolean;
}>;

export type ReminderList = Readonly<{
  items: readonly GroupReminder[];
  // How many groups were read, and the ones whose board Zalo would not return.
  groupCount: number;
  failed: readonly Readonly<{ groupId: string; groupName: string; error: string }>[];
  fetchedAt: number;
}>;

// A picture to send with a message. The kind and size are read from the file itself.
export type MessageImage = Readonly<{ data: Buffer; extension: "jpg" | "png" | "webp"; width: number; height: number }>;

// How many pictures one message may carry. Zalo shows several as one album.
export const maxMessageImages = 6;

// A message the bot posts to a group: text, pictures, or both.
export type ReminderMessage = Readonly<{ text: string; images?: readonly MessageImage[] }>;

export type NewReminder = Readonly<{
  title: string;
  startTime: number;
  repeat: ReminderRepeat;
  // Posted right after the reminder is created.
  onCreate?: ReminderMessage;
  // Posted when the reminder's time comes (every time, for a repeating reminder).
  onDue?: ReminderMessage;
}>;

// A message waiting for its time: that of the reminder it goes with, or, when `reminderId` is empty,
// simply the time it was scheduled for.
export type ScheduledReminderMessage = ReminderMessage & Readonly<{
  id: string;
  groupId: string;
  reminderId: string;
  // What the reminder says, so the waiting message can be told apart without asking Zalo.
  title: string;
  dueAt: number;
  // The reminder's own start and repeat, from which the following times are worked out.
  startTime: number;
  repeat: ReminderRepeat;
}>;

// What happened in one of the groups a reminder was created for.
// A waiting message as the dashboard lists it. The picture itself is fetched separately.
export type PendingReminderMessage = Readonly<{
  id: string;
  groupId: string;
  groupName: string;
  reminderId: string;
  title: string;
  text: string;
  imageCount: number;
  dueAt: number;
  repeat: ReminderRepeat;
  updatedAt: number;
}>;

// A change to a waiting message. `images`, when given, is the whole new list in order: each entry a new
// picture, or `keep` with the position of a picture the message already has. Left out, the pictures stay.
export type ReminderMessageEdit = Readonly<{ text: string; images?: readonly (MessageImage | Readonly<{ keep: number }>)[] }>;

// `warning` is set when the reminder was created but one of its messages could not be sent or scheduled.
export type ReminderCreateResult = Readonly<{ groupId: string; groupName: string; ok: boolean; error?: string; warning?: string }>;

export type ReminderMember = Readonly<{ userId: string; name: string }>;

export type ReminderResponses = Readonly<{ accepted: readonly ReminderMember[]; rejected: readonly ReminderMember[] }>;
