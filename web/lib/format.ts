const locale = "vi-VN";
const numberFormat = new Intl.NumberFormat(locale);
const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" });
const longDayFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "numeric" });
const clockFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
const fullDayFormat = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });
const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatDateTime(timestamp: number): string {
  return dateTimeFormat.format(timestamp);
}

// "2026-10-12" → "12/10" (short) or "Thứ Hai, 12/10" (long), without shifting across time zones.
export function formatDay(isoDate: string, style: "short" | "long" = "short"): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return (style === "short" ? dayFormat : longDayFormat).format(new Date(year, month - 1, day));
}

// "09:30"
export function formatClock(timestamp: number): string {
  return clockFormat.format(timestamp);
}

// "2026-10-12T09:30", the value a datetime-local field takes, in the viewer's time zone.
export function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  return `${localDayKey(timestamp)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// "Hôm nay lúc 08:15", "Ngày mai lúc 09:00", or the full day for anything further away.
export function formatFriendlyDateTime(timestamp: number, now: number): string {
  const day = localDayKey(timestamp);
  const prefix = day === localDayKey(now) ? "Hôm nay" : day === localDayKey(now + 86_400_000) ? "Ngày mai" : formatFullDay(timestamp);
  return `${prefix} lúc ${formatClock(timestamp)}`;
}

// "Thứ Hai, 12/10/2026"
export function formatFullDay(timestamp: number): string {
  return fullDayFormat.format(timestamp);
}

// The calendar day a moment falls on in the viewer's time zone, as "2026-10-12".
export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Lower case without Vietnamese diacritics, so "nhom ban hang" finds "Nhóm bán hàng".
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/giu, "d").toLowerCase();
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const steps: readonly [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "vừa xong";
}

export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  if (minutes > 0) return `${minutes} phút ${seconds} giây`;
  return `${seconds} giây`;
}

export const windowUnits: readonly { seconds: number; label: string }[] = [
  { seconds: 86_400, label: "ngày" },
  { seconds: 3_600, label: "giờ" },
  { seconds: 60, label: "phút" },
  { seconds: 1, label: "giây" },
];

// Splits a window into an amount and the largest unit that divides it evenly: 600 → 10 phút.
export function splitWindow(windowSeconds: number): { amount: number; unitSeconds: number } {
  const unit = windowUnits.find((item) => windowSeconds % item.seconds === 0) ?? { seconds: 1 };
  return { amount: windowSeconds / unit.seconds, unitSeconds: unit.seconds };
}

export function formatWindow(windowSeconds: number): string {
  const { amount, unitSeconds } = splitWindow(windowSeconds);
  const label = windowUnits.find((item) => item.seconds === unitSeconds)?.label ?? "giây";
  return `${amount} ${label}`;
}

// "3 lần/10 giây" for a feature that kicks, or "không kick".
export function formatKickRule(rule: { enabled: boolean; count: number; windowSeconds: number }, canKick = true): string {
  return rule.enabled && canKick ? `kick khi đủ ${rule.count} lần/${formatWindow(rule.windowSeconds)}` : "không kick";
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
