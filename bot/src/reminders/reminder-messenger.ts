import { ThreadType, Urgency, type API } from "zca-js";
import { noActivity, previewText, type ActivityRecorder } from "../activity/activity-log.js";
import { writeLog } from "../logger.js";
import type { ReminderMessage, ScheduledReminderMessage, SentBatch, SentBatchGroup, SentMessageRef, StoredGroup } from "../types.js";
import { messageContent } from "../message-format.js";
import { now } from "../utils.js";
import { nextOccurrence } from "./reminder.js";

// How often the bot looks for messages whose time has come.
const checkIntervalMs = 15_000;
// A message found this long after its time (the bot was off) is no longer worth sending.
const maxLateMs = 30 * 60 * 1000;

type MessageApi = Pick<API, "sendMessage">;

type MessageStore = Readonly<{
  getGroup(groupId: string): Promise<StoredGroup | undefined>;
  findDueReminderMessage(at: number): Promise<ScheduledReminderMessage | undefined>;
  claimReminderMessage(message: ScheduledReminderMessage, nextDueAt: number | null): Promise<boolean>;
  addSentBatchGroup?(id: string, batch: Omit<SentBatch, "id" | "groups">, group: SentBatchGroup): Promise<void>;
}>;

// Finds the second id of messages that were just sent; see OwnMessages.
export type SentResolver = Readonly<{ resolve(msgIds: readonly string[]): Promise<SentMessageRef[]> }>;
export const withoutClientIds: SentResolver = { resolve: (msgIds) => Promise.resolve(msgIds.map((msgId) => ({ msgId }))) };

const urgencyLevels = { important: Urgency.Important, urgent: Urgency.Urgent } as const;

// The ids Zalo answers a sent message with: one for the text, one for each picture or album.
function sentIds(response: Awaited<ReturnType<MessageApi["sendMessage"]>> | undefined): string[] {
  const results = [response?.message, ...(response?.attachment ?? [])];
  return results.map((result) => (result?.msgId === undefined ? "" : String(result.msgId))).filter((id) => id !== "");
}

// Posts a message, with its pictures when it has any, to a group. Several pictures go out as one album;
// Zalo then shows the text as a message of its own rather than as a caption.
// Returns the ids of the messages that went out, which is what taking them back needs.
export async function sendGroupMessage(api: MessageApi, groupId: string, message: ReminderMessage): Promise<string[]> {
  const images = message.images ?? [];
  const content = { ...messageContent(message.text), ...(message.urgency === undefined ? {} : { urgency: urgencyLevels[message.urgency] }) };
  if (images.length === 0) return sentIds(await api.sendMessage(content, groupId, ThreadType.Group));
  const attachments = images.map((image, index) => ({
    data: image.data,
    filename: `nhac-hen-${index + 1}.${image.extension}` as const,
    metadata: { totalSize: image.data.length, width: image.width, height: image.height },
  }));
  // A caption cannot carry styles, so a styled text goes out as a message of its own, before the pictures.
  if (content.styles !== undefined && content.msg !== "") {
    const text = sentIds(await api.sendMessage(content, groupId, ThreadType.Group));
    return [...text, ...sentIds(await api.sendMessage({ msg: "", attachments }, groupId, ThreadType.Group))];
  }
  return sentIds(await api.sendMessage({ ...content, attachments }, groupId, ThreadType.Group));
}

// Sends the messages that were asked to go out when a reminder's time comes. Unlike the reminder
// itself, which Zalo delivers, these only go out while the bot is running.
export class ReminderMessenger {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(
    private readonly api: MessageApi,
    private readonly store: MessageStore,
    private readonly activity: ActivityRecorder = noActivity,
    private readonly sent: SentResolver = withoutClientIds,
  ) {}

  public start(): void {
    this.timer ??= setInterval(() => void this.tick(), checkIntervalMs);
  }

  public stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // Sends everything that is due. A message is taken out of the queue (or moved to its next time, for a
  // repeating reminder) before it is sent, so it can never go out twice.
  public async tick(at = now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const message = await this.store.findDueReminderMessage(at);
        if (message === undefined) break;
        const nextDueAt = message.repeat === "none" ? null : nextOccurrence(message.startTime, message.repeat, at + 1);
        if (!await this.store.claimReminderMessage(message, nextDueAt)) continue;
        await this.deliver(message, at);
      }
    } catch (error: unknown) {
      writeLog("[REMINDER MESSAGE FAILED]", "red", { error: error instanceof Error ? error.message : String(error) }, "error");
    } finally {
      this.running = false;
    }
  }

  private async deliver(message: ScheduledReminderMessage, at: number): Promise<void> {
    const fields = { group: message.groupId, reminder: message.reminderId };
    const entry = {
      category: "messages",
      actor: "bot",
      title: message.reminderId === "" ? "Gửi tin nhắn hẹn giờ" : "Gửi tin nhắn khi đến giờ nhắc hẹn",
      detail: [message.title === "" ? "" : `Nhắc hẹn “${message.title}”`, previewText(message.text, message.images?.length ?? 0)].filter((part) => part !== "").join(": "),
      groupId: message.groupId,
    } as const;
    if (at - message.dueAt > maxLateMs) {
      writeLog("[REMINDER MESSAGE SKIPPED]", "yellow", { ...fields, reason: "bot was not running at the time" }, "warn");
      this.activity.record({ ...entry, ok: false, error: "Bỏ qua vì bot không chạy vào giờ hẹn" });
      return;
    }
    // A group the bot has since been switched off for is left alone.
    if ((await this.store.getGroup(message.groupId))?.botEnabled !== true) {
      writeLog("[REMINDER MESSAGE SKIPPED]", "yellow", { ...fields, reason: "bot is off for the group" }, "warn");
      this.activity.record({ ...entry, ok: false, error: "Bỏ qua vì bot đang tắt ở nhóm này" });
      return;
    }
    try {
      const messages = await this.sent.resolve(await sendGroupMessage(this.api, message.groupId, message));
      writeLog("[REMINDER MESSAGE SENT]", "green", fields);
      this.activity.record(entry);
      await this.file(message, { ok: true, messages });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      writeLog("[REMINDER MESSAGE FAILED]", "red", { ...fields, error: reason }, "error");
      this.activity.record({ ...entry, ok: false, error: reason });
      await this.file(message, { ok: false, error: reason, messages: [] });
    }
  }

  // A message scheduled from the bulk messaging page is filed with the others of its round, so the
  // round shows among the sent messages and can be taken back. Each time a repeating one comes
  // round is a round of its own.
  private async file(message: ScheduledReminderMessage, outcome: Pick<SentBatchGroup, "ok" | "error" | "messages">): Promise<void> {
    if (message.batchId === undefined || this.store.addSentBatchGroup === undefined) return;
    try {
      const group = await this.store.getGroup(message.groupId);
      await this.store.addSentBatchGroup(
        `${message.batchId}:${message.dueAt}`,
        { createdAt: now(), text: message.text, imageCount: message.images?.length ?? 0, ...(message.urgency === undefined ? {} : { urgency: message.urgency }), scheduled: true },
        { groupId: message.groupId, groupName: group?.name ?? "", ...outcome },
      );
    } catch (error: unknown) {
      writeLog("[SENT BATCH NOT SAVED]", "red", { group: message.groupId, error: error instanceof Error ? error.message : String(error) }, "error");
    }
  }
}
