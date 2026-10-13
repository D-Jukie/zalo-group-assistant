import { ThreadType, type API } from "zca-js";
import { writeLog } from "../logger.js";
import type { ReminderMessage, ScheduledReminderMessage, StoredGroup } from "../types.js";
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

// Posts a message, with its picture when it has one, to a group.
export async function sendGroupMessage(api: MessageApi, groupId: string, message: ReminderMessage): Promise<void> {
  const { image } = message;
  if (image === undefined) {
    await api.sendMessage({ msg: message.text }, groupId, ThreadType.Group);
    return;
  }
  const attachment = { data: image.data, filename: `nhac-hen.${image.extension}` as const, metadata: { totalSize: image.data.length, width: image.width, height: image.height } };
  await api.sendMessage({ msg: message.text, attachments: [attachment] }, groupId, ThreadType.Group);
}

// Sends the messages that were asked to go out when a reminder's time comes. Unlike the reminder
// itself, which Zalo delivers, these only go out while the bot is running.
export class ReminderMessenger {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(
    private readonly api: MessageApi,
    private readonly store: MessageStore,
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
    if (at - message.dueAt > maxLateMs) {
      writeLog("[REMINDER MESSAGE SKIPPED]", "yellow", { ...fields, reason: "bot was not running at the time" }, "warn");
      return;
    }
    // A group the bot has since been switched off for is left alone.
    if ((await this.store.getGroup(message.groupId))?.botEnabled !== true) {
      writeLog("[REMINDER MESSAGE SKIPPED]", "yellow", { ...fields, reason: "bot is off for the group" }, "warn");
      return;
    }
    try {
      await sendGroupMessage(this.api, message.groupId, message);
      writeLog("[REMINDER MESSAGE SENT]", "green", fields);
    } catch (error: unknown) {
      writeLog("[REMINDER MESSAGE FAILED]", "red", { ...fields, error: error instanceof Error ? error.message : String(error) }, "error");
    }
  }
}
