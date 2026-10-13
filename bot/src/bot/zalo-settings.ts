import type { GroupSetting, UpdateGroupSettingsOptions } from "zca-js";
import { isRecord } from "../utils.js";

// The settings Zalo itself keeps for a group, as opposed to the bot's own switches for it. These are
// the ones the dashboard shows; each is a plain on or off.
export const zaloSettingKeys = ["lockSendMsg", "joinAppr", "blockName", "signAdminMsg", "enableMsgHistory", "setTopicOnly", "lockCreatePost", "lockCreatePoll"] as const;
export type ZaloSettingKey = (typeof zaloSettingKeys)[number];
export type ZaloGroupSettings = Readonly<Record<ZaloSettingKey, boolean>>;

// What each setting is called in the history.
export const zaloSettingNames: Readonly<Record<ZaloSettingKey, string>> = {
  lockSendMsg: "chỉ trưởng và phó nhóm được nhắn tin",
  joinAppr: "duyệt thành viên mới",
  blockName: "khóa đổi tên và ảnh nhóm",
  signAdminMsg: "đánh dấu tin của trưởng và phó nhóm",
  enableMsgHistory: "thành viên mới đọc được tin gần đây",
  setTopicOnly: "chỉ trưởng và phó nhóm được ghim",
  lockCreatePost: "khóa tạo ghi chú và nhắc hẹn",
  lockCreatePoll: "khóa tạo bình chọn",
};

export function readZaloSettings(setting: GroupSetting): ZaloGroupSettings {
  return Object.fromEntries(zaloSettingKeys.map((key) => [key, setting[key] === 1])) as Record<ZaloSettingKey, boolean>;
}

// Reads a change from the dashboard: one or more of the settings above, each true or false, and nothing else.
export function parseZaloSettingsChange(body: unknown): Partial<ZaloGroupSettings> | undefined {
  if (!isRecord(body)) return undefined;
  const entries = Object.entries(body);
  if (entries.length === 0) return undefined;
  const change: Partial<Record<ZaloSettingKey, boolean>> = {};
  for (const [name, value] of entries) {
    const key = zaloSettingKeys.find((item) => item === name);
    if (key === undefined || typeof value !== "boolean") return undefined;
    change[key] = value;
  }
  return change;
}

// Zalo takes a group's settings all at once: any that is left out is switched off. So a change is
// sent together with everything the group has now.
export function settingsUpdate(current: GroupSetting, change: Partial<ZaloGroupSettings>): UpdateGroupSettingsOptions {
  return { ...readZaloSettings(current), lockViewMember: current.lockViewMember === 1, ...change };
}

// A change as the history tells it: "Bật duyệt thành viên mới, tắt khóa tạo bình chọn".
export function describeSettingsChange(change: Partial<ZaloGroupSettings>): string {
  const parts = zaloSettingKeys.filter((key) => change[key] !== undefined).map((key) => `${change[key] === true ? "bật" : "tắt"} ${zaloSettingNames[key]}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A group's invite link as Zalo reports it. `expiresAt` is in milliseconds, absent when the link does not expire.
export type InviteLink = Readonly<{ enabled: boolean; link?: string; expiresAt?: number }>;

export function readInviteLink(detail: Readonly<{ enabled: number; link?: string; expiration_date?: number }>): InviteLink {
  const enabled = detail.enabled === 1 && typeof detail.link === "string" && detail.link !== "";
  if (!enabled) return { enabled: false };
  const expiry = detail.expiration_date ?? 0;
  // Zalo gives the time in seconds; a value already in milliseconds is taken as it is.
  const expiresAt = expiry <= 0 ? undefined : expiry < 1e12 ? expiry * 1000 : expiry;
  return { enabled: true, link: detail.link, ...(expiresAt === undefined ? {} : { expiresAt }) };
}
