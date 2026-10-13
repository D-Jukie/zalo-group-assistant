import type { Message } from "zca-js";
import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import { SpamDetector } from "../moderation/spam-detector.js";
import { isRecord, now } from "../utils.js";

// What the member wrote, for comparing messages: the text, or the title, description and link of an attachment.
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isRecord(content)) return "";
  return [content.title, content.description, content.href].filter((value): value is string => typeof value === "string").join(" ");
}

// Photos chosen together arrive one message each. Zalo tags them with a shared layout ID inside the
// attachment's params; when it is there the album is recognised exactly, otherwise ("") the
// detector falls back to photos that follow each other within a few seconds.
function albumKey(message: Message): string | undefined {
  if (message.data.msgType !== "chat.photo") return undefined;
  const content: unknown = message.data.content;
  const params = isRecord(content) && typeof content.params === "string" ? content.params : "";
  return /group_?layout_?id\\?"?\s*[:=]\s*\\?"?([\w-]+)/iu.exec(params)?.[1] ?? "";
}

// Catches spam by how a member posts rather than by what a single message contains.
// The message that crosses a threshold is the one reported; earlier messages of the burst stay.
export class SpamGuardFeature implements BotFeature {
  public readonly name = "spam-guard";
  private readonly detector = new SpamDetector();

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    if (!context.group.spamGuardEnabled || context.senderIsAdmin) return;
    const album = albumKey(context.message);
    const reason = this.detector.check(
      `${context.groupId}:${context.userId}`,
      { text: messageText(context.message.data.content), at: now(), ...(album === undefined ? {} : { album }) },
      context.group.spamSettings,
    );
    if (reason !== undefined) await context.reportViolation("spam", reason);
  }
}
