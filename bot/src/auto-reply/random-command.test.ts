import assert from "node:assert/strict";
import { test } from "node:test";
import { memberAnswer, numberAnswer, parseRandomCommand, pickDistinct, pickNumber } from "./random-command.js";

await test("reads what a /random message asks for", () => {
  assert.deepEqual(parseRandomCommand("/random"), { kind: "members", count: 1 });
  assert.deepEqual(parseRandomCommand("  /RANDOM  "), { kind: "members", count: 1 });
  assert.deepEqual(parseRandomCommand("/random 3"), { kind: "members", count: 3 });
  assert.deepEqual(parseRandomCommand("/random 1-100"), { kind: "number", min: 1, max: 100 });
  assert.deepEqual(parseRandomCommand("/random 1 - 100"), { kind: "number", min: 1, max: 100 });
  // Either order, negative numbers and other dashes are understood.
  assert.deepEqual(parseRandomCommand("/random 100-1"), { kind: "number", min: 1, max: 100 });
  assert.deepEqual(parseRandomCommand("/random -5-5"), { kind: "number", min: -5, max: 5 });
  assert.deepEqual(parseRandomCommand("/random 1–6"), { kind: "number", min: 1, max: 6 });
  assert.deepEqual(parseRandomCommand("/random 7-7"), { kind: "number", min: 7, max: 7 });
});

await test("leaves other messages alone, and says how to write a command it cannot read", () => {
  for (const text of ["random", "gõ /random đi", "/randomize", "/rand", ""]) assert.equal(parseRandomCommand(text), undefined);
  for (const text of ["/random abc", "/random 0", "/random 21", "/random 1-2-3", "/random 1-99999999999", "/random vote Tham gia"]) {
    assert.equal(parseRandomCommand(text)?.kind, "invalid", text);
  }
});

await test("picks a number anywhere in the range, both ends included", () => {
  assert.equal(pickNumber(1, 100, (low) => low), 1);
  assert.equal(pickNumber(1, 100, (_low, high) => high - 1), 100);
  assert.equal(pickNumber(7, 7), 7);
  const seen = new Set(Array.from({ length: 300 }, () => pickNumber(1, 6)));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

await test("picks different members, and no more than there are", () => {
  const members = ["a", "b", "c", "d", "e"];
  for (let round = 0; round < 50; round += 1) {
    const picked = pickDistinct(members, 3);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
    assert.ok(picked.every((item) => members.includes(item)));
  }
  assert.deepEqual(pickDistinct(members, 9).sort(), members);
  assert.deepEqual(pickDistinct([], 2), []);
  // The list it picks from is left as it was.
  assert.deepEqual(members, ["a", "b", "c", "d", "e"]);
  // Over many rounds every member gets picked.
  assert.equal(new Set(Array.from({ length: 300 }, () => pickDistinct(members, 1)[0])).size, 5);
});

await test("words the answers, with each name placed for a mention", () => {
  const one = memberAnswer([{ userId: "u1", name: "Nguyễn Văn A" }], 120, true);
  assert.equal(one.text, "🎲 Chọn ngẫu nhiên 1 trong 120 thành viên:\n@Nguyễn Văn A");
  assert.deepEqual(one.mentions.map((mention) => [mention.uid, one.text.slice(mention.pos, mention.pos + mention.len)]), [["u1", "@Nguyễn Văn A"]]);
  const two = memberAnswer([{ userId: "u1", name: "An" }, { userId: "u2", name: "" }], 1500, false);
  assert.equal(two.text, "🎲 Chọn ngẫu nhiên 2 trong 1.500 thành viên bot đọc được:\n1. @An\n2. @u2");
  assert.deepEqual(two.mentions.map((mention) => [mention.uid, two.text.slice(mention.pos, mention.pos + mention.len)]), [["u1", "@An"], ["u2", "@u2"]]);
  assert.equal(numberAnswer(1, 1000, 42), "🎲 Số ngẫu nhiên từ 1 đến 1.000: 42");
});
