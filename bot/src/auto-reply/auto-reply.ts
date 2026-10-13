import { maxMessageImages, type AutoReplyDraft, type AutoReplyKind, type AutoReplyMatch, type AutoReplyRule, type MessageImage } from "../types.js";
import { isRecord, uniqueStrings } from "../utils.js";
import { readImageInfo } from "../reminders/image-size.js";
import { maxImageBytes, maxMessageImagesBytes, maxMessageLength, messageText, totalImageBytes } from "../reminders/reminder.js";

export const maxTriggers = 10;
export const maxTriggerLength = 60;
export const maxAutoReplyGroups = 200;
export const maxCooldownSeconds = 3600;
export const defaultCooldownSeconds = 10;

const kinds: readonly AutoReplyKind[] = ["keyword", "command"];
const matches: readonly AutoReplyMatch[] = ["exact", "contains"];

// Lower case with single spaces, in the composed form, so the same words always compare equal.
function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

// Without Vietnamese accents: "hướng dẫn" → "huong dan".
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").normalize("NFC");
}

// A trigger as it is stored: a keyword in lower case, or a command as "/name" without spaces.
// Undefined when nothing usable is left.
export function normalizeTrigger(input: string, kind: AutoReplyKind): string | undefined {
  const text = normalize(input);
  if (kind === "command") {
    const name = text.replace(/^\/+/u, "");
    return /^[\p{L}\p{N}_-]{1,30}$/u.test(name) ? `/${name}` : undefined;
  }
  return text.length >= 1 && text.length <= maxTriggerLength ? text : undefined;
}

// Whether `needle` stands in `text` as whole words: "giá" is in "báo giá nhé" but not in "giám đốc".
function containsWords(text: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index < 0) return false;
    const before = text.slice(0, index).at(-1) ?? " ";
    const after = text.charAt(index + needle.length) || " ";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = index + 1;
  }
}

// Whether a message sets off a trigger. A trigger typed without accents also answers the accented
// spelling ("huong dan" answers "hướng dẫn"); one typed with accents asks for exactly those.
function triggerMatches(message: string, trigger: string, rule: Pick<AutoReplyRule, "kind" | "match">): boolean {
  const accentFree = fold(trigger) === trigger;
  const text = accentFree ? fold(message) : message;
  // A command is the first word of the message; anything after it is ignored.
  if (rule.kind === "command") return (text.split(" ")[0] ?? "") === trigger;
  return rule.match === "exact" ? text === trigger : containsWords(text, trigger);
}

// How specific a rule is: a command beats a whole-message keyword, which beats a keyword found inside.
function rank(rule: Pick<AutoReplyRule, "kind" | "match">): number {
  if (rule.kind === "command") return 0;
  return rule.match === "exact" ? 1 : 2;
}

// The rule that answers a message in a group, if any: only rules that are switched on and cover the
// group, the most specific kind first, then a rule made for particular groups before one shared by
// every group (so a group can have its own answer to a shared command), then the one made first.
export function findAutoReply<Rule extends Pick<AutoReplyRule, "kind" | "match" | "triggers" | "enabled" | "groupIds" | "createdAt">>(rules: readonly Rule[], text: string, groupId: string): Rule | undefined {
  const message = normalize(text);
  if (message === "") return undefined;
  return rules
    .filter((rule) => rule.enabled && (rule.groupIds.length === 0 || rule.groupIds.includes(groupId)))
    .filter((rule) => rule.triggers.some((trigger) => triggerMatches(message, trigger, rule)))
    .sort((left, right) => rank(left) - rank(right) || Number(left.groupIds.length === 0) - Number(right.groupIds.length === 0) || left.createdAt - right.createdAt)[0];
}

