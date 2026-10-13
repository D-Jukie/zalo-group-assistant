import assert from "node:assert/strict";
import test from "node:test";
import type { PollDetail } from "zca-js";
import { parsePollRequest, pollResults } from "./poll.js";

const at = 1_000_000;
const request = { question: " Đi dã ngoại ngày nào? ", options: ["Thứ 7", " Chủ nhật ", ""], groupIds: ["g1", "g1", "g2"], allowMultiChoices: true };

await test("reads a poll request, trimmed, with each group once and switches off unless set", () => {
  assert.deepEqual(parsePollRequest(request, at), {
    poll: { question: "Đi dã ngoại ngày nào?", options: ["Thứ 7", "Chủ nhật"], allowMultiChoices: true, allowAddNewOption: false, hideVotePreview: false, isAnonymous: false },
    groupIds: ["g1", "g2"],
  });
});

await test("refuses a poll without a question, with fewer than two options, repeated options or no group", () => {
  assert.equal(parsePollRequest({ ...request, question: "  " }, at), "Hãy nhập câu hỏi");
  assert.equal(parsePollRequest({ ...request, options: ["Có"] }, at), "Hãy nhập ít nhất hai lựa chọn");
  assert.equal(parsePollRequest({ ...request, options: ["Có", "Có"] }, at), "Các lựa chọn không được trùng nhau");
  assert.equal(parsePollRequest({ ...request, groupIds: [] }, at), "Hãy chọn ít nhất một nhóm");
  assert.equal(parsePollRequest({ ...request, options: "Có" }, at), "Danh sách lựa chọn không hợp lệ");
});

const members = [{ userId: "1", name: "An" }, { userId: "2", name: "Bình" }, { userId: "3", name: "Chi" }];
const detail = (overrides: Partial<PollDetail>): PollDetail => ({
  creator: "bot", question: "?", joined: false, closed: false, poll_id: 9, allow_multi_choices: true, allow_add_new_option: false, is_anonymous: false, poll_type: 0, created_time: 0, updated_time: 0, expired_time: 0, is_hide_vote_preview: false, num_vote: 3,
  options: [{ content: "Thứ 7", votes: 2, voted: false, voters: ["1", "9"], option_id: 1 }, { content: "Chủ nhật", votes: 1, voted: false, voters: ["1"], option_id: 2 }],
  ...overrides,
});

await test("names the voters of each option and lists the members who have not voted", () => {
  const results = pollResults({ groupId: "g1", groupName: "Lớp" }, detail({}), members);
  assert.deepEqual(results.options, [
    { content: "Thứ 7", votes: 2, voters: [{ userId: "1", name: "An" }, { userId: "9", name: "9" }] },
    { content: "Chủ nhật", votes: 1, voters: [{ userId: "1", name: "An" }] },
  ]);
  // A member who chose two options is one voter; someone no longer in the group still counts.
  assert.equal(results.voterCount, 2);
  assert.deepEqual(results.notVoted, [{ userId: "2", name: "Bình" }, { userId: "3", name: "Chi" }]);
  assert.equal(results.memberCount, 3);
});

await test("an anonymous poll gives counts only, and nobody is listed as not having voted", () => {
  const results = pollResults({ groupId: "g1", groupName: "Lớp" }, detail({ is_anonymous: true, options: [{ content: "Có", votes: 3, voted: false, voters: [], option_id: 1 }] }), members);
  assert.equal(results.anonymous, true);
  assert.equal(results.voterCount, 3);
  assert.deepEqual(results.options, [{ content: "Có", votes: 3, voters: [] }]);
  assert.deepEqual(results.notVoted, []);
});

await test("a deadline is a moment at least a minute and at most a year ahead", () => {
  const parsed = parsePollRequest({ ...request, expiresAt: at + 3_600_000 }, at);
  assert.equal(typeof parsed === "string" ? undefined : parsed.poll.expiresAt, at + 3_600_000);
  assert.equal(parsePollRequest({ ...request, expiresAt: at + 1000 }, at), "Thời hạn phải ở tương lai, ít nhất một phút nữa");
  assert.equal(parsePollRequest({ ...request, expiresAt: at + 400 * 24 * 3_600_000 }, at), "Thời hạn xa nhất là một năm nữa");
  assert.equal(parsePollRequest({ ...request, expiresAt: "mai" }, at), "Thời hạn không hợp lệ");
  const open = parsePollRequest({ ...request, expiresAt: null }, at);
  assert.equal(typeof open === "string" ? "refused" : "expiresAt" in open.poll, false);
});
