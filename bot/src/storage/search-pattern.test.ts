import assert from "node:assert/strict";
import { test } from "node:test";
import { searchPattern } from "./search-pattern.js";

const finds = (query: string, text: string) => new RegExp(searchPattern(query), "u").test(text);

await test("a plain letter finds every accented form, in either case", () => {
  assert.ok(finds("nguyen van a", "Nguyễn Văn A"));
  assert.ok(finds("NGUYEN", "nguyễn"));
  assert.ok(finds("duong", "Đường Dương"));
  assert.ok(finds("mua hang", "Mời MUA HÀNG giá rẻ"));
});

await test("a letter typed with its accent only finds that accent", () => {
  assert.ok(finds("nguyễn", "Nguyễn Văn A"));
  assert.ok(finds("NGUYỄN", "nguyễn văn a"));
  assert.ok(!finds("nguyên", "Nguyễn Văn A"));
  assert.ok(!finds("đường", "duong"));
});

await test("finds the text anywhere and treats symbols literally", () => {
  assert.ok(finds("zalo.me/g/", "vào https://zalo.me/g/abc123 nhé"));
  assert.ok(!finds("zalo.me", "zaloXme"));
  assert.ok(finds("(giá?)", "hỏi (giá?) đi"));
  assert.ok(!finds("xyz", "Nguyễn Văn A"));
});
