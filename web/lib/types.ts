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

// Who the bot lets into a group by itself: the applicant must have a picture of their own and an
// account at least this old (0 asks for no minimum).
export type JoinApprovalSettings = { enabled: boolean; requireAvatar: boolean; minAccountAgeDays: number };

// Someone waiting to be let into a group. `reasons` are the criteria they fail; empty when they meet them all.
export type PendingJoinMember = { userId: string; name: string; avatar: string; accountCreatedAt: number | null; reasons: string[] };

// The waiting list of a group, with how much room the group has left.
export type PendingJoinList = { items: PendingJoinMember[]; memberCount: number; maxMembers: number; freeSlots: number; approvalRequired: boolean; botIsAdmin: boolean };

// A request to join that was decided, by the bot's criteria ("auto") or by an admin ("manual").
export type JoinReview = { userId: string; userName: string; decision: "approved" | "rejected"; by: "auto" | "manual"; reasons: string[]; at: number };

export type JoinReviewResult = { userId: string; name: string; ok: boolean; error?: string };

// The commands the bot knows by itself, switched per group. "/random" picks members or a number.
export type GroupCommandSettings = { random: { enabled: boolean; adminOnly: boolean } };

// One group's row on the page that sets the bot's own commands. Only groups with the bot on are listed.
export type GroupCommandRow = { groupId: string; name: string; memberCount: number; commands: GroupCommandSettings };

export type Group = {
  groupId: string;
  name: string;
  // The group's owner (trưởng nhóm).
  creatorId: string;
  memberCount: number;
  // Master switch: while it is off the bot ignores the group completely.
  botEnabled: boolean;
  linkGuardEnabled: boolean;
  badWordFilterEnabled: boolean;
  spamGuardEnabled: boolean;
  spamSettings: SpamSettings;
  joinApproval: JoinApprovalSettings;
  commands: GroupCommandSettings;
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

export const reminderRepeats = ["none", "daily", "weekly", "monthly"] as const;

export type ReminderRepeat = (typeof reminderRepeats)[number];

export const reminderRepeatLabels: Record<ReminderRepeat, string> = { none: "Không lặp lại", daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng" };

// A reminder on a group's Zalo board, whoever created it.
export type GroupReminder = {
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
  accepted: number;
  rejected: number;
  // Whether the bot still has a message of its own to send when this reminder's time comes.
  dueMessage: boolean;
};

export type ReminderList = {
  items: GroupReminder[];
  groupCount: number;
  failed: { groupId: string; groupName: string; error: string }[];
  fetchedAt: number;
};

// A group a reminder can be created in.
export type ReminderGroup = { groupId: string; name: string; memberCount: number };

// A message the bot still has to send when its reminder's time comes. The picture is fetched separately.
export type PendingReminderMessage = {
  id: string;
  groupId: string;
  groupName: string;
  reminderId: string;
  // What the reminder says.
  title: string;
  text: string;
  imageCount: number;
  dueAt: number;
  repeat: ReminderRepeat;
  updatedAt: number;
};

// A row of a group's member list.
export type GroupMember = {
  userId: string;
  name: string;
  avatar: string;
  // When the Zalo account was created; null when Zalo does not say.
  accountCreatedAt: number | null;
  role: "owner" | "admin" | "member";
  isBot: boolean;
  // All-time violations in this group, and how often the bot removed them from it.
  violations: number;
  kicks: number;
};

// One page of a group's members, already searched and sorted by the bot. `complete` is false when
// Zalo only handed over part of a large group's member list.
export type MemberPage = { items: GroupMember[]; total: number; page: number; pageSize: number; memberCount: number; complete: boolean; botRole: "owner" | "admin" | "member" };

// What a bulk action did to one member. `warning` is set when they were removed but not blocked.
export type MemberActionResult = { userId: string; ok: boolean; error?: string; warning?: string };

// What adding one phone number to a group came to.
export type MemberAddition = { phone: string; ok: boolean; userId?: string; name?: string; error?: string };

// Someone a group has blocked from joining again.
export type BlockedMember = { userId: string; name: string; avatar: string };

// What sets off an automatic answer: words a member types, or a command such as "/huongdan".
export type AutoReplyKind = "keyword" | "command";

// How a keyword is compared: the whole message, or whole words anywhere in it.
export type AutoReplyMatch = "exact" | "contains";

// An answer the bot gives by itself. The pictures are fetched separately.
export type AutoReplyRule = {
  id: string;
  kind: AutoReplyKind;
  match: AutoReplyMatch;
  triggers: string[];
  text: string;
  imageCount: number;
  // The groups it answers in; empty for every group the bot is switched on for.
  groupIds: string[];
  // The rule answers at most once in a group in this long.
  cooldownSeconds: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  sentCount: number;
  lastSentAt: number | null;
};

// What a bulk action did to one group.
export type GroupActionResult = { groupId: string; groupName: string; ok: boolean; error?: string };

// `warning` is set when the reminder was created but one of its messages could not be sent or scheduled.
export type ReminderCreateResult = { groupId: string; groupName: string; ok: boolean; error?: string; warning?: string };

// How a message is marked in the group; "normal" is an ordinary one.
export type MessageUrgency = "important" | "urgent";

// What one round of sending came to in one group.
export type SentBatchGroup = { groupId: string; groupName: string; ok: boolean; error?: string; messages: { msgId: string; cliMsgId?: string }[]; recalledAt?: number; recallError?: string };

// One message sent to several groups in one go, kept so that it can be taken back.
export type SentBatch = { id: string; createdAt: number; text: string; imageCount: number; urgency?: MessageUrgency; scheduled: boolean; groups: SentBatchGroup[] };

export type ReminderMember = { userId: string; name: string };

export type ReminderResponses = { accepted: ReminderMember[]; rejected: ReminderMember[] };

// The history of what the bot did by itself and what admins did from the dashboard.
export const activityCategories = ["moderation", "approval", "replies", "messages", "settings", "system"] as const;
export type ActivityCategory = (typeof activityCategories)[number];
export const activityActors = ["bot", "admin"] as const;
export type ActivityActor = (typeof activityActors)[number];

export type ActivityEntry = {
  id: string;
  at: number;
  category: ActivityCategory;
  actor: ActivityActor;
  // What was done, in a few words, with what it was done to in `detail`.
  title: string;
  detail: string;
  ok: boolean;
  // Why it did not work; empty when it did.
  error: string;
  // Empty when the entry is not about one group or one member.
  groupId: string;
  groupName: string;
  userId: string;
  userName: string;
};
