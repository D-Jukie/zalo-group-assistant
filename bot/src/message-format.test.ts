import assert from "node:assert/strict";
import test from "node:test";
import { formatMessage, messageContent, plainText } from "./message-format.js";

await test("text without tags goes out as it is", () => {
  assert.deepEqual(formatMessage("Họp lúc 20 giờ [phòng 2]"), { msg: "Họp lúc 20 giờ [phòng 2]", styles: [], mentions: [] });
  assert.deepEqual(messageContent("xin chào"), { msg: "xin chào" });
});

await test("each tag becomes a style over the text it wraps", () => {
  assert.deepEqual(formatMessage("a [b]đậm[/b] [i]nghiêng[/i]"), {
    msg: "a đậm nghiêng",
    styles: [{ start: 2, len: 3, st: "b" }, { start: 6, len: 7, st: "i" }],
    mentions: [],
  });
  assert.deepEqual(formatMessage("[big]to[/big][small]nhỏ[/small][red]đỏ[/red]").styles, [
    { start: 0, len: 2, st: "f_18" },
    { start: 2, len: 3, st: "f_13" },
    { start: 5, len: 2, st: "c_db342e" },
  ]);
});

await test("tags can sit inside one another, and cross", () => {
  assert.deepEqual(formatMessage("[b][red]gấp[/red] nhé[/b]"), {
    msg: "gấp nhé",
    styles: [{ start: 0, len: 3, st: "c_db342e" }, { start: 0, len: 7, st: "b" }],
    mentions: [],
  });
  assert.deepEqual(formatMessage("[b]a[i]b[/b]c[/i]").styles, [{ start: 0, len: 2, st: "b" }, { start: 1, len: 2, st: "i" }]);
});

await test("a tag without its partner stays as text", () => {
  assert.deepEqual(formatMessage("[b]quên đóng"), { msg: "[b]quên đóng", styles: [], mentions: [] });
  assert.deepEqual(formatMessage("thừa[/i] [b]ok[/b]"), { msg: "thừa[/i] ok", styles: [{ start: 9, len: 2, st: "b" }], mentions: [] });
});

await test("a tag around nothing leaves no style", () => {
  assert.deepEqual(formatMessage("a[b][/b]b"), { msg: "ab", styles: [], mentions: [] });
});

await test("[all] becomes a mention of every member", () => {
  assert.deepEqual(formatMessage("[all] [b]họp[/b] nhé"), {
    msg: "@All họp nhé",
    styles: [{ start: 5, len: 3, st: "b" }],
    mentions: [{ pos: 0, uid: "-1", len: 4 }],
  });
});

await test("tags are read in either case, and positions count UTF-16 units", () => {
  assert.deepEqual(formatMessage("😀[B]x[/b]"), { msg: "😀x", styles: [{ start: 2, len: 1, st: "b" }], mentions: [] });
});

await test("the plain text is the message without its tags", () => {
  assert.equal(plainText("[b]Thông báo[/b]: [all] nộp bài"), "Thông báo: @All nộp bài");
  assert.equal(plainText("[b][/b]"), "");
});