// A picture sent as { data: <base64> }, or { keep: <position> } for one the rule already has.
function parseImage(value: unknown): MessageImage | Readonly<{ keep: number }> | string {
  const keep = isRecord(value) ? value.keep : undefined;
  if (typeof keep === "number" && Number.isInteger(keep) && keep >= 0) return { keep };
  const encoded = isRecord(value) ? value.data : undefined;
  if (typeof encoded !== "string" || encoded === "") return "Ảnh không hợp lệ";
  const data = Buffer.from(encoded, "base64");
  if (data.length > maxImageBytes) return "Ảnh lớn tối đa 5 MB";
  const info = readImageInfo(data);
  return info === undefined ? "Ảnh phải là JPEG, PNG hoặc WebP" : { data, ...info };
}

// Checks what the dashboard sent for a new or changed rule. Returns the rule, or the reason it is not
// acceptable. Whether there is anything to answer with (text or a picture) is judged where the kept
// pictures are known.
export function parseAutoReply(body: unknown): AutoReplyDraft | string {
  if (!isRecord(body)) return "Thiếu nội dung";
  const kind = kinds.find((item) => item === body.kind);
  if (kind === undefined) return "Loại không hợp lệ";
  const match = kind === "command" ? "exact" : matches.find((item) => item === body.match);
  if (match === undefined) return "Kiểu so khớp không hợp lệ";
  const rawTriggers: unknown = body.triggers;
  if (!Array.isArray(rawTriggers) || !rawTriggers.every((item): item is string => typeof item === "string")) return "Danh sách từ khóa không hợp lệ";
  const triggers: string[] = [];
  for (const raw of rawTriggers) {
    if (raw.trim() === "") continue;
    const trigger = normalizeTrigger(raw, kind);
    if (trigger === undefined) return kind === "command" ? `Lệnh “${raw.trim()}” không hợp lệ: chỉ gồm chữ, số, gạch dưới hoặc gạch ngang, tối đa 30 ký tự` : `Từ khóa dài tối đa ${maxTriggerLength} ký tự`;
    triggers.push(trigger);
  }
  const distinct = uniqueStrings(triggers);
  if (distinct.length === 0) return kind === "command" ? "Hãy nhập ít nhất một lệnh" : "Hãy nhập ít nhất một từ khóa";
  if (distinct.length > maxTriggers) return `Tối đa ${maxTriggers} ${kind === "command" ? "lệnh" : "từ khóa"} cho một câu trả lời`;
  const text = typeof body.text === "string" ? messageText(body.text) : "";
  if (text.length > maxMessageLength) return `Câu trả lời dài tối đa ${maxMessageLength} ký tự`;
  const rawImages: unknown = body.images ?? [];
  if (!Array.isArray(rawImages)) return "Danh sách ảnh không hợp lệ";
  if (rawImages.length > maxMessageImages) return `Mỗi câu trả lời tối đa ${maxMessageImages} ảnh`;
  const images: (MessageImage | Readonly<{ keep: number }>)[] = [];
  for (const raw of rawImages as unknown[]) {
    const image = parseImage(raw);
    if (typeof image === "string") return image;
    images.push(image);
  }
  if (totalImageBytes(images.filter((image): image is MessageImage => "data" in image)) > maxMessageImagesBytes) return "Tổng dung lượng ảnh của một câu trả lời tối đa 12 MB";
  const rawGroupIds: unknown = body.groupIds ?? [];
  if (!Array.isArray(rawGroupIds) || !rawGroupIds.every((item): item is string => typeof item === "string")) return "Danh sách nhóm không hợp lệ";
  const groupIds = uniqueStrings(rawGroupIds);
  if (groupIds.length > maxAutoReplyGroups) return `Tối đa ${maxAutoReplyGroups} nhóm cho một câu trả lời`;
  const cooldown = body.cooldownSeconds ?? defaultCooldownSeconds;
  if (typeof cooldown !== "number" || !Number.isInteger(cooldown) || cooldown < 0 || cooldown > maxCooldownSeconds) return `Thời gian nghỉ phải từ 0 đến ${maxCooldownSeconds} giây`;
  return { kind, match, triggers: distinct, text, images, groupIds, cooldownSeconds: cooldown, enabled: body.enabled !== false };
}
