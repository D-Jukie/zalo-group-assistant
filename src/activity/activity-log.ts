import { writeLog } from "../logger.js";
import { activityActors, activityCategories, type ActivityCategory, type ActivityFilter, type NewActivity, type StoredGroup } from "../types.js";

const maxTitleLength = 120;
const maxDetailLength = 500;
const maxPreviewLength = 120;

// Where something the bot or an admin did is written down. Recording never throws and never makes
// the caller wait: the log must not get in the way of the action it describes.
export type ActivityRecorder = Readonly<{ record(entry: NewActivity): void }>;

// For the places that work without a log, such as tests.
export const noActivity: ActivityRecorder = { record: () => undefined };

export type ActivityStore = Readonly<{
  getGroup(groupId: string): Promise<StoredGroup | undefined>;
  addActivity(entry: Required<NewActivity>): Promise<void>;
}>;

// The start of a message, on one line, for the detail of an entry.
export function previewText(text: string, imageCount = 0): string {
  const line = text.replace(/\s+/gu, " ").trim();
  const short = line.length > maxPreviewLength ? `${line.slice(0, maxPreviewLength)}…` : line;
  const images = imageCount > 0 ? `${imageCount} ảnh` : "";
  return [short === "" ? "" : `“${short}”`, images].filter((part) => part !== "").join(" + ");
}

const timeFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

// A time as the detail of an entry says it: "09:00 14/10/2026".
export function formatLogTime(timestamp: number): string {
  return timeFormat.format(timestamp);
}

// The history of what the bot did by itself and what admins did from the dashboard.
export class ActivityLog implements ActivityRecorder {
  public constructor(private readonly store: ActivityStore) {}

  public record(entry: NewActivity): void {
    void this.write(entry);
  }

  // Waits until the entry is saved. `record` is the same without the wait.
  public async write(entry: NewActivity): Promise<void> {
    try {
      const groupId = entry.groupId ?? "";
      // The group's name is kept with the entry, so the history still reads well after the group is gone.
      const groupName = entry.groupName ?? (groupId === "" ? "" : (await this.store.getGroup(groupId))?.name ?? "");
      await this.store.addActivity({
        category: entry.category,
        actor: entry.actor,
        title: entry.title.slice(0, maxTitleLength),
        detail: (entry.detail ?? "").slice(0, maxDetailLength),
        ok: entry.ok ?? true,
        error: (entry.error ?? "").slice(0, maxDetailLength),
        groupId,
        groupName,
        userId: entry.userId ?? "",
        userName: entry.userName ?? "",
      });
    } catch (error: unknown) {
      writeLog("[ACTIVITY LOG FAILED]", "red", { title: entry.title, error: error instanceof Error ? error.message : String(error) }, "error");
    }
  }
}

function timestamp(value: unknown): number | undefined {
  const number = Number(value);
  return typeof value === "string" && value !== "" && Number.isFinite(number) && number > 0 ? number : undefined;
}

// Where a page of the history continues from: the time and ID of the last entry already shown, as "<at>_<id>".
export function parseActivityCursor(value: unknown): Readonly<{ at: number; id: string }> | undefined {
  if (typeof value !== "string") return undefined;
  const found = /^(\d{1,16})_([0-9a-f]{24})$/u.exec(value);
  return found === null ? undefined : { at: Number(found[1]), id: found[2] ?? "" };
}

// The filters of the history as they arrive in a request's query. Anything unreadable is left out.
export function parseActivityFilter(query: Readonly<Record<string, unknown>>, maxTextLength: number): ActivityFilter {
  const text = typeof query.q === "string" ? query.q.slice(0, maxTextLength).trim() : "";
  const category = activityCategories.find((item: ActivityCategory) => item === query.category);
  const actor = activityActors.find((item) => item === query.actor);
  const ok = query.result === "ok" ? true : query.result === "failed" ? false : undefined;
  const groupId = typeof query.groupId === "string" && query.groupId !== "" ? query.groupId.slice(0, maxTextLength) : undefined;
  const from = timestamp(query.from);
  const to = timestamp(query.to);
  return {
    ...(text === "" ? {} : { text }),
    ...(category === undefined ? {} : { category }),
    ...(actor === undefined ? {} : { actor }),
    ...(ok === undefined ? {} : { ok }),
    ...(groupId === undefined ? {} : { groupId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}
