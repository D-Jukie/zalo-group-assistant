import { maxMessageImages, reminderRepeats, type GroupReminder, type MessageImage, type NewReminder, type ReminderMessage, type ReminderMessageEdit, type ReminderRepeat } from "../types.js";
import { asNumber, asString, isRecord, uniqueStrings } from "../utils.js";
import { readImageInfo } from "./image-size.js";

export const maxReminderTitleLength = 200;
export const maxReminderGroups = 100;
export const maxMessageLength = 2000;
export const maxImageBytes = 5 * 1024 * 1024;
// All the pictures of one message together. A queued message is one MongoDB document, which holds 16 MB.
export const maxMessageImagesBytes = 12 * 1024 * 1024;

const dayMs = 24 * 60 * 60 * 1000;

// A reminder as Zalo describes it, before the parts that depend on the current time are worked out.
export type BoardReminder = Omit<GroupReminder, "nextTime" | "dueMessage">;

export type ReminderRequest = NewReminder & Readonly<{ groupIds: readonly string[] }>;

// A message of the bot's own for several groups, with no reminder behind it: sent at once, or at a set time.
export type MessageRequest = Readonly<{ message: ReminderMessage; groupIds: readonly string[] }> & (
  | Readonly<{ sendNow: true }>
  | Readonly<{ sendNow: false; startTime: number; repeat: ReminderRepeat }>
);

type Schedule = Readonly<{ startTime: number; repeat: ReminderRepeat; groupIds: readonly string[] }>;

// Zalo sends the title inside "params", sometimes as an object and sometimes as JSON text.
function readTitle(params: unknown): string {
  let value = params;
  if (typeof params === "string") {
    try {
      value = JSON.parse(params) as unknown;
    } catch {
      return params;
    }
  }
  return isRecord(value) ? asString(value.title) ?? "" : "";
}

function readCount(value: unknown): number {
  const count = asNumber(value) ?? 0;
  return count > 0 ? Math.floor(count) : 0;
}

// Turns one entry of a group's board into a reminder, or undefined when it has no ID or start time.
export function parseBoardReminder(raw: unknown, group: Readonly<{ groupId: string; name: string }>, ownId: string): BoardReminder | undefined {
  if (!isRecord(raw)) return undefined;
  const reminderId = asString(raw.id) ?? asString(raw.reminderId) ?? asString(raw.topicId);
  const startTime = asNumber(raw.startTime);
  if (reminderId === undefined || reminderId === "" || startTime === undefined || startTime <= 0) return undefined;
  const creatorId = asString(raw.creatorId) ?? asString(raw.creatorUid) ?? "";
  const responses = isRecord(raw.responseMem) ? raw.responseMem : {};
  return {
    reminderId,
    groupId: group.groupId,
    groupName: group.name,
    title: readTitle(raw.params),
    emoji: asString(raw.emoji) ?? "",
    startTime,
    repeat: reminderRepeats[asNumber(raw.repeat) ?? 0] ?? "none",
    creatorId,
    createdByBot: creatorId === ownId,
    createdAt: asNumber(raw.createTime) ?? 0,
    accepted: readCount(responses.acceptMember),
    rejected: readCount(responses.rejectMember),
  };
}

// The same clock time `months` months after `start`; a day the month does not have becomes its last day.
function addMonths(start: Date, months: number): number {
  const first = new Date(start.getFullYear(), start.getMonth() + months, 1, start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(start.getDate(), lastDay));
  return first.getTime();
}

// When a reminder goes off next, counted from `at`. A reminder that does not repeat has none once it has passed.
export function nextOccurrence(startTime: number, repeat: ReminderRepeat, at: number): number | null {
  if (startTime >= at) return startTime;
  if (repeat === "none") return null;
  if (repeat === "monthly") {
    const start = new Date(startTime);
    const current = new Date(at);
    let months = (current.getFullYear() - start.getFullYear()) * 12 + current.getMonth() - start.getMonth();
    while (addMonths(start, months) < at) months += 1;
    return addMonths(start, months);
  }
  const step = repeat === "daily" ? dayMs : 7 * dayMs;
  return startTime + Math.ceil((at - startTime) / step) * step;
}

// Upcoming reminders first, soonest at the top; then the ones that have passed, most recent first.
export function sortReminders(reminders: readonly GroupReminder[]): GroupReminder[] {
  return [...reminders].sort((left, right) => {
    if (left.nextTime !== null && right.nextTime !== null) return left.nextTime - right.nextTime;
    if (left.nextTime !== null) return -1;
    if (right.nextTime !== null) return 1;
    return right.startTime - left.startTime;
  });
}

// Reads a picture sent as { data: <base64> }. Returns the picture, or the reason it is not acceptable.
function parseMessageImage(value: unknown): MessageImage | string {
  const encoded = isRecord(value) ? value.data : undefined;
  if (typeof encoded !== "string" || encoded === "") return "Ảnh không hợp lệ";
  const data = Buffer.from(encoded, "base64");
  if (data.length > maxImageBytes) return "Ảnh lớn tối đa 5 MB";
  const info = readImageInfo(data);
  return info === undefined ? "Ảnh phải là JPEG, PNG hoặc WebP" : { data, ...info };
}

