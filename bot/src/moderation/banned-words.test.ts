import assert from "node:assert/strict";
import { test } from "node:test";
import { createBannedWordMatcher, normalizeBannedWord } from "./banned-words.js";

const find = createBannedWordMatcher(["dcm", "vl", "cl", "ban hang online", "cặc"]);

await test("matches a banned word that stands alone", () => {
  assert.equal(find("dcm"), "dcm");
  assert.equal(find("ôi dcm! thật chứ"), "dcm");
  assert.equal(find("(dcm)"), "dcm");
  assert.equal(find("DCM"), "dcm");
});

await test("does not match inside another word", () => {
  assert.equal(find("hjhdcm"), undefined);
  assert.equal(find("dcmxyz"), undefined);
  assert.equal(find("xdcmx"), undefined);
});

await test("matches common ways of disguising a word", () => {
  assert.equal(find("d.c.m"), "dcm");
  assert.equal(find("d-c-m"), "dcm");
  assert.equal(find("dcmmmmmm"), "dcm");
  assert.equal(find("v.l"), "vl");
  assert.equal(find(`d${String.fromCharCode(0x200b)}cm`), "dcm");
});

await test("matches accents typed as separate combining marks", () => {
  assert.equal(find("cặc".normalize("NFD")), "cặc");
});

await test("keeps diacritics significant", () => {
  assert.equal(createBannedWordMatcher(["cac"])("các bạn ơi"), undefined);
  assert.equal(createBannedWordMatcher(["cac"])("cac ban oi"), "cac");
});

await test("matches phrases across irregular spacing", () => {
  assert.equal(find("ai can BAN   HANG online khong"), "ban   hang online");
});

await test("ignores real links and hyphenated letter pairs", () => {
  assert.equal(find("xem ở https://example.com/vl/123"), undefined);
  assert.equal(find("www.example.com/cl/1 nhé"), undefined);
  assert.equal(find("áo size v-l còn không"), undefined);
  assert.equal(find("xem https://example.com/a rồi dcm"), "dcm");
});

await test("still checks text that only resembles a link", () => {
  assert.equal(find("a.vn/dcm"), "dcm");
  assert.equal(find("www.dcm"), "dcm");
  assert.equal(find("https://dcm"), "dcm");
});

await test("handles a very long message without spaces quickly", () => {
  const started = performance.now();
  assert.equal(find("a.".repeat(50_000)), undefined);
  assert.equal(find("x".repeat(100_000)), undefined);
  assert.ok(performance.now() - started < 1_000);
});

await test("matches nothing when the list is empty", () => {
  assert.equal(createBannedWordMatcher([])("dcm"), undefined);
});

await test("normalises custom words", () => {
  assert.equal(normalizeBannedWord("  Ban Hang  Online "), "ban hang online");
  assert.equal(normalizeBannedWord("a"), undefined);
  assert.equal(normalizeBannedWord("x".repeat(51)), undefined);
});
