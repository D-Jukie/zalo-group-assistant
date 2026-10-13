import type { AutoReplyDraft, AutoReplyRule, MessageImage } from "../types.js";
import { findAutoReply } from "./auto-reply.js";

export type AutoReplySaveOutcome = "saved" | "missing" | "empty" | "invalid" | "tooHeavy";

// Where the rules are kept.
export type AutoReplyStore = Readonly<{
  listAutoReplies(): Promise<AutoReplyRule[]>;
  createAutoReply(draft: AutoReplyDraft): Promise<AutoReplySaveOutcome>;
  updateAutoReply(id: string, draft: AutoReplyDraft): Promise<AutoReplySaveOutcome>;
  setAutoReplyEnabled(id: string, enabled: boolean): Promise<boolean>;
  deleteAutoReplies(ids: readonly string[]): Promise<number>;
  getAutoReplyImages(id: string): Promise<MessageImage[]>;
  recordAutoReplySent(id: string, at: number): Promise<void>;
}>;

// The answers the bot gives by itself. Every group message is checked against the rules, so they are
// kept in memory (without their pictures) and read again from the database whenever one changes.
export class AutoReplies {
  private rules: readonly AutoReplyRule[] = [];

  private constructor(private readonly store: AutoReplyStore) {}

  public static async load(store: AutoReplyStore): Promise<AutoReplies> {
    const replies = new AutoReplies(store);
    await replies.reload();
    return replies;
  }

  public list(): readonly AutoReplyRule[] {
    return this.rules;
  }

  // The rule that answers a message in a group, if any.
  public find(text: string, groupId: string): AutoReplyRule | undefined {
    return findAutoReply(this.rules, text, groupId);
  }

  public images(id: string): Promise<MessageImage[]> {
    return this.store.getAutoReplyImages(id);
  }

  public async create(draft: AutoReplyDraft): Promise<AutoReplySaveOutcome> {
    return this.changed(await this.store.createAutoReply(draft));
  }

  public async update(id: string, draft: AutoReplyDraft): Promise<AutoReplySaveOutcome> {
    return this.changed(await this.store.updateAutoReply(id, draft));
  }

  public async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const found = await this.store.setAutoReplyEnabled(id, enabled);
    await this.reload();
    return found;
  }

  public async remove(ids: readonly string[]): Promise<number> {
    const removed = await this.store.deleteAutoReplies(ids);
    await this.reload();
    return removed;
  }

  // Counts an answer that went out, here and in the database.
  public async recordSent(id: string, at: number): Promise<void> {
    this.rules = this.rules.map((rule) => rule.id === id ? { ...rule, sentCount: rule.sentCount + 1, lastSentAt: at } : rule);
    await this.store.recordAutoReplySent(id, at);
  }

  private async changed(outcome: AutoReplySaveOutcome): Promise<AutoReplySaveOutcome> {
    if (outcome === "saved") await this.reload();
    return outcome;
  }

  private async reload(): Promise<void> {
    this.rules = await this.store.listAutoReplies();
  }
}
