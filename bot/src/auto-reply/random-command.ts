import { randomInt } from "node:crypto";

// How many members one "/random" may pick, and how far its numbers may reach.
export const maxRandomMembers = 20;
export const maxRandomNumber = 1_000_000_000;

// What a "/random" message asks for.
export type RandomRequest =
  | Readonly<{ kind: "members"; count: number }>
  | Readonly<{ kind: "number"; min: number; max: number }>
  // The command was meant, but what follows it makes no sense; `reason` says how to write it.
  | Readonly<{ kind: "invalid"; reason: string }>;

export const randomUsage = "Cách dùng: /random (chọn 1 thành viên), /random 3 (chọn 3 thành viên), /random 1-100 (chọn một số từ 1 đến 100).";

// Reads a message as a "/random" command: "/random" picks a member, "/random 3" picks three,
// "/random 1-100" picks a number. Undefined when the message is not this command at all.
export function parseRandomCommand(text: string): RandomRequest | undefined {
  const words = text.normalize("NFC").trim().split(/\s+/u);
  if ((words[0] ?? "").toLowerCase() !== "/random") return undefined;
  const argument = words.slice(1).join("");
  if (argument === "") return { kind: "members", count: 1 };
  // "1-100", "1 - 100", "-5-5", also with "–" or "~" or ".." between the two numbers.
  const range = /^(-?\d{1,10})(?:-|–|—|~|\.\.)(-?\d{1,10})$/u.exec(argument);
  if (range !== null) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Math.abs(low) > maxRandomNumber || Math.abs(high) > maxRandomNumber) return { kind: "invalid", reason: `Số phải nằm trong khoảng ±${maxRandomNumber.toLocaleString("vi-VN")}.` };
    return { kind: "number", min: Math.min(low, high), max: Math.max(low, high) };
  }
  if (/^\d{1,4}$/u.test(argument)) {
    const count = Number(argument);
    if (count < 1 || count > maxRandomMembers) return { kind: "invalid", reason: `Mỗi lần chọn được từ 1 đến ${maxRandomMembers} thành viên.` };
    return { kind: "members", count };
  }
  return { kind: "invalid", reason: randomUsage };
}

// A whole number from `min` to `max`, both included, each as likely as the others.
export function pickNumber(min: number, max: number, random: (minInclusive: number, maxExclusive: number) => number = randomInt): number {
  return random(min, max + 1);
}

// `count` different items, each combination as likely as the others; all of them when there are not that many.
export function pickDistinct<T>(items: readonly T[], count: number, random: (minInclusive: number, maxExclusive: number) => number = randomInt): T[] {
  const pool = [...items];
  const wanted = Math.min(count, pool.length);
  // The first `wanted` places of a shuffle: each takes a random item from the ones not yet placed.
  for (let index = 0; index < wanted; index += 1) {
    const other = random(index, pool.length);
    [pool[index], pool[other]] = [pool[other] as T, pool[index] as T];
  }
  return pool.slice(0, wanted);
}

// The answer naming the picked members, with where each "@name" sits so Zalo can turn it into a mention.
export function memberAnswer(picked: readonly Readonly<{ userId: string; name: string }>[], poolSize: number, complete: boolean): Readonly<{ text: string; mentions: readonly Readonly<{ pos: number; uid: string; len: number }>[] }> {
  const from = `${poolSize.toLocaleString("vi-VN")} thành viên${complete ? "" : " bot đọc được"}`;
  let text = picked.length === 1 ? `🎲 Chọn ngẫu nhiên 1 trong ${from}:\n` : `🎲 Chọn ngẫu nhiên ${picked.length} trong ${from}:\n`;
  const mentions: { pos: number; uid: string; len: number }[] = [];
  picked.forEach((member, index) => {
    if (picked.length > 1) text += `${index + 1}. `;
    const tag = `@${member.name || member.userId}`;
    mentions.push({ pos: text.length, uid: member.userId, len: tag.length });
    text += index === picked.length - 1 ? tag : `${tag}\n`;
  });
  return { text, mentions };
}

export function numberAnswer(min: number, max: number, value: number): string {
  return `🎲 Số ngẫu nhiên từ ${min.toLocaleString("vi-VN")} đến ${max.toLocaleString("vi-VN")}: ${value.toLocaleString("vi-VN")}`;
}
