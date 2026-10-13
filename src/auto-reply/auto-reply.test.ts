import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutoReplyKind, AutoReplyMatch } from "../types.js";
import { findAutoReply, normalizeTrigger, parseAutoReply } from "./auto-reply.js";

let made = 0;
const rule = (id: string, kind: AutoReplyKind, match: AutoReplyMatch, triggers: string[], options: { enabled?: boolean; groupIds?: string[] } = {}) => ({ id, kind, match, triggers, enabled: options.enabled ?? true, groupIds: options.groupIds ?? [], createdAt: (made += 1) });
const answer = (rules: ReturnType<typeof rule>[], text: string, groupId = "g1") => findAutoReply(rules, text, groupId)?.id;

await test("an exact keyword answers only the whole message", () => {
  const rules = [rule("price", "keyword", "exact", ["bảng giá"])];
  assert.equal(answer(rules, "bảng giá"), "price");
  assert.equal(answer(rules, "  BẢNG   GIÁ "), "price");
  assert.equal(answer(rules, "cho mình xin bảng giá"), undefined);
});

await test("a contained keyword answers whole words anywhere in the message", () => {
  const rules = [rule("price", "keyword", "contains", ["giá"])];
  assert.equal(answer(rules, "cho mình hỏi giá với"), "price");
  assert.equal(answer(rules, "Giá?"), "price");
  // Not inside another word.
  assert.equal(answer(rules, "giám đốc đi vắng"), undefined);
  assert.equal(answer(rules, "tham gia nhóm"), undefined);
});

await test("a keyword typed without accents also answers the accented spelling, not the other way round", () => {
  assert.equal(answer([rule("guide", "keyword", "contains", ["huong dan"])], "cho xin hướng dẫn"), "guide");
  assert.equal(answer([rule("guide", "keyword", "contains", ["huong dan"])], "cho xin huong dan"), "guide");
  assert.equal(answer([rule("guide", "keyword", "contains", ["hướng dẫn"])], "cho xin huong dan"), undefined);
  assert.equal(answer([rule("guide", "keyword", "contains", ["hướng dẫn"])], "cho xin HƯỚNG DẪN"), "guide");
});

await test("a command answers when it is the first word of the message", () => {
  const rules = [rule("guide", "command", "exact", ["/huongdan"])];
  assert.equal(answer(rules, "/huongdan"), "guide");
  assert.equal(answer(rules, "/HuongDan cho mình với"), "guide");
  assert.equal(answer(rules, "gõ /huongdan đi"), undefined);
  assert.equal(answer(rules, "/huongdan2"), undefined);
  assert.equal(answer(rules, "huongdan"), undefined);
});

await test("the most specific rule answers: a command, then a whole message, then a contained keyword", () => {
  const rules = [rule("inside", "keyword", "contains", ["giá"]), rule("whole", "keyword", "exact", ["giá"]), rule("command", "command", "exact", ["/gia"])];
  assert.equal(answer(rules, "giá"), "whole");
  assert.equal(answer(rules, "giá bao nhiêu"), "inside");
  assert.equal(answer(rules, "/gia"), "command");
  // Among equals, the one made first.
  assert.equal(answer([rule("first", "keyword", "contains", ["ship"]), rule("second", "keyword", "contains", ["ship"])], "phí ship?"), "first");
});

await test("a group's own answer beats the one shared by every group", () => {
  const rules = [rule("shared", "command", "exact", ["/huongdan"]), rule("own", "command", "exact", ["/huongdan"], { groupIds: ["g1"] })];
  assert.equal(answer(rules, "/huongdan", "g1"), "own");
  assert.equal(answer(rules, "/huongdan", "g2"), "shared");
  // The kind still comes first: a shared command beats a group's keyword.
  assert.equal(answer([rule("keyword", "keyword", "exact", ["/huongdan"], { groupIds: ["g1"] }), rule("command", "command", "exact", ["/huongdan"])], "/huongdan", "g1"), "command");
});

await test("only rules that are on and cover the group answer", () => {
  assert.equal(answer([rule("off", "keyword", "exact", ["giá"], { enabled: false })], "giá"), undefined);
  const scoped = [rule("g2only", "keyword", "exact", ["giá"], { groupIds: ["g2"] })];
  assert.equal(answer(scoped, "giá", "g1"), undefined);
  assert.equal(answer(scoped, "giá", "g2"), "g2only");
  assert.equal(answer([rule("any", "keyword", "exact", ["giá"])], ""), undefined);
});

await test("stores a keyword in lower case and a command as /name", () => {
  assert.equal(normalizeTrigger("  Bảng   GIÁ ", "keyword"), "bảng giá");
  assert.equal(normalizeTrigger("HuongDan", "command"), "/huongdan");
  assert.equal(normalizeTrigger("//huong_dan-2", "command"), "/huong_dan-2");
  assert.equal(normalizeTrigger("/huong dan", "command"), undefined);
  assert.equal(normalizeTrigger("   ", "keyword"), undefined);
  assert.equal(normalizeTrigger("a".repeat(61), "keyword"), undefined);
});

await test("checks a rule sent by the dashboard", () => {
  const valid = { kind: "keyword", match: "contains", triggers: [" Giá ", "bảng giá", "giá", ""], text: "  Bảng giá ở tin ghim  ", groupIds: ["g1", "g1"], cooldownSeconds: 30 };
  assert.deepEqual(parseAutoReply(valid), { kind: "keyword", match: "contains", triggers: ["giá", "bảng giá"], text: "Bảng giá ở tin ghim", images: [], groupIds: ["g1"], cooldownSeconds: 30, enabled: true });
  // A command always matches as a whole word, whatever is sent for "match".
  const command = parseAutoReply({ kind: "command", match: "contains", triggers: ["huongdan"], text: "x" });
  assert.ok(typeof command === "object");
  assert.deepEqual([command.match, command.triggers, command.cooldownSeconds, command.groupIds], ["exact", ["/huongdan"], 10, []]);
  // A picture the rule already has is named by its position.
  const kept = parseAutoReply({ ...valid, images: [{ keep: 1 }] });
  assert.ok(typeof kept === "object");
  assert.deepEqual(kept.images, [{ keep: 1 }]);
  for (const invalid of [
    null,
    { ...valid, kind: "regex" },
    { ...valid, match: "fuzzy" },
    { ...valid, triggers: [] },
    { ...valid, triggers: ["  "] },
    { ...valid, triggers: Array.from({ length: 11 }, (_item, index) => `từ ${index}`) },
    { kind: "command", triggers: ["/huong dan"], text: "x" },
    { ...valid, text: "a".repeat(2001) },
    { ...valid, images: [{ data: "bm9wZQ==" }] },
    { ...valid, images: Array.from({ length: 7 }, () => ({ keep: 0 })) },
    { ...valid, cooldownSeconds: -1 },
    { ...valid, groupIds: "g1" },
  ]) {
    assert.equal(typeof parseAutoReply(invalid), "string");
  }
});
