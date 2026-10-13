import type { Mention, Style } from "zca-js";
import { formatMessage } from "../message-format.js";
import { maxMessageLength, messageText } from "../reminders/reminder.js";
import type { GroupWelcomeSettings } from "../types.js";
import { isRecord } from "../utils.js";

// How many newcomers one welcome names; the rest are counted.
export const maxWelcomeNames = 20;

// What an admin writes into the welcome and what it becomes:
//   {name}     the newcomers, each tagged
//   {nameCom}  the group's name
//   {count}    how many members the group has
// Inside the text they are stood in for by characters nobody types, so that a name which happens to
// look like a formatting tag is never read as one.
const nameMark = "";
const groupMark = "";
const marks = /[]/gu;

export type Newcomer = Readonly<{ userId: string; name: string }>;

export type WelcomeMessage = Readonly<{ msg: string; styles?: Style[]; mentions?: Mention[] }>;

// Checks a group's welcome as the dashboard sends it: { enabled, text }. The text may be kept while
// the welcome is off, but it cannot be switched on with nothing to say.
export function parseWelcomeSettings(body: unknown): GroupWelcomeSettings | string {
  if (!isRecord(body) || typeof body.enabled !== "boolean" || typeof body.text !== "string") return "Cài đặt lời chào không hợp lệ";
  const text = messageText(body.text.replace(marks, ""));
  if (text.length > maxMessageLength) return `Lời chào dài tối đa ${maxMessageLength} ký tự`;
  if (body.enabled && text === "") return "Hãy nhập lời chào trước khi bật";
  return { enabled: body.enabled, text };
}

// The newcomers as the welcome names them: "@An, @Bình", and how many more when there are too many to list.
function nameList(members: readonly Newcomer[], at: number): Readonly<{ text: string; mentions: Mention[] }> {
  let text = "";
  const mentions: Mention[] = [];
  const shown = members.slice(0, maxWelcomeNames);
  shown.forEach((member, index) => {
    if (index > 0) text += ", ";
    const tag = `@${member.name || "bạn"}`;
    mentions.push({ pos: at + text.length, uid: member.userId, len: tag.length });
    text += tag;
  });
  const more = members.length - shown.length;
  if (more > 0) text += ` và ${more.toLocaleString("vi-VN")} thành viên khác`;
  return { text, mentions };
}

// Turns a group's welcome into what Zalo sends for the given newcomers: the variables filled in, the
// newcomers tagged, and the editor's formatting tags turned into styles.
export function welcomeMessage(template: string, members: readonly Newcomer[], groupName: string, memberCount: number): WelcomeMessage {
  const raw = template.replace(marks, "").replaceAll("{nameCom}", groupMark).replaceAll("{name}", nameMark).replaceAll("{count}", memberCount.toLocaleString("vi-VN"));
  const formatted = formatMessage(raw);
  let msg = "";
  const mentions: Mention[] = [];
  // Where each position of the formatted text ends up once the variables are written out.
  const moved: number[] = [];
  for (const character of Array.from({ length: formatted.msg.length }, (_item, index) => formatted.msg.charAt(index))) {
    moved.push(msg.length);
    if (character === nameMark) {
      const names = nameList(members, msg.length);
      mentions.push(...names.mentions);
      msg += names.text;
    } else if (character === groupMark) {
      msg += groupName;
    } else {
      msg += character;
    }
  }
  moved.push(msg.length);
  const at = (position: number): number => moved[position] ?? msg.length;
  const styles = formatted.styles.map((style) => ({ ...style, start: at(style.start), len: at(style.start + style.len) - at(style.start) })).filter((style) => style.len > 0);
  // "@All" from the editor keeps working next to the newcomers' own tags.
  for (const mention of formatted.mentions) mentions.push({ ...mention, pos: at(mention.pos) });
  mentions.sort((left, right) => left.pos - right.pos);
  return { msg, ...(styles.length === 0 ? {} : { styles }), ...(mentions.length === 0 ? {} : { mentions }) };
}
