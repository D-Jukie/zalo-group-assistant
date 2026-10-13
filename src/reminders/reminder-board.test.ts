import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminGroupView } from "../types.js";
import { ReminderBoard } from "./reminder-board.js";

type BoardApi = ConstructorParameters<typeof ReminderBoard>[0];

const noQueue = { addReminderMessage: () => Promise.resolve(), removeReminderMessages: () => Promise.resolve(), listReminderMessageKeys: () => Promise.resolve(new Set<string>()) };

const group = (groupId: string, name: string) => ({ groupId, name, botEnabled: true }) as AdminGroupView;
const groups = { ownId: "bot", listGroups: () => Promise.resolve([group("g1", "Nhóm có nhắc hẹn"), group("g2", "Nhóm trống"), group("g3", "Nhóm lỗi")]) };

// What Zalo's client throws: a group with an empty board gets an error code and no text.
function zaloError(message: string | null, code: number): Error {
  return Object.assign(new Error(message as string), { code });
}

await test("a board Zalo reports without a message is an empty board, not a failure", async () => {
  const api = {
    getListReminder: (_options: unknown, groupId: string) => {
      if (groupId === "g2") return Promise.reject(zaloError(null, 114));
      if (groupId === "g3") return Promise.reject(zaloError("Tham số không hợp lệ", 112));
      return Promise.resolve([{ id: "r1", startTime: Date.now() + 60_000, params: { title: "Họp" }, creatorId: "bot" }]);
    },
  } as unknown as BoardApi;
  const list = await new ReminderBoard(api, groups, noQueue).list();
  assert.deepEqual(list.items.map((item) => item.reminderId), ["r1"]);
  assert.equal(list.groupCount, 3);
  assert.deepEqual(list.failed, [{ groupId: "g3", groupName: "Nhóm lỗi", error: "Tham số không hợp lệ" }]);
});

await test("a failure without a message names the error code instead of showing null", async () => {
  const api = {
    createReminder: () => Promise.reject(zaloError(null, 221)),
  } as unknown as BoardApi;
  const results = await new ReminderBoard(api, groups, noQueue, 0).create({ title: "Họp", startTime: Date.now() + 60_000, repeat: "none" }, ["g1"]);
  assert.deepEqual(results, [{ groupId: "g1", groupName: "Nhóm có nhắc hẹn", ok: false, error: "Zalo báo lỗi mã 221" }]);
});