// Reads the pictures of a message: at most maxMessageImages of them, each read by `parseItem`.
function parseImageList<T>(value: unknown, parseItem: (item: unknown) => T | string): T[] | string {
  if (!Array.isArray(value)) return "Danh sách ảnh không hợp lệ";
  if (value.length > maxMessageImages) return `Mỗi tin nhắn tối đa ${maxMessageImages} ảnh`;
  const images: T[] = [];
  for (const item of value as unknown[]) {
    const image = parseItem(item);
    if (typeof image === "string") return image;
    images.push(image);
  }
  return images;
}

export function totalImageBytes(images: readonly Readonly<{ data: { length: number } }>[]): number {
  return images.reduce((sum, image) => sum + image.data.length, 0);
}

const tooHeavy = "Tổng dung lượng ảnh của một tin tối đa 12 MB";

// Reads a change to a waiting message: { text, images?: ({ data: <base64> } | { keep: <position> })[] }.
// Whether the result still has text or a picture, and what "keep" refers to, can only be judged
// against the stored message, so that is checked there.
export function parseReminderMessageEdit(body: unknown): ReminderMessageEdit | string {
  if (!isRecord(body) || typeof body.text !== "string") return "Tin nhắn không hợp lệ";
  const text = body.text.trim();
  if (text.length > maxMessageLength) return `Tin nhắn dài tối đa ${maxMessageLength} ký tự`;
  if (body.images === undefined) return { text };
  const images = parseImageList(body.images, (item): MessageImage | Readonly<{ keep: number }> | string => {
    const keep = isRecord(item) ? item.keep : undefined;
    return typeof keep === "number" && Number.isInteger(keep) && keep >= 0 ? { keep } : parseMessageImage(item);
  });
  return typeof images === "string" ? images : { text, images };
}

// Reads one of the optional messages of a reminder request: { text, images?: { data: <base64> }[] }.
// Returns the message, undefined when none was asked for, or the reason it is not acceptable.
export function parseReminderMessage(value: unknown): ReminderMessage | undefined | string {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return "Tin nhắn không hợp lệ";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text.length > maxMessageLength) return `Tin nhắn dài tối đa ${maxMessageLength} ký tự`;
  const images = value.images === undefined || value.images === null ? [] : parseImageList(value.images, parseMessageImage);
  if (typeof images === "string") return images;
  if (totalImageBytes(images) > maxMessageImagesBytes) return tooHeavy;
  if (images.length === 0) return text === "" ? "Tin nhắn cần có nội dung hoặc ảnh" : { text };
  return { text, images };
}

// The groups a request is for: at least one, each named once.
function parseGroupIds(rawGroupIds: unknown): readonly string[] | string {
  if (!Array.isArray(rawGroupIds) || !rawGroupIds.every((item): item is string => typeof item === "string")) return "Danh sách nhóm không hợp lệ";
  const groupIds = uniqueStrings(rawGroupIds);
  if (groupIds.length === 0) return "Hãy chọn ít nhất một nhóm";
  if (groupIds.length > maxReminderGroups) return `Mỗi lần chỉ chọn được tối đa ${maxReminderGroups} nhóm`;
  return groupIds;
}

// The part every scheduling request shares: when, how often and for which groups.
function parseSchedule(body: Record<string, unknown>, at: number, what: string): Schedule | string {
  const startTime = body.startTime;
  if (typeof startTime !== "number" || !Number.isSafeInteger(startTime)) return `Thời gian ${what} không hợp lệ`;
  if (startTime <= at) return `Thời gian ${what} phải ở tương lai`;
  const repeat = reminderRepeats.find((item) => item === body.repeat);
  if (repeat === undefined) return "Kiểu lặp lại không hợp lệ";
  const groupIds = parseGroupIds(body.groupIds);
  return typeof groupIds === "string" ? groupIds : { startTime, repeat, groupIds };
}

// Checks what the dashboard sent for a new reminder. Returns the request, or the reason it is not acceptable.
export function parseReminderRequest(body: unknown, at: number): ReminderRequest | string {
  if (!isRecord(body)) return "Thiếu nội dung nhắc hẹn";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > maxReminderTitleLength) return `Nội dung phải dài từ 1 đến ${maxReminderTitleLength} ký tự`;
  const schedule = parseSchedule(body, at, "nhắc");
  if (typeof schedule === "string") return schedule;
  const onCreate = parseReminderMessage(body.onCreate);
  if (typeof onCreate === "string") return `Tin nhắn khi tạo: ${onCreate}`;
  const onDue = parseReminderMessage(body.onDue);
  if (typeof onDue === "string") return `Tin nhắn khi đến giờ: ${onDue}`;
  return { title, ...schedule, ...(onCreate === undefined ? {} : { onCreate }), ...(onDue === undefined ? {} : { onDue }) };
}

// Checks a request to send a message to several groups: { message, groupIds } with either
// sendNow: true, or startTime and repeat for a message that waits for its time.
export function parseMessageRequest(body: unknown, at: number): MessageRequest | string {
  if (!isRecord(body)) return "Thiếu nội dung tin nhắn";
  const message = parseReminderMessage(body.message);
  if (message === undefined) return "Thiếu nội dung tin nhắn";
  if (typeof message === "string") return message;
  if (body.sendNow === true) {
    const groupIds = parseGroupIds(body.groupIds);
    return typeof groupIds === "string" ? groupIds : { message, groupIds, sendNow: true };
  }
  const schedule = parseSchedule(body, at, "gửi");
  return typeof schedule === "string" ? schedule : { message, ...schedule, sendNow: false };
}
