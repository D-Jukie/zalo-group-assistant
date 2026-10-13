import assert from "node:assert/strict";
import { test } from "node:test";
import type { GroupReminder } from "../types.js";
import { nextOccurrence, parseBoardReminder, parseReminderRequest, sortReminders } from "./reminder.js";

const group = { groupId: "g1", name: "Nhóm bán hàng" };
const at = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();

await test("reads a reminder from a group's board", () => {
  const start = at(2026, 10, 20);
  const reminder = parseBoardReminder({
    id: "r1", creatorId: "bot", emoji: "⏰", startTime: start, duration: -1, repeat: 2, createTime: 5,
    params: { title: "Họp nhóm" }, responseMem: { acceptMember: 3, rejectMember: 1, myResp: 0 },
  }, group, "bot");
  assert.deepEqual(reminder, {
    reminderId: "r1", groupId: "g1", groupName: "Nhóm bán hàng", title: "Họp nhóm", emoji: "⏰", startTime: start,
    repeat: "weekly", creatorId: "bot", createdByBot: true, createdAt: 5, accepted: 3, rejected: 1,
  });
});

await test("accepts the title as JSON text", () => {
  const reminder = parseBoardReminder({ id: "r1", startTime: at(2026, 10, 20), params: JSON.stringify({ title: "Họp" }), creatorId: "u2" }, group, "bot");
  assert.equal(reminder?.title, "Họp");
  assert.equal(reminder?.createdByBot, false);
});

await test("skips board entries that are not usable reminders", () => {
  for (const raw of [null, "text", {}, { id: "r1" }, { startTime: 5 }, { id: "", startTime: 5 }]) {
    assert.equal(parseBoardReminder(raw, group, "bot"), undefined);
  }
});

await test("a reminder that does not repeat has no next time once it has passed", () => {
  const start = at(2026, 10, 12);
  assert.equal(nextOccurrence(start, "none", start - 1), start);
  assert.equal(nextOccurrence(start, "none", start + 1), null);
});

await test("repeating reminders move on to their next time", () => {
  const start = at(2026, 10, 12);
  assert.equal(nextOccurrence(start, "daily", at(2026, 10, 14, 8)), at(2026, 10, 14));
  assert.equal(nextOccurrence(start, "daily", at(2026, 10, 14, 10)), at(2026, 10, 15));
  assert.equal(nextOccurrence(start, "weekly", at(2026, 10, 13)), at(2026, 10, 19));
  assert.equal(nextOccurrence(start, "monthly", at(2026, 10, 13)), at(2026, 11, 12));
  assert.equal(nextOccurrence(start, "monthly", at(2027, 1, 12, 8)), at(2027, 1, 12));
});

await test("a monthly reminder on the 31st falls on the last day of shorter months", () => {
  const start = at(2026, 1, 31);
  assert.equal(nextOccurrence(start, "monthly", at(2026, 2, 1)), at(2026, 2, 28));
  assert.equal(nextOccurrence(start, "monthly", at(2026, 3, 1)), at(2026, 3, 31));
});

await test("orders upcoming reminders soonest first, then past ones newest first", () => {
  const make = (reminderId: string, startTime: number, nextTime: number | null) => ({ reminderId, startTime, nextTime }) as GroupReminder;
  const sorted = sortReminders([make("old", 10, null), make("later", 5, 300), make("recent", 50, null), make("soon", 100, 100)]);
  assert.deepEqual(sorted.map((item) => item.reminderId), ["soon", "later", "recent", "old"]);
});

await test("checks a request for a new reminder", () => {
  const now = at(2026, 10, 13);
  const valid = { title: "  Họp nhóm  ", startTime: now + 60_000, repeat: "none", groupIds: ["g1", "g2", "g1"] };
  assert.deepEqual(parseReminderRequest(valid, now), { title: "Họp nhóm", startTime: now + 60_000, repeat: "none", groupIds: ["g1", "g2"] });
  for (const invalid of [
    null,
    { ...valid, title: "   " },
    { ...valid, title: "a".repeat(201) },
    { ...valid, startTime: now },
    { ...valid, startTime: "2026-10-20" },
    { ...valid, repeat: "yearly" },
    { ...valid, groupIds: [] },
    { ...valid, groupIds: ["g1", 2] },
    { ...valid, groupIds: Array.from({ length: 101 }, (_item, index) => `g${index}`) },
  ]) {
    assert.equal(typeof parseReminderRequest(invalid, now), "string");
  }
});
