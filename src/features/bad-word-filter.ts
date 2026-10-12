import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import type { BannedWords } from "../moderation/banned-words.js";
import { isRecord } from "../utils.js";

// Only text a member typed is checked: a plain message, or the title/description that zca-js
// defines for attachment content (links, photos). Other fields hold URLs and IDs, where a banned
// word could appear by accident.
function messageTexts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!isRecord(content)) return [];
  return [content.title, content.description].filter((value): value is string => typeof value === "string");
}

export class BadWordFilterFeature implements BotFeature {
  public readonly name = "bad-word-filter";

  public constructor(private readonly bannedWords: BannedWords) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    if (!context.group.badWordFilterEnabled || context.senderIsAdmin) return;
    for (const text of messageTexts(context.message.data.content)) {
      const word = this.bannedWords.find(text);
      if (word !== undefined) {
        await context.reportViolation("badWord", word);
        return;
      }
    }
  }
}
