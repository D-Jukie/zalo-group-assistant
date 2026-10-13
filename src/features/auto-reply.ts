import { ThreadType, type API } from "zca-js";
import type { AutoReplies } from "../auto-reply/auto-replies.js";
import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import { writeLog } from "../logger.js";
import { sendGroupMessage } from "../reminders/reminder-messenger.js";
import { now } from "../utils.js";

type ReplyApi = Pick<API, "sendMessage">;

// Answers a member who types one of the admin's keywords or commands. One rule answers at most once
// per group in its rest time, so a keyword that comes up often does not flood the group.
export class AutoReplyFeature implements BotFeature {
  public readonly name = "auto-reply";
  // When each rule last answered in each group, by "<rule>:<group>".
  private readonly lastAnswered = new Map<string, number>();

  public constructor(
    private readonly api: ReplyApi,
    private readonly replies: AutoReplies,
  ) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    // Only what a member typed is answered, not captions or the text of links and stickers.
    const { content } = context.message.data;
    if (typeof content !== "string") return;
    const rule = this.replies.find(content, context.groupId);
    if (rule === undefined) return;
    const key = `${rule.id}:${context.groupId}`;
    const at = now();
    if (at - (this.lastAnswered.get(key) ?? 0) < rule.cooldownSeconds * 1000) return;
    // Marked before sending, so two messages arriving together get one answer.
    this.lastAnswered.set(key, at);
    const fields = { group: context.groupId, user: context.userId, trigger: rule.triggers[0] ?? "" };
    try {
      if (rule.imageCount > 0) {
        await sendGroupMessage(this.api, context.groupId, { text: rule.text, images: await this.replies.images(rule.id) });
      } else {
        await this.sendText(rule.text, context);
      }
      await this.replies.recordSent(rule.id, at);
      writeLog("[AUTO REPLY]", "cyan", fields);
    } catch (error: unknown) {
      // Nothing went out, so the rule may answer the next time without waiting.
      this.lastAnswered.delete(key);
      writeLog("[AUTO REPLY FAILED]", "red", { ...fields, error: error instanceof Error ? error.message : String(error) }, "error");
    }
  }

  // A text answer quotes the message it answers. If Zalo refuses the quote, the answer still goes out plain.
  private async sendText(text: string, context: GroupMessageContext): Promise<void> {
    try {
      await this.api.sendMessage({ msg: text, quote: context.message.data }, context.groupId, ThreadType.Group);
    } catch {
      await this.api.sendMessage({ msg: text }, context.groupId, ThreadType.Group);
    }
  }
}
