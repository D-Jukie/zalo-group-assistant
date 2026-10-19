import { MongoClient, ObjectId, type Binary, type Collection, type Filter, type UpdateFilter } from "mongodb";
import { GroupEventType, type GroupInfo } from "zca-js";
import { defaultGroupCommands, defaultGroupWelcome, type GroupWelcomeSettings, type ActivityEntry, type ActivityFilter, type NewActivity, defaultJoinApproval, defaultKickRules, defaultSpamSettings, violationRules, type AutoReplyDraft, type AutoReplyKind, type GroupCommandSettings, type AutoReplyMatch, type AutoReplyRule, type JoinApprovalSettings, type JoinReview, type DailyViolations, type GroupSetting, type JsonRecord, type KickRule, type KickRules, type MemberViolations, type MessageImage, type PendingReminderMessage, type RecentViolation, type ReminderMessageEdit, type ViolationLogFilter, type ReminderRepeat, type ScheduledReminderMessage, type MessageUrgency, type SentBatch, type SentBatchGroup, type SpamSettings, type StoredGroup, type ViolationMatch, type ViolationMessage, type ViolationMessageStatus, type ViolationRule } from "../types.js";
import type { EncryptedSecret } from "./secret-box.js";
import { asNumber, asString, escapeRegExp, isRecord, now, uniqueStrings } from "../utils.js";
import { maxMessageImagesBytes, totalImageBytes } from "../reminders/reminder.js";
import { searchPattern } from "./search-pattern.js";
import type { StoredPoll } from "../polls/poll.js";

type GroupDocument = {
  _id: string;
  name: string;
  creatorId: string;
  adminIds: string[];
  memberCount: number | null;
  botEnabled: boolean;
  // The rest are missing on groups stored before those features existed.
  linkGuardEnabled?: boolean;
  badWordFilterEnabled?: boolean;
  spamGuardEnabled?: boolean;
  spamSettings?: Partial<SpamSettings>;
  joinApproval?: Partial<JoinApprovalSettings>;
  commands?: Partial<{ random: Partial<GroupCommandSettings["random"]> }>;
  welcome?: Partial<GroupWelcomeSettings>;
  // Rules saved before kicking became a per-feature setting have no `enabled` of their own.
  kickRules?: Partial<Record<ViolationRule, Readonly<{ enabled?: boolean; count: number; windowSeconds: number }>>>;
  // The two older ways of switching kicking on, only read so groups saved by older versions keep their behaviour:
  // a group-wide switch that applied to every rule with a count above 0, and before that a fixed link-spam switch.
  kickEnabled?: boolean;
  linkSpamKickEnabled?: boolean;
  updatedAt: number;
};

type SessionDocument = {
  _id: string;
  expiresAt: Date;
};

// Values are encrypted by the caller; the database never sees the plaintext or the key.
type SecretDocument = EncryptedSecret & {
  _id: string;
  updatedAt: number;
};

type ViolationDocument = {
  groupId: string;
  userId: string;
  userName: string;
  counts: Partial<Record<ViolationRule, number>>;
  kicks: number;
  // Violations before this moment no longer count towards a kick.
  lastKickAt?: number;
  lastRule: ViolationRule;
  lastAt: number;
};

// What the old "kick after 3 links in 10 seconds" switch meant.
const legacyLinkKickRule: KickRule = { enabled: true, count: 3, windowSeconds: 10 };

type ViolationMessageDocument = {
  groupId: string;
  messageId: string;
  userId: string;
  userName: string;
  matches: ViolationMatch[];
  text: string;
  link: string | null;
  messageType: string;
  status: ViolationMessageStatus;
  at: number;
  // Drives the TTL index that removes old entries.
  createdAt: Date;
};

const violationMessageRetentionDays = 90;

// A picture as it sits in the database: MongoDB hands the bytes back as Binary.
type StoredImage = Omit<MessageImage, "data"> & { data: Binary | Buffer };

// A message the bot sends when its time comes.
type ReminderMessageDocument = {
  _id: ObjectId;
  groupId: string;
  reminderId: string;
  // Missing on messages queued before the title was kept.
  title?: string;
  text: string;
  images?: StoredImage[];
  // Messages queued when a message could carry only one picture have it here instead.
  image?: StoredImage;
  dueAt: number;
  startTime: number;
  repeat: ReminderRepeat;
  updatedAt?: number;
  urgency?: MessageUrgency;
  batchId?: string;
};

// How long a round of sending is kept. Zalo stops taking messages back long before this.
const sentBatchRetentionDays = 30;

type SentBatchDocument = Omit<SentBatch, "id" | "groups"> & {
  _id: string;
  groups: SentBatchGroup[];
  // Drives the TTL index.
  savedAt: Date;
};

// A poll made from the dashboard. It is kept until it is removed from the list there.
type PollDocument = Omit<StoredPoll, "id" | "options" | "groups"> & { _id: string; options: string[]; groups: StoredPoll["groups"][number][] };

function toStoredPoll({ _id, ...poll }: PollDocument): StoredPoll {
  return { id: _id, ...poll };
}

