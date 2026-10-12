import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSpamSettings, type SpamSettings } from "../types.js";
import { findContactInfo, SpamDetector } from "./spam-detector.js";

const off = { enabled: false, count: 5, windowSeconds: 10 };
const only = (changes: Partial<SpamSettings>): SpamSettings => ({ flood: off, repeat: { ...off, count: 3, windowSeconds: 60 }, contact: { enabled: false }, ...changes });
// Feeds messages to a fresh detector and returns the verdict for each: seconds are offsets from the first.
// A third element marks the message as a photo: an album ID, or "" for a photo Zalo did not tag.
function run(settings: SpamSettings, messages: readonly (readonly [number, string, string?])[], key = "g1:u1"): (string | undefined)[] {
  const detector = new SpamDetector();
  return messages.map(([seconds, text, album]) => detector.check(key, { text, at: 1_000_000 + seconds * 1000, ...(album === undefined ? {} : { album }) }, settings));
}
const flagged = (verdicts: readonly (string | undefined)[]) => verdicts.map((verdict) => verdict !== undefined);

await test("defaults catch bursts and repeats but not contact details", () => {
  assert.deepEqual(defaultSpamSettings, {
    flood: { enabled: true, count: 5, windowSeconds: 10 },
    repeat: { enabled: true, count: 3, windowSeconds: 60 },
    contact: { enabled: false },
  });
});

await test("flags a burst once the count is reached inside the window", () => {
  const flood = only({ flood: { enabled: true, count: 3, windowSeconds: 10 } });
  const verdicts = run(flood, [[0, "a"], [1, "b"], [2, "c"], [3, "d"]]);
  assert.deepEqual(verdicts.map((verdict) => verdict !== undefined), [false, false, true, true]);
  assert.equal(verdicts[2], "gửi dồn dập 3 tin trong 10 giây");
});

await test("does not flag messages spread wider than the window", () => {
  const flood = only({ flood: { enabled: true, count: 3, windowSeconds: 10 } });
  assert.deepEqual(run(flood, [[0, "a"], [6, "b"], [12, "c"], [18, "d"]]), [undefined, undefined, undefined, undefined]);
});

await test("photos of one album count as a single message", () => {
  const flood = only({ flood: { enabled: true, count: 3, windowSeconds: 10 } });
  // Eight photos Zalo tagged as one album, uploading over several seconds.
  const album = Array.from({ length: 8 }, (_item, index) => [index * 0.7, "", "album-1"] as const);
  assert.deepEqual(flagged(run(flood, album)), Array.from({ length: 8 }, () => false));
  // Untagged photos that arrive back to back are treated the same way.
  assert.deepEqual(flagged(run(flood, [[0, "", ""], [0.4, "", ""], [0.9, "", ""], [1.3, "", ""], [1.8, "", ""]])), [false, false, false, false, false]);
});

await test("an album is one message among the others, not a free pass", () => {
  const flood = only({ flood: { enabled: true, count: 3, windowSeconds: 10 } });
  // Text, an album of three, then more text: three messages in all, so the third one trips the check.
  assert.deepEqual(flagged(run(flood, [[0, "xem ảnh nè"], [1, "", "a"], [1.2, "", "a"], [1.4, "", "a"], [2, "đẹp không"]])), [false, false, false, false, true]);
  // Separate albums, and untagged photos sent seconds apart, are separate messages.
  assert.deepEqual(flagged(run(flood, [[0, "", "a"], [1, "", "b"], [2, "", "c"]])), [false, false, true]);
  assert.deepEqual(flagged(run(flood, [[0, "", ""], [4, "", ""], [8, "", ""]])), [false, false, true]);
});

await test("flags the same text sent repeatedly, ignoring case and spacing", () => {
  const repeat = only({ repeat: { enabled: true, count: 3, windowSeconds: 60 } });
  const verdicts = run(repeat, [[0, "Mua hàng giá rẻ tại đây"], [20, "mua hàng  GIÁ RẺ tại đây"], [40, " Mua hàng giá rẻ tại đây "]]);
  assert.deepEqual(verdicts, [undefined, undefined, "lặp nội dung 3 lần trong 60 giây"]);
});

