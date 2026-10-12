import { ThreadType, type API, type Message } from "zca-js";
import { writeLog } from "../logger.js";
import type { Store } from "../storage/store.js";
import type { StoredGroup, ViolationRule } from "../types.js";
import { isRecord } from "../utils.js";

const maxLoggedTextLength = 2_000;

type MessageTarget = Readonly<{
  message: Message;
  group: StoredGroup;
  botIsAdmin: boolean;
}>;

export type EnforcerApi = Pick<API, "deleteMessage" | "removeUserFromGroup">;
export type EnforcerStore = Pick<Store, "recordViolation" | "logViolationMessage" | "setViolationMessageStatus" | "countRecentViolations" | "recordKick">;

// The readable part of a message: the text itself, or the title, description and link of an attachment.
function describeContent(content: unknown): Readonly<{ text: string; link: string | null }> {
  if (typeof content === "string") return { text: content.slice(0, maxLoggedTextLength), link: null };
  if (!isRecord(content)) return { text: "", link: null };
  const parts = [content.title, content.description].filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    text: parts.join("\n").slice(0, maxLoggedTextLength),
    link: typeof content.href === "string" && content.href.length > 0 ? content.href.slice(0, maxLoggedTextLength) : null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// What happens after a feature finds a violation: delete the message, record it, and, if that
// feature has kicking switched on in the group, kick the sender once they broke its rule often
// enough within its time window.
export class Enforcer {
  private readonly kickInFlight = new Set<string>();
  private handledMessages = 0;

  public constructor(private readonly api: EnforcerApi, private readonly store: EnforcerStore) {}

  // How many messages were reported as violations since the bot started.
  public get handledMessageCount(): number {
    return this.handledMessages;
  }

  // Returns the reportViolation function for one message. A message that breaks several rules is
  // deleted once and counts once for each rule it broke.
  public forMessage(target: MessageTarget): (rule: ViolationRule, detail: string) => Promise<void> {
    const { message, group, botIsAdmin } = target;
    const groupId = message.threadId;
    const userId = message.data.uidFrom;
    const messageId = message.data.msgId || message.data.cliMsgId;
    let deletion: Promise<boolean> | undefined;
    let counted = false;

    return async (rule, detail) => {
      if (!counted) {
        counted = true;
        this.handledMessages += 1;
      }
      // Deleting needs admin rights. It starts right away and does not wait for the database,
      // so a slow or failing database never leaves the message in the group.
      if (botIsAdmin) deletion ??= this.deleteMessage(message, messageId);
      const kickRule = group.kickRules[rule];
      const canKick = botIsAdmin && kickRule.enabled;
      let recent: number | undefined;
      try {
        await this.store.recordViolation(groupId, userId, message.data.dName, rule);
        await this.store.logViolationMessage(groupId, {
          messageId,
          userId,
          userName: message.data.dName,
          messageType: message.data.msgType,
          ...describeContent(message.data.content),
        }, { rule, detail });
        if (canKick) recent = await this.store.countRecentViolations(groupId, userId, rule, kickRule.windowSeconds);
        if (deletion !== undefined) {
          await this.store.setViolationMessageStatus(groupId, messageId, await deletion ? "deleted" : "deleteFailed");
        }
      } catch (error: unknown) {
        writeLog("[VIOLATION RECORD FAILED]", "red", { rule, group: groupId, user: userId, msg: messageId, error: errorMessage(error) }, "error");
      }
      writeLog("[VIOLATION]", "cyan", {
        rule,
        group: groupId,
        user: userId,
        msg: messageId,
        detail,
        ...(recent === undefined ? {} : { recent: `${recent}/${kickRule.count} trong ${kickRule.windowSeconds}s` }),
      });
      await deletion;
      if (recent !== undefined && recent >= kickRule.count) await this.kick(groupId, userId, rule, recent);
    };
  }

  private async deleteMessage(message: Message, messageId: string): Promise<boolean> {
    const fields = { group: message.threadId, user: message.data.uidFrom, msg: messageId };
    try {
      await this.api.deleteMessage({
        data: { cliMsgId: message.data.cliMsgId, msgId: message.data.msgId, uidFrom: message.data.uidFrom },
        threadId: message.threadId,
        type: ThreadType.Group,
      }, false);
      writeLog("[MESSAGE DELETED]", "green", fields);
      return true;
    } catch (error: unknown) {
      writeLog("[MESSAGE DELETE FAILED]", "red", { ...fields, error: errorMessage(error) }, "error");
      return false;
    }
  }

  private async kick(groupId: string, userId: string, rule: ViolationRule, recent: number): Promise<void> {
    const key = `${groupId}:${userId}`;
    if (this.kickInFlight.has(key)) return;
    this.kickInFlight.add(key);
    const fields = { rule, group: groupId, user: userId, recent: String(recent) };
    try {
      const result = await this.api.removeUserFromGroup(userId, groupId);
      if (result.errorMembers.includes(userId)) {
        // Nothing is reset, so the next violation inside the window tries again.
        writeLog("[KICK REJECTED]", "yellow", fields, "warn");
        return;
      }
      // Violations before a kick no longer count towards the next one.
      await this.store.recordKick(groupId, userId);
      writeLog("[KICKED]", "magenta", fields);
    } catch (error: unknown) {
      writeLog("[KICK FAILED]", "red", { ...fields, error: errorMessage(error) }, "error");
    } finally {
      this.kickInFlight.delete(key);
    }
  }
}
