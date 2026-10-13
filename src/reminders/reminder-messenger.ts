import { ThreadType, type API } from "zca-js";
import { noActivity, previewText, type ActivityRecorder } from "../activity/activity-log.js";
import { writeLog } from "../logger.js";
import type { ReminderMessage, ScheduledReminderMessage, StoredGroup } from "../types.js";
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
}>;

// Posts a message, with its pictures when it has any, to a group. Several pictures go out as one album;
// Zalo then shows the text as a message of its own rather than as a caption.
export async function sendGroupMessage(api: MessageApi, groupId: string, message: ReminderMessage): Promise<void> {
  const images = message.images ?? [];
  const content = messageContent(message.text);
  if (images.length === 0) {
    await api.sendMessage(content, groupId, ThreadType.Group);
    return;
  }
  const attachments = images.map((image, index) => ({
    data: image.data,
    filename: `nhac-hen-${index + 1}.${image.extension}` as const,
    metadata: { totalSize: image.data.length, width: image.width, height: image.height },
  }));
  // A caption cannot carry styles, so a styled text goes out as a message of its own, before the pictures.
  if (content.styles !== undefined && content.msg !== "") {
    await api.sendMessage(content, groupId, ThreadType.Group);
    await api.sendMessage({ msg: "", attachments }, groupId, ThreadType.Group);
    return;
  }
  await api.sendMessage({ ...content, attachments }, groupId, ThreadType.Group);
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
      await sendGroupMessage(this.api, message.groupId, message);
      writeLog("[REMINDER MESSAGE SENT]", "green", fields);
      this.activity.record(entry);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      writeLog("[REMINDER MESSAGE FAILED]", "red", { ...fields, error: reason }, "error");
      this.activity.record({ ...entry, ok: false, error: reason });
    }
  }
}
