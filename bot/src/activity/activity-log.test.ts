import assert from "node:assert/strict";
import { test } from "node:test";
import type { NewActivity, StoredGroup } from "../types.js";
import { ActivityLog, parseActivityCursor, parseActivityFilter, previewText } from "./activity-log.js";

function setup(options: Readonly<{ fail?: boolean }> = {}) {
  const saved: Required<NewActivity>[] = [];
  const log = new ActivityLog({
    getGroup: (groupId) => Promise.resolve(groupId === "g1" ? { name: "Nhóm bán hàng" } as StoredGroup : undefined),
    addActivity: (entry) => {
      if (options.fail === true) return Promise.reject(new Error("database down"));
      saved.push(entry);
      return Promise.resolve();
    },
  });
  return { log, saved };
}

await test("an entry is saved whole, with the group's name looked up and the gaps filled in", async () => {
  const { log, saved } = setup();
  await log.write({ category: "moderation", actor: "bot", title: "Xóa tin nhắn vi phạm", groupId: "g1", userId: "u1", userName: "An" });
  assert.deepEqual(saved, [{ category: "moderation", actor: "bot", title: "Xóa tin nhắn vi phạm", detail: "", ok: true, error: "", groupId: "g1", groupName: "Nhóm bán hàng", userId: "u1", userName: "An" }]);
});

await test("a given group name is kept, an unknown group has none, and long text is cut", async () => {
  const { log, saved } = setup();
  await log.write({ category: "settings", actor: "admin", title: "Rời nhóm", groupId: "g1", groupName: "Tên lúc rời" });
  await log.write({ category: "settings", actor: "admin", title: "Bật bot", groupId: "gone", detail: "x".repeat(900), ok: false, error: "y".repeat(900) });
  assert.equal(saved[0]?.groupName, "Tên lúc rời");
  assert.equal(saved[1]?.groupName, "");
  assert.equal(saved[1]?.detail.length, 500);
  assert.equal(saved[1]?.error.length, 500);
});

await test("a log that cannot be written never throws", async () => {
  const { log } = setup({ fail: true });
  await log.write({ category: "system", actor: "bot", title: "Bot khởi động" });
  log.record({ category: "system", actor: "bot", title: "Bot khởi động" });
});

await test("a message is previewed on one line, with its pictures counted", () => {
  assert.equal(previewText("Chào cả nhà\n\nhọp lúc 8h"), "“Chào cả nhà họp lúc 8h”");
  assert.equal(previewText("", 3), "3 ảnh");
  assert.equal(previewText("Xem ảnh", 2), "“Xem ảnh” + 2 ảnh");
  assert.equal(previewText("a".repeat(200)), `“${"a".repeat(120)}…”`);
});

await test("the filters and the cursor are read from a query, ignoring what cannot be read", () => {
  assert.deepEqual(parseActivityFilter({ q: "  an ", category: "replies", actor: "bot", result: "failed", groupId: "g1", from: "1000", to: "2000" }, 100), { text: "an", category: "replies", actor: "bot", ok: false, groupId: "g1", from: 1000, to: 2000 });
  assert.deepEqual(parseActivityFilter({ q: ["x"], category: "nope", actor: "me", result: "maybe", from: "abc", to: "-5" }, 100), {});
  assert.deepEqual(parseActivityFilter({ result: "ok" }, 100), { ok: true });
  assert.deepEqual(parseActivityCursor("1791864000000_0123456789abcdef01234567"), { at: 1791864000000, id: "0123456789abcdef01234567" });
  assert.equal(parseActivityCursor("1791864000000"), undefined);
  assert.equal(parseActivityCursor("x_0123456789abcdef01234567"), undefined);
});
