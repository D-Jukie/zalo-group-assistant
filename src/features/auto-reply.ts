import { ThreadType, type API } from "zca-js";
import { noActivity, previewText, type ActivityRecorder } from "../activity/activity-log.js";
import type { AutoReplies } from "../auto-reply/auto-replies.js";
import { memberAnswer, numberAnswer, parseRandomCommand, pickDistinct, pickNumber } from "../auto-reply/random-command.js";
import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import { writeLog } from "../logger.js";
import { sendGroupMessage } from "../reminders/reminder-messenger.js";
import type { MemberProfile } from "../types.js";
import { now } from "../utils.js";

type ReplyApi = Pick<API, "sendMessage">;

// Where "/random" gets the group's members from.
type MemberSource = Readonly<{
  ownId: string;
  listMembers(groupId: string): Promise<Readonly<{ members: readonly MemberProfile[]; complete: boolean }>>;
}>;

type Mention = Readonly<{ pos: number; uid: string; len: number }>;

// One command of the bot's own answers at most this often in a group.
const commandRestMs = 3000;

// Answers a member who types one of the bot's own commands ("/random") or one of the admin's keywords
// or commands. An answer rests after it was given in a group, so something that comes up often does
// not flood the group.
export class AutoReplyFeature implements BotFeature {
  public readonly name = "auto-reply";
  // When each rule or command last answered in each group, by "<rule>:<group>".
  private readonly lastAnswered = new Map<string, number>();

  public constructor(
    private readonly api: ReplyApi,
    private readonly replies: AutoReplies,
    private readonly members: MemberSource,
    private readonly activity: ActivityRecorder = noActivity,
  ) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    // Only what a member typed is answered, not captions or the text of links and stickers.
    const { content } = context.message.data;
    if (typeof content !== "string") return;
    // A command the bot knows by itself comes before the admin's answers, where the group has it switched on.
    if (await this.answerRandom(content, context)) return;
    const rule = this.replies.find(content, context.groupId);
    if (rule === undefined) return;
    const key = `${rule.id}:${context.groupId}`;
    const at = now();
    if (at - (this.lastAnswered.get(key) ?? 0) < rule.cooldownSeconds * 1000) return;
    // Marked before sending, so two messages arriving together get one answer.
    this.lastAnswered.set(key, at);
    const fields = { group: context.groupId, user: context.userId, trigger: rule.triggers[0] ?? "" };
    const entry = { category: "replies", actor: "bot", title: rule.kind === "command" ? "Trả lời lệnh" : "Trả lời từ khóa", detail: `${rule.triggers[0] ?? ""} → ${previewText(rule.text, rule.imageCount)}`, groupId: context.groupId, userId: context.userId, userName: context.message.data.dName } as const;
    try {
      if (rule.imageCount > 0) {
        await sendGroupMessage(this.api, context.groupId, { text: rule.text, images: await this.replies.images(rule.id) });
      } else {
        await this.sendText(rule.text, context);
      }
      await this.replies.recordSent(rule.id, at);
      writeLog("[AUTO REPLY]", "cyan", fields);
      this.activity.record(entry);
    } catch (error: unknown) {
      // Nothing went out, so the rule may answer the next time without waiting.
      this.lastAnswered.delete(key);
      const reason = error instanceof Error ? error.message : String(error);
      writeLog("[AUTO REPLY FAILED]", "red", { ...fields, error: reason }, "error");
      this.activity.record({ ...entry, ok: false, error: reason });
    }
  }

  // "/random": picks members of the group, or a number in a range. Returns whether the message was
  // this command and the group has it switched on; then nothing else answers the message.
  private async answerRandom(content: string, context: GroupMessageContext): Promise<boolean> {
    const request = parseRandomCommand(content);
    const settings = context.group.commands.random;
    if (request === undefined || !settings.enabled) return false;
    // A member who may not use it, and a command typed again right away, get no answer at all.
    if (settings.adminOnly && !context.senderIsAdmin) return true;
    const key = `random:${context.groupId}`;
    const at = now();
    if (at - (this.lastAnswered.get(key) ?? 0) < commandRestMs) return true;
    this.lastAnswered.set(key, at);
    const fields = { group: context.groupId, user: context.userId, trigger: "/random" };
    const entry = { category: "replies", actor: "bot", title: "Trả lời lệnh /random", detail: previewText(content), groupId: context.groupId, userId: context.userId, userName: context.message.data.dName } as const;
    try {
      if (request.kind === "invalid") {
        await this.sendText(request.reason, context);
      } else if (request.kind === "number") {
        await this.sendText(numberAnswer(request.min, request.max, pickNumber(request.min, request.max)), context);
      } else {
        const { members, complete } = await this.members.listMembers(context.groupId);
        // The bot does not pick itself.
        const pool = members.filter((member) => member.userId !== this.members.ownId);
        if (pool.length === 0) {
          await this.sendText("Chưa đọc được danh sách thành viên của nhóm, thử lại sau nhé.", context);
        } else {
          const answer = memberAnswer(pickDistinct(pool, request.count), pool.length, complete);
          await this.sendText(answer.text, context, answer.mentions);
        }
      }
      writeLog("[AUTO REPLY]", "cyan", fields);
      this.activity.record(entry);
    } catch (error: unknown) {
      this.lastAnswered.delete(key);
      const reason = error instanceof Error ? error.message : String(error);
      writeLog("[AUTO REPLY FAILED]", "red", { ...fields, error: reason }, "error");
      this.activity.record({ ...entry, ok: false, error: reason });
    }
    return true;
  }

  // A text answer quotes the message it answers. If Zalo refuses the quote, the answer still goes out plain.
  private async sendText(text: string, context: GroupMessageContext, mentions: readonly Mention[] = []): Promise<void> {
    const message = mentions.length === 0 ? { msg: text } : { msg: text, mentions: [...mentions] };
    try {
      await this.api.sendMessage({ ...message, quote: context.message.data }, context.groupId, ThreadType.Group);
    } catch {
      await this.api.sendMessage(message, context.groupId, ThreadType.Group);
    }
  }
}
