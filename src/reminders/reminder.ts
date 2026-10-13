import { reminderRepeats, type GroupReminder, type MessageImage, type NewReminder, type ReminderMessage, type ReminderMessageEdit, type ReminderRepeat } from "../types.js";
import { asNumber, asString, isRecord, uniqueStrings } from "../utils.js";
import { readImageInfo } from "./image-size.js";

export const maxReminderTitleLength = 200;
export const maxReminderGroups = 100;
export const maxMessageLength = 2000;
export const maxImageBytes = 5 * 1024 * 1024;

const dayMs = 24 * 60 * 60 * 1000;

// A reminder as Zalo describes it, before the parts that depend on the current time are worked out.
export type BoardReminder = Omit<GroupReminder, "nextTime" | "dueMessage">;

export type ReminderRequest = NewReminder & Readonly<{ groupIds: readonly string[] }>;

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

// Reads a change to a waiting message: { text, image?: { data: <base64> } | null }. Whether the result
// still has text or a picture can only be judged against the stored message, so that is checked there.
export function parseReminderMessageEdit(body: unknown): ReminderMessageEdit | string {
  if (!isRecord(body) || typeof body.text !== "string") return "Tin nhắn không hợp lệ";
  const text = body.text.trim();
  if (text.length > maxMessageLength) return `Tin nhắn dài tối đa ${maxMessageLength} ký tự`;
  if (body.image === undefined) return { text };
  if (body.image === null) return { text, image: null };
  const image = parseMessageImage(body.image);
  return typeof image === "string" ? image : { text, image };
}

// Reads one of the optional messages of a reminder request: { text, image?: { data: <base64> } }.
// Returns the message, undefined when none was asked for, or the reason it is not acceptable.
export function parseReminderMessage(value: unknown): ReminderMessage | undefined | string {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return "Tin nhắn không hợp lệ";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text.length > maxMessageLength) return `Tin nhắn dài tối đa ${maxMessageLength} ký tự`;
  if (value.image === undefined || value.image === null) return text === "" ? "Tin nhắn cần có nội dung hoặc ảnh" : { text };
  const image = parseMessageImage(value.image);
  return typeof image === "string" ? image : { text, image };
}

// Checks what the dashboard sent for a new reminder. Returns the request, or the reason it is not acceptable.
export function parseReminderRequest(body: unknown, at: number): ReminderRequest | string {
  if (!isRecord(body)) return "Thiếu nội dung nhắc hẹn";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > maxReminderTitleLength) return `Nội dung phải dài từ 1 đến ${maxReminderTitleLength} ký tự`;
  const startTime = body.startTime;
  if (typeof startTime !== "number" || !Number.isSafeInteger(startTime)) return "Thời gian nhắc không hợp lệ";
  if (startTime <= at) return "Thời gian nhắc phải ở tương lai";
  const repeat = reminderRepeats.find((item) => item === body.repeat);
  if (repeat === undefined) return "Kiểu lặp lại không hợp lệ";
  const rawGroupIds: unknown = body.groupIds;
  if (!Array.isArray(rawGroupIds) || !rawGroupIds.every((item): item is string => typeof item === "string")) return "Danh sách nhóm không hợp lệ";
  const groupIds = uniqueStrings(rawGroupIds);
  if (groupIds.length === 0) return "Hãy chọn ít nhất một nhóm";
  if (groupIds.length > maxReminderGroups) return `Mỗi lần chỉ tạo được cho tối đa ${maxReminderGroups} nhóm`;
  const onCreate = parseReminderMessage(body.onCreate);
  if (typeof onCreate === "string") return `Tin nhắn khi tạo: ${onCreate}`;
  const onDue = parseReminderMessage(body.onDue);
  if (typeof onDue === "string") return `Tin nhắn khi đến giờ: ${onDue}`;
  return { title, startTime, repeat, groupIds, ...(onCreate === undefined ? {} : { onCreate }), ...(onDue === undefined ? {} : { onDue }) };
}
