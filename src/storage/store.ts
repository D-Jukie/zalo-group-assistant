import { MongoClient, type Collection, type UpdateFilter } from "mongodb";
import { GroupEventType, type GroupInfo } from "zca-js";
import { defaultKickRules, violationRules, type GroupSetting, type JsonRecord, type KickRule, type KickRules, type MemberViolations, type StoredGroup, type ViolationMatch, type ViolationMessage, type ViolationMessageStatus, type ViolationRule } from "../types.js";
import type { EncryptedSecret } from "./secret-box.js";
import { asNumber, asString, isRecord, now, uniqueStrings } from "../utils.js";

type GroupDocument = {
  _id: string;
  name: string;
  creatorId: string;
  adminIds: string[];
  memberCount: number | null;
  botEnabled: boolean;
  // The rest are missing on groups stored before those features existed.
  badWordFilterEnabled?: boolean;
  kickEnabled?: boolean;
  kickRules?: Partial<Record<ViolationRule, KickRule>>;
  // Replaced by kickEnabled and kickRules.link; only read so groups saved by older versions keep kicking link spam.
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
const legacyLinkKickRule: KickRule = { count: 3, windowSeconds: 10 };

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
    );
    // MongoDB removes expired sessions on its own.
    await store.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await store.violations.createIndex({ groupId: 1, userId: 1 }, { unique: true });
    await store.violationMessages.createIndex({ groupId: 1, messageId: 1 }, { unique: true });
    await store.violationMessages.createIndex({ groupId: 1, userId: 1, at: -1 });
    await store.violationMessages.createIndex({ createdAt: 1 }, { expireAfterSeconds: violationMessageRetentionDays * 24 * 60 * 60 });
    return store;
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  public async getGroup(groupId: string): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOne({ _id: groupId });
    return document === null ? undefined : this.toGroup(document);
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
        $setOnInsert: { botEnabled: false, badWordFilterEnabled: false, kickEnabled: false },
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

  public async setKickRule(groupId: string, rule: ViolationRule, kickRule: KickRule): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOneAndUpdate(
      { _id: groupId },
      { $set: { [`kickRules.${rule}`]: { count: kickRule.count, windowSeconds: kickRule.windowSeconds }, updatedAt: now() } },
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
  public async clearViolations(groupId: string, userId?: string): Promise<void> {
    const filter = userId === undefined ? { groupId } : { groupId, userId };
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
    return documents.map((document) => ({
      messageId: document.messageId,
      userId: document.userId,
      userName: document.userName,
      matches: document.matches,
      text: document.text,
      link: document.link,
      messageType: document.messageType,
      status: document.status,
      at: document.at,
    }));
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

  // Named lists of strings, such as the blocked links or the custom banned words.
  public async getList(name: string): Promise<string[]> {
    const document = await this.settings.findOne({ _id: name });
    return document?.values ?? [];
  }

  public async setList(name: string, values: readonly string[]): Promise<void> {
    await this.settings.updateOne({ _id: name }, { $set: { values: [...values] } }, { upsert: true });
  }

  private async updateGroup(groupId: string, fields: Partial<GroupDocument>): Promise<StoredGroup | undefined> {
    const document = await this.groups.findOneAndUpdate(
      { _id: groupId },
      { $set: { ...fields, updatedAt: now() } },
      { returnDocument: "after" },
    );
    return document === null ? undefined : this.toGroup(document);
  }

  private toKickRules(document: GroupDocument): KickRules {
    return {
      link: document.kickRules?.link ?? (document.linkSpamKickEnabled === true ? legacyLinkKickRule : defaultKickRules.link),
      badWord: document.kickRules?.badWord ?? defaultKickRules.badWord,
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
      badWordFilterEnabled: document.badWordFilterEnabled ?? false,
      kickEnabled: document.kickEnabled ?? document.linkSpamKickEnabled === true,
      kickRules: this.toKickRules(document),
      updatedAt: document.updatedAt,
    };
  }
}