function toSentBatch(document: SentBatchDocument): SentBatch {
  return {
    id: document._id,
    createdAt: document.createdAt,
    text: document.text,
    imageCount: document.imageCount,
    ...(document.urgency === undefined ? {} : { urgency: document.urgency }),
    scheduled: document.scheduled,
    groups: document.groups,
  };
}

function toObjectId(id: string): ObjectId | undefined {
  return ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : undefined;
}

function toImage(image: StoredImage): MessageImage {
  return { ...image, data: Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data.buffer) };
}

function storedImages(document: Pick<ReminderMessageDocument, "image" | "images">): StoredImage[] {
  return document.images ?? (document.image === undefined ? [] : [document.image]);
}

// Leaves the bytes of the pictures out of what a query returns.
const withoutImageData = { "image.data": 0, "images.data": 0 } as const;

// An answer the bot gives by itself.
type AutoReplyDocument = {
  _id: ObjectId;
  kind: AutoReplyKind;
  match: AutoReplyMatch;
  triggers: string[];
  text: string;
  images?: StoredImage[];
  groupIds: string[];
  cooldownSeconds: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  sentCount: number;
  lastSentAt: number | null;
};

type JoinReviewDocument = JoinReview & {
  groupId: string;
  // Drives the TTL index that removes old entries.
  createdAt: Date;
};

const joinReviewRetentionDays = 90;

// How long the history of what the bot and its admins did is kept.
const activityRetentionDays = 90;

type ActivityDocument = Required<NewActivity> & {
  _id: ObjectId;
  at: number;
  // Drives the TTL index.
  createdAt: Date;
};

type SettingDocument = {
  _id: string;
  values: string[];
};

export class Store {
  private constructor(
    private readonly client: MongoClient,
    private readonly groups: Collection<GroupDocument>,
    private readonly sessions: Collection<SessionDocument>,
    private readonly secrets: Collection<SecretDocument>,
    private readonly settings: Collection<SettingDocument>,
    private readonly violations: Collection<ViolationDocument>,
    private readonly violationMessages: Collection<ViolationMessageDocument>,
    private readonly reminderMessages: Collection<ReminderMessageDocument>,
    private readonly joinReviews: Collection<JoinReviewDocument>,
    private readonly autoReplies: Collection<AutoReplyDocument>,
    private readonly activity: Collection<ActivityDocument>,
    private readonly sentBatches: Collection<SentBatchDocument>,
    private readonly polls: Collection<PollDocument>,
  ) {}

