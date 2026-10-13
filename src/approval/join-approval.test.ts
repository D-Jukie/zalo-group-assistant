import assert from "node:assert/strict";
import { test } from "node:test";
import type { JoinApplicant } from "../types.js";
import { failedCriteria, formatAgeDays, freeSlots, hasOwnAvatar, parseJoinApprovalSettings, pickApprovals } from "./join-approval.js";

const day = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;
const photo = "https://s120-ava-talk.zadn.vn/1/2/3/4/17/abc.jpg?key=x&time=y";
const applicant = (userId: string, ageDays: number | null, avatar = photo): JoinApplicant => ({ userId, name: `Người ${userId}`, avatar, accountCreatedAt: ageDays === null ? null : now - ageDays * day });
const both = { enabled: true, requireAvatar: true, minAccountAgeDays: 90 };

await test("tells a picture of the member's own from Zalo's default one", () => {
  assert.equal(hasOwnAvatar(photo), true);
  assert.equal(hasOwnAvatar("https://s120-ava-talk.zadn.vn/default"), false);
  assert.equal(hasOwnAvatar("https://s120-ava-talk.zadn.vn/default?x=1"), false);
  assert.equal(hasOwnAvatar(""), false);
  // A picture that merely has the word in its name is still a picture.
  assert.equal(hasOwnAvatar("https://s120-ava-talk.zadn.vn/a/default-theme.jpg"), true);
});

await test("says which criteria an applicant fails", () => {
  assert.deepEqual(failedCriteria(applicant("1", 400), both, now), []);
  assert.deepEqual(failedCriteria(applicant("2", 10), both, now), ["Tham gia Zalo chưa đủ 3 tháng"]);
  assert.deepEqual(failedCriteria(applicant("3", 400, "https://x.zadn.vn/default"), both, now), ["Chưa có ảnh đại diện"]);
  assert.deepEqual(failedCriteria(applicant("4", null, ""), both, now), ["Chưa có ảnh đại diện", "Không rõ ngày tham gia Zalo"]);
  // Exactly old enough passes.
  assert.deepEqual(failedCriteria(applicant("5", 90), both, now), []);
});

await test("a criterion that is switched off is not checked", () => {
  assert.deepEqual(failedCriteria(applicant("1", 1, ""), { enabled: true, requireAvatar: false, minAccountAgeDays: 0 }, now), []);
  assert.deepEqual(failedCriteria(applicant("2", null), { enabled: true, requireAvatar: true, minAccountAgeDays: 0 }, now), []);
});

await test("lets in only those who qualify, in order, and no more than the group has room for", () => {
  const waiting = [applicant("a", 400), applicant("b", 5), applicant("c", 500), applicant("d", 365), applicant("e", 100, "")];
  assert.deepEqual(pickApprovals(waiting, both, now, 10).map((item) => item.userId), ["a", "c", "d"]);
  assert.deepEqual(pickApprovals(waiting, both, now, 2).map((item) => item.userId), ["a", "c"]);
  assert.deepEqual(pickApprovals(waiting, both, now, 0), []);
});

await test("counts the room left in a group of at most 1000", () => {
  assert.equal(freeSlots(998, 1000), 2);
  assert.equal(freeSlots(1000, 1000), 0);
  assert.equal(freeSlots(1003, 1000), 0);
  // Zalo not saying the limit means the usual one.
  assert.equal(freeSlots(990, 0), 10);
});

await test("words an age in the largest unit that fits and checks the settings", () => {
  assert.deepEqual([formatAgeDays(45), formatAgeDays(90), formatAgeDays(730)], ["45 ngày", "3 tháng", "2 năm"]);
  assert.deepEqual(parseJoinApprovalSettings({ enabled: true, requireAvatar: false, minAccountAgeDays: 180 }), { enabled: true, requireAvatar: false, minAccountAgeDays: 180 });
  for (const invalid of [null, {}, { enabled: true, requireAvatar: true, minAccountAgeDays: -1 }, { enabled: true, requireAvatar: true, minAccountAgeDays: 1.5 }, { enabled: "yes", requireAvatar: true, minAccountAgeDays: 0 }, { enabled: true, requireAvatar: true, minAccountAgeDays: 4000 }]) {
    assert.equal(parseJoinApprovalSettings(invalid), undefined);
  }
});
