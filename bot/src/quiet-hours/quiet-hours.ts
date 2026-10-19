import type { QuietHoursSettings } from "../types.js";
import { isRecord } from "../utils.js";

const minutesPerDay = 24 * 60;

// "23:00" for 1380 minutes after midnight.
export function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// Minutes after midnight from "HH:MM", as a time field gives it; undefined for anything else.
export function parseClock(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

// Checks a request to change a group's quiet hours: { enabled, start: "HH:MM", end: "HH:MM" }.
export function parseQuietHours(body: unknown): QuietHoursSettings | string {
  if (!isRecord(body) || typeof body.enabled !== "boolean") return "Cài đặt giờ yên lặng không hợp lệ";
  const start = parseClock(body.start);
  const end = parseClock(body.end);
  if (start === undefined || end === undefined) return "Giờ bắt đầu và giờ kết thúc phải có dạng HH:MM";
  if (start === end) return "Giờ bắt đầu và giờ kết thúc phải khác nhau";
  return { enabled: body.enabled, start, end };
}

// "23:00 – 06:00 hôm sau" or "12:00 – 13:30".
export function describeQuietHours(settings: Pick<QuietHoursSettings, "start" | "end">): string {
  return `${formatClock(settings.start)} – ${formatClock(settings.end)}${settings.end < settings.start ? " hôm sau" : ""}`;
}

// A local day as "2026-10-19".
function dayKey(year: number, month: number, day: number): string {
  const date = new Date(year, month, day);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// The quiet hours the moment falls in, named by the local day they began on, or undefined outside
// them. Hours that run past midnight began the day before for a moment after midnight.
export function quietWindow(settings: Pick<QuietHoursSettings, "start" | "end">, at: Date): string | undefined {
  const { start, end } = settings;
  if (start === end) return undefined;
  const minute = (at.getHours() * 60 + at.getMinutes()) % minutesPerDay;
  const today = dayKey(at.getFullYear(), at.getMonth(), at.getDate());
  if (start < end) return minute >= start && minute < end ? today : undefined;
  if (minute >= start) return today;
  return minute < end ? dayKey(at.getFullYear(), at.getMonth(), at.getDate() - 1) : undefined;
}