  public static async open(uri: string, databaseName: string): Promise<Store> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    const database = client.db(databaseName);
    const store = new Store(
      client,
      database.collection<GroupDocument>("groups"),
      database.collection<SessionDocument>("admin_sessions"),
      database.collection<SecretDocument>("secrets"),
      database.collection<SettingDocument>("settings"),
      database.collection<ViolationDocument>("violations"),
      database.collection<ViolationMessageDocument>("violation_messages"),
      database.collection<ReminderMessageDocument>("reminder_messages"),
      database.collection<JoinReviewDocument>("join_reviews"),
      database.collection<AutoReplyDocument>("auto_replies"),
      database.collection<ActivityDocument>("activity_log"),
      database.collection<SentBatchDocument>("sent_batches"),
      database.collection<PollDocument>("polls"),
    );
    // MongoDB removes expired sessions on its own.
    await store.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await store.splitLegacyBotSwitch();
    await store.violations.createIndex({ groupId: 1, userId: 1 }, { unique: true });
    await store.violationMessages.createIndex({ groupId: 1, messageId: 1 }, { unique: true });
    await store.violationMessages.createIndex({ groupId: 1, userId: 1, at: -1 });
    await store.violationMessages.createIndex({ at: -1 });
    await store.violationMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: violationMessageRetentionDays * 24 * 60 * 60 });
    await store.joinReviews.createIndex({ groupId: 1, at: -1 });
    await store.joinReviews.createIndex({ createdAt: 1 }, { expireAfterSeconds: joinReviewRetentionDays * 24 * 60 * 60 });
    await store.activity.createIndex({ at: -1, _id: -1 });
    await store.activity.createIndex({ groupId: 1, at: -1 });
    await store.activity.createIndex({ createdAt: 1 }, { expireAfterSeconds: activityRetentionDays * 24 * 60 * 60 });
    await store.reminderMessages.createIndex({ dueAt: 1 });
    await store.sentBatches.createIndex({ createdAt: -1 });
    await store.polls.createIndex({ createdAt: -1 });
    await store.sentBatches.createIndex({ savedAt: 1 }, { expireAfterSeconds: sentBatchRetentionDays * 24 * 60 * 60 });
    await store.reminderMessages.createIndex({ groupId: 1, reminderId: 1 });
    return store;
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  public async getGroup(groupId: string): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOne({ _id: groupId });
    return document === null ? undefined : this.toGroup(document);
  }

  public async listGroups(): Promise<StoredGroup[]> {
    const documents = await this.groups.find({}).toArray();
    return documents.map((document) => this.toGroup(document));
  }

  public async upsertGroup(info: GroupInfo): Promise<void> {
    await this.groups.updateOne(
      { _id: info.groupId },
      {
        $set: {
          name: info.name,
          creatorId: info.creatorId,
          adminIds: uniqueStrings(info.adminIds),
          memberCount: info.totalMember,
          updatedAt: now(),
        },
        $setOnInsert: { botEnabled: false, linkGuardEnabled: false, badWordFilterEnabled: false, spamGuardEnabled: false },
      },
      { upsert: true },
    );
  }

  public async patchGroupEvent(groupId: string, data: JsonRecord, eventType?: GroupEventType): Promise<void> {
    const fields: Partial<GroupDocument> = { updatedAt: now() };
    const name = asString(data.groupName);
    const creatorId = asString(data.creatorId);
    const memberCount = asNumber(data.totalMembers);
    if (name !== undefined) fields.name = name;
    if (creatorId !== undefined) fields.creatorId = creatorId;
    if (memberCount !== undefined) fields.memberCount = memberCount;
    const updatedAdminIds = Array.isArray(data.updateMembers)
      ? data.updateMembers.flatMap((member: unknown) => isRecord(member) && typeof member.id === "string" ? [member.id] : [])
      : [];
    const update: UpdateFilter<GroupDocument> = { $set: fields };
    if (eventType === GroupEventType.ADD_ADMIN) {
      update.$addToSet = { adminIds: { $each: uniqueStrings(updatedAdminIds) } };
    } else if (eventType === GroupEventType.REMOVE_ADMIN) {
      update.$pull = { adminIds: { $in: updatedAdminIds } };
    }
    await this.groups.updateOne({ _id: groupId }, update);
  }

  public async setGroupSetting(groupId: string, setting: GroupSetting, enabled: boolean): Promise<StoredGroup | undefined> {
    const fields: Partial<GroupDocument> = {};
    fields[setting] = enabled;
    return this.updateGroup(groupId, fields);
  }

  public async setSpamSettings(groupId: string, settings: SpamSettings): Promise<StoredGroup | undefined> {
    return this.updateGroup(groupId, {
      spamSettings: {
        flood: { enabled: settings.flood.enabled, count: settings.flood.count, windowSeconds: settings.flood.windowSeconds },
        repeat: { enabled: settings.repeat.enabled, count: settings.repeat.count, windowSeconds: settings.repeat.windowSeconds },
        contact: { enabled: settings.contact.enabled },
      },
    });
  }

  public async setGroupWelcome(groupId: string, welcome: GroupWelcomeSettings): Promise<StoredGroup | undefined> {
    return this.updateGroup(groupId, { welcome: { enabled: welcome.enabled, text: welcome.text } });
  }

  public async setGroupCommands(groupId: string, commands: GroupCommandSettings): Promise<StoredGroup | undefined> {
    return this.updateGroup(groupId, { commands: { random: { enabled: commands.random.enabled, adminOnly: commands.random.adminOnly } } });
  }

  public async setJoinApproval(groupId: string, settings: JoinApprovalSettings): Promise<StoredGroup | undefined> {
    return this.updateGroup(groupId, { joinApproval: { enabled: settings.enabled, requireAvatar: settings.requireAvatar, minAccountAgeDays: settings.minAccountAgeDays } });
  }

  // Writes one entry into the history of what the bot and its admins did.
  public async addActivity(entry: Required<NewActivity>): Promise<void> {
    const at = now();
    await this.activity.insertOne({ _id: new ObjectId(), ...entry, at, createdAt: new Date(at) });
  }

  // The entries of the history that pass the filter, newest first. `before` continues after the last
  // entry of an earlier page; entries written in the same millisecond are told apart by their ID.
  public async listActivity(limit: number, filter: ActivityFilter = {}, before?: Readonly<{ at: number; id: string }>): Promise<ActivityEntry[]> {
    const conditions = this.activityConditions(filter);
    const beforeId = before === undefined ? undefined : toObjectId(before.id);
    if (before !== undefined) conditions.push(beforeId === undefined ? { at: { $lt: before.at } } : { $or: [{ at: { $lt: before.at } }, { at: before.at, _id: { $lt: beforeId } }] });
    const documents = await this.activity.find(conditions.length === 0 ? {} : { $and: conditions }).sort({ at: -1, _id: -1 }).limit(limit).toArray();
    return documents.map((document) => ({
      id: document._id.toHexString(),
      at: document.at,
      category: document.category,
      actor: document.actor,
      title: document.title,
      detail: document.detail,
      ok: document.ok,
      error: document.error,
      groupId: document.groupId,
      groupName: document.groupName,
      userId: document.userId,
      userName: document.userName,
    }));
  }

  // How many entries of the history pass the filter.
  public async countActivity(filter: ActivityFilter = {}): Promise<number> {
    const conditions = this.activityConditions(filter);
    return this.activity.countDocuments(conditions.length === 0 ? {} : { $and: conditions });
  }

  private activityConditions(filter: ActivityFilter): Filter<ActivityDocument>[] {
    const conditions: Filter<ActivityDocument>[] = [];
    if (filter.category !== undefined) conditions.push({ category: filter.category });
    if (filter.actor !== undefined) conditions.push({ actor: filter.actor });
    if (filter.ok !== undefined) conditions.push({ ok: filter.ok });
    if (filter.groupId !== undefined) conditions.push({ groupId: filter.groupId });
    if (filter.from !== undefined) conditions.push({ at: { $gte: filter.from } });
    if (filter.to !== undefined) conditions.push({ at: { $lte: filter.to } });
    const text = filter.text?.trim() ?? "";
    if (text !== "") {
      const $regex = searchPattern(text);
      conditions.push({ $or: [{ title: { $regex } }, { detail: { $regex } }, { error: { $regex } }, { groupName: { $regex } }, { userName: { $regex } }, { userId: { $regex } }, { groupId: { $regex } }] });
    }
    return conditions;
  }

  public async logJoinReview(groupId: string, review: Omit<JoinReview, "at">): Promise<void> {
    const at = now();
    await this.joinReviews.insertOne({ groupId, userId: review.userId, userName: review.userName, decision: review.decision, by: review.by, reasons: [...review.reasons], at, createdAt: new Date(at) });
  }

  // The latest decisions on requests to join a group, newest first.
  public async listJoinReviews(groupId: string, limit = 50): Promise<JoinReview[]> {
    const documents = await this.joinReviews.find({ groupId }).sort({ at: -1 }).limit(limit).toArray();
    return documents.map((document) => ({ userId: document.userId, userName: document.userName, decision: document.decision, by: document.by, reasons: document.reasons, at: document.at }));
  }

  public async setKickRule(groupId: string, rule: ViolationRule, kickRule: KickRule): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOneAndUpdate(
      { _id: groupId },
      { $set: { [`kickRules.${rule}`]: { enabled: kickRule.enabled, count: kickRule.count, windowSeconds: kickRule.windowSeconds }, updatedAt: now() } },
      { returnDocument: "after" },
    );
    return document === null ? undefined : this.toGroup(document);
  }

  // Adds one violation to the member's all-time record.
  public async recordViolation(groupId: string, userId: string, userName: string, rule: ViolationRule): Promise<void> {
    await this.violations.updateOne(
      { groupId, userId },
      {
        $inc: { [`counts.${rule}`]: 1 },
        $set: { userName, lastRule: rule, lastAt: now() },
        $setOnInsert: { kicks: 0 },
      },
      { upsert: true },
    );
  }

  // How many logged messages of the member broke this rule within the window, not counting anything before their last kick.
  public async countRecentViolations(groupId: string, userId: string, rule: ViolationRule, windowSeconds: number): Promise<number> {
    const record = await this.violations.findOne({ groupId, userId }, { projection: { lastKickAt: 1 } });
    const since = Math.max(now() - windowSeconds * 1000, record?.lastKickAt ?? 0);
    return this.violationMessages.countDocuments({ groupId, userId, at: { $gt: since }, "matches.rule": rule });
  }

  public async recordKick(groupId: string, userId: string): Promise<void> {
    await this.violations.updateOne({ groupId, userId }, { $set: { lastKickAt: now() }, $inc: { kicks: 1 } });
  }

  public async listViolations(groupId: string): Promise<MemberViolations[]> {
    const documents = await this.violations.find({ groupId }).sort({ lastAt: -1 }).toArray();
    return documents.map((document) => this.toMemberViolations(document));
  }

  // Clears one member's record and logged messages, or the whole group's when no member is given.
  // Clears the record of the whole group, or of the given members only.
  public async clearViolations(groupId: string, userIds?: readonly string[]): Promise<void> {
    const filter = userIds === undefined ? { groupId } : { groupId, userId: { $in: [...userIds] } };
    await this.violations.deleteMany(filter);
    await this.violationMessages.deleteMany(filter);
  }

  // Keeps what the member sent. A message that breaks several rules is one entry with several matches.
  public async logViolationMessage(groupId: string, message: Omit<ViolationMessage, "matches" | "status" | "at">, match: ViolationMatch): Promise<void> {
    await this.violationMessages.updateOne(
      { groupId, messageId: message.messageId },
      {
        $setOnInsert: {
          userId: message.userId,
          userName: message.userName,
          text: message.text,
          link: message.link,
          messageType: message.messageType,
          status: "recorded",
          at: now(),
          createdAt: new Date(),
        },
        $push: { matches: match },
      },
      { upsert: true },
    );
  }

  public async setViolationMessageStatus(groupId: string, messageId: string, status: ViolationMessageStatus): Promise<void> {
    await this.violationMessages.updateOne({ groupId, messageId }, { $set: { status } });
  }

  // The member's most recent violating messages, newest first.
  public async listViolationMessages(groupId: string, userId: string, limit = 50): Promise<ViolationMessage[]> {
    const documents = await this.violationMessages.find({ groupId, userId }).sort({ at: -1 }).limit(limit).toArray();
    return documents.map((document) => this.toViolationMessage(document));
  }

  // The latest violating messages across every group, newest first.
  // filter.before pages backwards through the log; filter.rule keeps only messages that broke that rule.
  // The logged messages that pass the filter, newest first. `before` continues from an earlier page.
  public async listRecentViolationMessages(limit: number, filter: ViolationLogFilter & Readonly<{ before?: number }> = {}): Promise<RecentViolation[]> {
    const conditions = await this.violationConditions(filter);
    if (filter.before !== undefined) conditions.push({ at: { $lt: filter.before } });
    const documents = await this.violationMessages.find(conditions.length === 0 ? {} : { $and: conditions }).sort({ at: -1 }).limit(limit).toArray();
    const groupIds = Array.from(new Set(documents.map((document) => document.groupId)));
    const groups = await this.groups.find({ _id: { $in: groupIds } }, { projection: { name: 1 } }).toArray();
    const names = new Map(groups.map((group) => [group._id, group.name]));
    return documents.map((document) => ({
      ...this.toViolationMessage(document),
      groupId: document.groupId,
      groupName: names.get(document.groupId) ?? document.groupId,
    }));
  }

  // How many logged messages pass the filter.
  public async countViolationMessages(filter: ViolationLogFilter): Promise<number> {
    const conditions = await this.violationConditions(filter);
    return this.violationMessages.countDocuments(conditions.length === 0 ? {} : { $and: conditions });
  }

  private async violationConditions(filter: ViolationLogFilter): Promise<Filter<ViolationMessageDocument>[]> {
    const conditions: Filter<ViolationMessageDocument>[] = [];
    if (filter.rule !== undefined) conditions.push({ "matches.rule": filter.rule });
    if (filter.status !== undefined) conditions.push({ status: filter.status });
    if (filter.from !== undefined) conditions.push({ at: { $gte: filter.from } });
    if (filter.to !== undefined) conditions.push({ at: { $lte: filter.to } });
    const text = filter.text?.trim() ?? "";
    if (text !== "") {
      const $regex = searchPattern(text);
      // The group's name is not kept with the message, so groups are searched first and matched by ID.
      const groups = await this.groups.find({ name: { $regex } }, { projection: { _id: 1 } }).toArray();
      conditions.push({
        $or: [
          { userName: { $regex } },
          { userId: { $regex } },
          { text: { $regex } },
          { link: { $regex } },
          { "matches.detail": { $regex } },
          ...(groups.length === 0 ? [] : [{ groupId: { $in: groups.map((group) => group._id) } }]),
        ],
      });
    }
    return conditions;
  }

  // Violating messages per day for the last `days` days including today, oldest first, in the server's time zone.
  public async violationSeries(days: number): Promise<DailyViolations[]> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const firstDay = new Date();
    firstDay.setHours(0, 0, 0, 0);
    firstDay.setDate(firstDay.getDate() - (days - 1));
    const rows = await this.violationMessages.aggregate<{ _id: { day: string; rule: ViolationRule }; count: number }>([
      { $match: { createdAt: { $gte: firstDay } } },
      { $unwind: "$matches" },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, rule: "$matches.rule" }, count: { $sum: 1 } } },
    ]).toArray();
    const counts = new Map(rows.map((row) => [`${row._id.day}:${row._id.rule}`, row.count]));
    return Array.from({ length: days }, (_item, index) => {
      const day = new Date(firstDay);
      day.setDate(firstDay.getDate() + index);
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const perRule = Object.fromEntries(violationRules.map((rule) => [rule, counts.get(`${date}:${rule}`) ?? 0])) as Record<ViolationRule, number>;
      return { date, ...perRule };
    });
  }

  public async createSession(tokenHash: string, expiresAt: Date): Promise<void> {
    await this.sessions.insertOne({ _id: tokenHash, expiresAt });
  }

  public async hasSession(tokenHash: string): Promise<boolean> {
    // The TTL index only sweeps about once a minute, so the expiry is checked here as well.
    return await this.sessions.findOne({ _id: tokenHash, expiresAt: { $gt: new Date() } }) !== null;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.sessions.deleteOne({ _id: tokenHash });
  }

  public async getSecret(name: string): Promise<EncryptedSecret | undefined> {
    const document = await this.secrets.findOne({ _id: name });
    return document === null ? undefined : { iv: document.iv, tag: document.tag, data: document.data };
  }

  public async setSecret(name: string, secret: EncryptedSecret): Promise<void> {
    await this.secrets.updateOne({ _id: name }, { $set: { ...secret, updatedAt: now() } }, { upsert: true });
  }

  public async deleteSecret(name: string): Promise<void> {
    await this.secrets.deleteOne({ _id: name });
  }

  // Named lists of strings, such as the blocked links or the custom banned words.
  public async getList(name: string): Promise<string[]> {
    const document = await this.settings.findOne({ _id: name });
    return document?.values ?? [];
  }

  // Every list whose name starts with the prefix, such as a shared list together with its per-group variants.
  public async getListsByPrefix(prefix: string): Promise<Map<string, string[]>> {
    const documents = await this.settings.find({ _id: { $regex: `^${escapeRegExp(prefix)}` } }).toArray();
    return new Map(documents.map((document) => [document._id, document.values]));
  }

  public async setList(name: string, values: readonly string[]): Promise<void> {
    await this.settings.updateOne({ _id: name }, { $set: { values: [...values] } }, { upsert: true });
  }

  // Until the master switch existed, botEnabled meant "block links" and each rule worked on its own.
  // Groups saved that way keep their behaviour: the link rule takes over the old value, and the
  // master switch is on wherever any rule was on. Groups already converted are left alone.
  // Every automatic answer, oldest first, without the pictures themselves.
  public async listAutoReplies(): Promise<AutoReplyRule[]> {
    const documents = await this.autoReplies.find({}, { projection: { "images.data": 0 }, sort: { createdAt: 1 } }).toArray();
    return documents.map((document) => ({
      id: document._id.toHexString(),
      kind: document.kind,
      match: document.match,
      triggers: document.triggers,
      text: document.text,
      imageCount: document.images?.length ?? 0,
      groupIds: document.groupIds,
      cooldownSeconds: document.cooldownSeconds,
      enabled: document.enabled,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      sentCount: document.sentCount,
      lastSentAt: document.lastSentAt,
    }));
  }

  // "empty" when there is neither text nor a picture to answer with, "invalid" when the draft keeps a
  // picture the rule does not have, "tooHeavy" when the pictures together are too large.
  public async createAutoReply(draft: AutoReplyDraft): Promise<"saved" | "empty" | "invalid" | "tooHeavy"> {
    const fields = this.autoReplyFields(draft, []);
    if (typeof fields === "string") return fields;
    const at = now();
    await this.autoReplies.insertOne({ _id: new ObjectId(), ...fields, createdAt: at, updatedAt: at, sentCount: 0, lastSentAt: null });
    return "saved";
  }

  public async updateAutoReply(id: string, draft: AutoReplyDraft): Promise<"saved" | "missing" | "empty" | "invalid" | "tooHeavy"> {
    const _id = toObjectId(id);
    const current = _id === undefined ? null : await this.autoReplies.findOne({ _id });
    if (_id === undefined || current === null) return "missing";
    const fields = this.autoReplyFields(draft, current.images ?? []);
    if (typeof fields === "string") return fields;
    return (await this.autoReplies.updateOne({ _id }, { $set: { ...fields, updatedAt: now() } })).matchedCount === 1 ? "saved" : "missing";
  }

  public async setAutoReplyEnabled(id: string, enabled: boolean): Promise<boolean> {
    const _id = toObjectId(id);
    return _id !== undefined && (await this.autoReplies.updateOne({ _id }, { $set: { enabled, updatedAt: now() } })).matchedCount === 1;
  }

  public async deleteAutoReplies(ids: readonly string[]): Promise<number> {
    const objectIds = ids.map(toObjectId).filter((id): id is ObjectId => id !== undefined);
    return objectIds.length === 0 ? 0 : (await this.autoReplies.deleteMany({ _id: { $in: objectIds } })).deletedCount;
  }

  public async getAutoReplyImages(id: string): Promise<MessageImage[]> {
    const _id = toObjectId(id);
    const document = _id === undefined ? null : await this.autoReplies.findOne({ _id }, { projection: { images: 1 } });
    return (document?.images ?? []).map(toImage);
  }

  public async recordAutoReplySent(id: string, at: number): Promise<void> {
    const _id = toObjectId(id);
    if (_id !== undefined) await this.autoReplies.updateOne({ _id }, { $inc: { sentCount: 1 }, $set: { lastSentAt: at } });
  }

  // What a draft stores, with its kept pictures taken from the ones the rule has now.
  private autoReplyFields(draft: AutoReplyDraft, stored: readonly StoredImage[]): Pick<AutoReplyDocument, "kind" | "match" | "triggers" | "text" | "images" | "groupIds" | "cooldownSeconds" | "enabled"> | "empty" | "invalid" | "tooHeavy" {
    const images: StoredImage[] = [];
    for (const item of draft.images) {
      const image = "keep" in item ? stored[item.keep] : item;
      if (image === undefined) return "invalid";
      images.push(image);
    }
    if (draft.text === "" && images.length === 0) return "empty";
    if (totalImageBytes(images.map((image) => ({ data: { length: Buffer.isBuffer(image.data) ? image.data.length : image.data.length() } }))) > maxMessageImagesBytes) return "tooHeavy";
    return { kind: draft.kind, match: draft.match, triggers: [...draft.triggers], text: draft.text, images, groupIds: [...draft.groupIds], cooldownSeconds: draft.cooldownSeconds, enabled: draft.enabled };
  }

  public async addReminderMessage(message: Omit<ScheduledReminderMessage, "id">): Promise<void> {
    await this.reminderMessages.insertOne({
      _id: new ObjectId(),
      groupId: message.groupId,
      reminderId: message.reminderId,
      title: message.title,
      text: message.text,
      ...(message.images === undefined || message.images.length === 0 ? {} : { images: [...message.images] }),
      dueAt: message.dueAt,
      startTime: message.startTime,
      repeat: message.repeat,
      updatedAt: now(),
      ...(message.urgency === undefined ? {} : { urgency: message.urgency }),
      ...(message.batchId === undefined ? {} : { batchId: message.batchId }),
    });
  }

  // Files what was sent to one group under a round of sending, starting the round when this is its first group.
  public async addSentBatchGroup(id: string, batch: Omit<SentBatch, "id" | "groups">, group: SentBatchGroup): Promise<void> {
    await this.sentBatches.updateOne({ _id: id }, { $setOnInsert: { ...batch, savedAt: new Date() }, $push: { groups: group } }, { upsert: true });
  }

  public async addPoll(poll: StoredPoll): Promise<void> {
    const { id, ...fields } = poll;
    await this.polls.insertOne({ _id: id, ...fields, options: [...poll.options], groups: [...poll.groups] });
  }

  // The latest polls made from the dashboard, newest first.
  public async listPolls(limit: number): Promise<StoredPoll[]> {
    return (await this.polls.find({}, { sort: { createdAt: -1 }, limit }).toArray()).map(toStoredPoll);
  }

  public async getPoll(id: string): Promise<StoredPoll | undefined> {
    const document = await this.polls.findOne({ _id: id });
    return document === null ? undefined : toStoredPoll(document);
  }

  // Forgets a poll here. The polls themselves stay in their groups on Zalo.
  public async deletePoll(id: string): Promise<boolean> {
    return (await this.polls.deleteOne({ _id: id })).deletedCount === 1;
  }

  // The latest rounds of sending, newest first.
  public async listSentBatches(limit: number): Promise<SentBatch[]> {
    const documents = await this.sentBatches.find({}, { sort: { createdAt: -1 }, limit }).toArray();
    return documents.map(toSentBatch);
  }

  public async getSentBatch(id: string): Promise<SentBatch | undefined> {
    const document = await this.sentBatches.findOne({ _id: id });
    return document === null ? undefined : toSentBatch(document);
  }

  // Notes how taking a round's messages back went in one of its groups.
  public async setSentBatchRecall(id: string, groupId: string, outcome: Readonly<{ recalledAt: number } | { recallError: string }>): Promise<void> {
    const update: UpdateFilter<SentBatchDocument> = "recalledAt" in outcome
      ? { $set: { "groups.$[group].recalledAt": outcome.recalledAt }, $unset: { "groups.$[group].recallError": "" } }
      : { $set: { "groups.$[group].recallError": outcome.recallError } };
    await this.sentBatches.updateOne({ _id: id }, update, { arrayFilters: [{ "group.groupId": groupId }] });
  }

  // Every waiting message, soonest first, without the pictures themselves.
  public async listReminderMessages(): Promise<Omit<PendingReminderMessage, "groupName">[]> {
    const documents = await this.reminderMessages.find({}, { projection: withoutImageData, sort: { dueAt: 1 } }).toArray();
    return documents.map((document) => ({
      id: document._id.toHexString(),
      groupId: document.groupId,
      reminderId: document.reminderId,
      title: document.title ?? "",
      text: document.text,
      imageCount: storedImages(document).length,
      dueAt: document.dueAt,
      repeat: document.repeat,
      updatedAt: document.updatedAt ?? 0,
    }));
  }

  // One picture of a waiting message, by its position.
  public async getReminderMessageImage(id: string, index: number): Promise<MessageImage | undefined> {
    const _id = toObjectId(id);
    const document = _id === undefined ? null : await this.reminderMessages.findOne({ _id }, { projection: { image: 1, images: 1 } });
    const image = document === null ? undefined : storedImages(document)[index];
    return image === undefined ? undefined : toImage(image);
  }

  // Changes a waiting message. "empty" when the change would leave it with neither text nor a picture,
  // "invalid" when it keeps a picture the message does not have, "tooHeavy" when the pictures together are too large.
  public async updateReminderMessage(id: string, edit: ReminderMessageEdit): Promise<"updated" | "missing" | "empty" | "invalid" | "tooHeavy"> {
    const _id = toObjectId(id);
    // Kept pictures are written back with the new ones, so their bytes are needed whenever the list changes.
    const current = _id === undefined ? null : await this.reminderMessages.findOne({ _id }, edit.images === undefined ? { projection: withoutImageData } : {});
    if (_id === undefined || current === null) return "missing";
    const stored = storedImages(current);
    const fields = { text: edit.text, updatedAt: now() };
    if (edit.images === undefined) {
      if (edit.text === "" && stored.length === 0) return "empty";
      return (await this.reminderMessages.updateOne({ _id }, { $set: fields })).matchedCount === 1 ? "updated" : "missing";
    }
    const images: StoredImage[] = [];
    for (const item of edit.images) {
      const image = "keep" in item ? stored[item.keep] : item;
      if (image === undefined) return "invalid";
      images.push(image);
    }
    if (edit.text === "" && images.length === 0) return "empty";
    if (totalImageBytes(images.map((image) => ({ data: { length: Buffer.isBuffer(image.data) ? image.data.length : image.data.length() } }))) > maxMessageImagesBytes) return "tooHeavy";
    const update: UpdateFilter<ReminderMessageDocument> = { $set: { ...fields, images }, $unset: { image: "" } };
    return (await this.reminderMessages.updateOne({ _id }, update)).matchedCount === 1 ? "updated" : "missing";
  }

  public async deleteReminderMessage(id: string): Promise<boolean> {
    const _id = toObjectId(id);
    return _id !== undefined && (await this.reminderMessages.deleteOne({ _id })).deletedCount === 1;
  }

  // The message that has been due the longest, if any is due.
  public async findDueReminderMessage(at: number): Promise<ScheduledReminderMessage | undefined> {
    const document = await this.reminderMessages.findOne({ dueAt: { $lte: at } }, { sort: { dueAt: 1 } });
    if (document === null) return undefined;
    const images = storedImages(document).map(toImage);
    return {
      id: document._id.toHexString(),
      groupId: document.groupId,
      reminderId: document.reminderId,
      title: document.title ?? "",
      text: document.text,
      ...(images.length === 0 ? {} : { images }),
      dueAt: document.dueAt,
      startTime: document.startTime,
      repeat: document.repeat,
      ...(document.urgency === undefined ? {} : { urgency: document.urgency }),
      ...(document.batchId === undefined ? {} : { batchId: document.batchId }),
    };
  }

  // Takes a due message for sending: it leaves the queue, or moves to `nextDueAt` when its reminder repeats.
  // False when something else took or moved it first.
  public async claimReminderMessage(message: Pick<ScheduledReminderMessage, "id" | "dueAt">, nextDueAt: number | null): Promise<boolean> {
    const filter = { _id: new ObjectId(message.id), dueAt: message.dueAt };
    if (nextDueAt === null) return (await this.reminderMessages.deleteOne(filter)).deletedCount === 1;
    return (await this.reminderMessages.updateOne(filter, { $set: { dueAt: nextDueAt } })).modifiedCount === 1;
  }

  // Drops every message still waiting for a group, for when the bot is no longer in it.
  public async removeGroupReminderMessages(groupId: string): Promise<void> {
    await this.reminderMessages.deleteMany({ groupId });
  }

  // Cancels several waiting messages at once. Returns how many there were to cancel.
  public async deleteReminderMessages(ids: readonly string[]): Promise<number> {
    const objectIds = ids.map(toObjectId).filter((id): id is ObjectId => id !== undefined);
    return objectIds.length === 0 ? 0 : (await this.reminderMessages.deleteMany({ _id: { $in: objectIds } })).deletedCount;
  }

  public async removeReminderMessages(groupId: string, reminderId: string): Promise<void> {
    await this.reminderMessages.deleteMany({ groupId, reminderId });
  }

  // "<groupId>:<reminderId>" of every reminder that still has a message waiting.
  public async listReminderMessageKeys(): Promise<Set<string>> {
    const documents = await this.reminderMessages.find({}, { projection: { groupId: 1, reminderId: 1 } }).toArray();
    return new Set(documents.map((document) => `${document.groupId}:${document.reminderId}`));
  }

  private async splitLegacyBotSwitch(): Promise<void> {
    await this.groups.updateMany({ linkGuardEnabled: { $exists: false } }, [
      {
        $set: {
          linkGuardEnabled: { $eq: ["$botEnabled", true] },
          botEnabled: { $or: [{ $eq: ["$botEnabled", true] }, { $eq: ["$badWordFilterEnabled", true] }] },
        },
      },
    ]);
  }

  private async updateGroup(groupId: string, fields: Partial<GroupDocument>): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOneAndUpdate(
      { _id: groupId },
      { $set: { ...fields, updatedAt: now() } },
      { returnDocument: "after" },
    );
    return document === null ? undefined : this.toGroup(document);
  }

  private toViolationMessage(document: ViolationMessageDocument): ViolationMessage {
    return {
      messageId: document.messageId,
      userId: document.userId,
      userName: document.userName,
      matches: document.matches,
      text: document.text,
      link: document.link,
      messageType: document.messageType,
      status: document.status,
      at: document.at,
    };
  }

  private toKickRules(document: GroupDocument): KickRules {
    const read = (rule: ViolationRule): KickRule | undefined => {
      const stored = document.kickRules?.[rule];
      if (stored === undefined) return undefined;
      // A count of 0 used to mean "never kick"; such a rule becomes a disabled one with the default count.
      if (stored.count < 1) return { ...defaultKickRules[rule], windowSeconds: stored.windowSeconds };
      return { enabled: stored.enabled ?? document.kickEnabled === true, count: stored.count, windowSeconds: stored.windowSeconds };
    };
    return {
      link: read("link") ?? (document.linkSpamKickEnabled === true ? legacyLinkKickRule : defaultKickRules.link),
      badWord: read("badWord") ?? defaultKickRules.badWord,
      spam: read("spam") ?? defaultKickRules.spam,
    };
  }

  private toMemberViolations(document: ViolationDocument): MemberViolations {
    const counts = Object.fromEntries(violationRules.map((rule) => [rule, document.counts[rule] ?? 0])) as Record<ViolationRule, number>;
    return {
      userId: document.userId,
      userName: document.userName,
      counts,
      kicks: document.kicks,
      lastRule: document.lastRule,
      lastAt: document.lastAt,
    };
  }

  private toGroup(document: GroupDocument): StoredGroup {
    return {
      groupId: document._id,
      name: document.name,
      creatorId: document.creatorId,
      adminIds: document.adminIds,
      memberCount: document.memberCount,
      botEnabled: document.botEnabled,
      linkGuardEnabled: document.linkGuardEnabled ?? false,
      badWordFilterEnabled: document.badWordFilterEnabled ?? false,
      spamGuardEnabled: document.spamGuardEnabled ?? false,
      spamSettings: { ...defaultSpamSettings, ...document.spamSettings },
      joinApproval: { ...defaultJoinApproval, ...document.joinApproval },
      commands: { random: { ...defaultGroupCommands.random, ...document.commands?.random } },
      welcome: { ...defaultGroupWelcome, ...document.welcome },
      kickRules: this.toKickRules(document),
      updatedAt: document.updatedAt,
    };
  }
}