await test("does not treat short everyday replies or different texts as repeats", () => {
  const repeat = only({ repeat: { enabled: true, count: 3, windowSeconds: 60 } });
  assert.deepEqual(run(repeat, [[0, "ok"], [1, "ok"], [2, "ok"], [3, "ok"]]), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(run(repeat, [[0, "hôm nay trời đẹp quá"], [1, "mai đi chơi không cả nhà"], [2, "để mình rủ thêm bạn nữa"]]), [undefined, undefined, undefined]);
});

await test("forgets repeats that fall outside the window", () => {
  const repeat = only({ repeat: { enabled: true, count: 3, windowSeconds: 60 } });
  assert.deepEqual(run(repeat, [[0, "Mua hàng giá rẻ tại đây"], [50, "Mua hàng giá rẻ tại đây"], [100, "Mua hàng giá rẻ tại đây"]]), [undefined, undefined, undefined]);
});

await test("works from what the current settings need, so changing a window takes effect at once", () => {
  const detector = new SpamDetector();
  const at = 1_000_000;
  const short = only({ repeat: { enabled: true, count: 2, windowSeconds: 30 } });
  const long = only({ repeat: { enabled: true, count: 2, windowSeconds: 600 } });
  assert.equal(detector.check("g1:u1", { text: "Mua hàng giá rẻ tại đây", at }, long), undefined);
  // 100 seconds later the copy is outside a 30-second window and is dropped from memory...
  assert.equal(detector.check("g1:u1", { text: "Mua hàng giá rẻ tại đây", at: at + 100_000 }, short), undefined);
  // ...while the one just sent is still there for the next check.
  assert.notEqual(detector.check("g1:u1", { text: "Mua hàng giá rẻ tại đây", at: at + 110_000 }, short), undefined);
});

await test("keeps each member and each group separate", () => {
  const flood = only({ flood: { enabled: true, count: 2, windowSeconds: 10 } });
  const detector = new SpamDetector();
  const at = 1_000_000;
  assert.equal(detector.check("g1:u1", { text: "a", at }, flood), undefined);
  assert.equal(detector.check("g1:u2", { text: "a", at: at + 1 }, flood), undefined);
  assert.equal(detector.check("g2:u1", { text: "a", at: at + 2 }, flood), undefined);
  assert.notEqual(detector.check("g1:u1", { text: "b", at: at + 3 }, flood), undefined);
});

await test("finds phone numbers however they are spaced", () => {
  for (const text of ["gọi 0912345678 nhé", "LH: 0912 345 678", "zalo 09.12.34.56.78", "+84 912 345 678", "84912345678", "sdt 0 9 1 2 3 4 5 6 7 8"]) {
    assert.match(findContactInfo(text) ?? "", /^số điện thoại /u, text);
  }
});

await test("does not mistake other numbers for a phone number", () => {
  for (const text of ["đơn hàng 20261012345", "giá 1.250.000 đồng", "mã 0123456789012", "năm 2026 có 365 ngày", "0212345678"]) {
    assert.equal(findContactInfo(text), undefined, text);
  }
});

await test("finds a bank account only when the message says it is one", () => {
  assert.equal(findContactInfo("STK 1903 5567 8899 Techcombank"), "số tài khoản");
  assert.equal(findContactInfo("chuyển vào số tài khoản: 123456789"), "số tài khoản");
  assert.equal(findContactInfo("mã vận đơn 123456789"), undefined);
});

await test("contact details are only checked when that option is on", () => {
  assert.deepEqual(run(only({}), [[0, "gọi 0912345678 nhé"]]), [undefined]);
  assert.deepEqual(run(only({ contact: { enabled: true } }), [[0, "gọi 0912345678 nhé"]]), ["số điện thoại 0912345678"]);
});
