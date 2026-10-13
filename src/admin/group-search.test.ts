import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultGroupCommands, defaultGroupWelcome, defaultJoinApproval, defaultKickRules, defaultSpamSettings, type AdminGroupView } from "../types.js";
import { searchGroups, summarizeGroups, type GroupQuery } from "./group-search.js";

function group(groupId: string, name: string, overrides: Partial<AdminGroupView> = {}): AdminGroupView {
  return {
    groupId,
    name,
    creatorId: "owner",
    adminIds: [],
    memberCount: 10,
    botEnabled: false,
    linkGuardEnabled: false,
    badWordFilterEnabled: false,
    spamGuardEnabled: false,
    spamSettings: defaultSpamSettings,
    joinApproval: defaultJoinApproval,
    commands: defaultGroupCommands,
    welcome: defaultGroupWelcome,
    kickRules: defaultKickRules,
    botIsAdmin: false,
    updatedAt: 0,
    ...overrides,
  };
}

const kickLinks = { ...defaultKickRules, link: { enabled: true, count: 3, windowSeconds: 10 } };
const groups = [
  group("100", "Nhóm bán hàng", { botIsAdmin: true, botEnabled: true, linkGuardEnabled: true, kickRules: kickLinks }),
  group("200", "Nhóm bạn bè", { botEnabled: true, badWordFilterEnabled: true, linkGuardEnabled: true, kickRules: kickLinks }),
  group("300", "Cộng đồng lập trình", { botIsAdmin: true, linkGuardEnabled: true }),
  group("400", "Đội bóng phường", { botEnabled: false, spamGuardEnabled: true }),
  group("500", "Hội phụ huynh"),
  group("600", "Chợ cư dân", { botIsAdmin: true, botEnabled: true, spamGuardEnabled: true, kickRules: { ...defaultKickRules, spam: { enabled: true, count: 3, windowSeconds: 60 } } }),
];
// Real Zalo IDs are long numbers; these two also contain "10" and "12345".
const numbered = [
  group("9090374647943076923", "Group 10"),
  group("4410561234598800172", "Group 2"),
  group("7781002233445566778", "Đã xong 12345"),
];
const query = (overrides: Partial<GroupQuery> = {}): GroupQuery => ({ text: "", filter: "all", page: 1, pageSize: 25, ...overrides });
const ids = (overrides: Partial<GroupQuery>) => searchGroups(groups, query(overrides)).items.map((item) => item.groupId);

await test("finds groups by name without needing diacritics or matching case", () => {
  assert.deepEqual(ids({ text: "nhom" }), ["100", "200"]);
  assert.deepEqual(ids({ text: "  BÁN hàng " }), ["100"]);
  assert.deepEqual(ids({ text: "doi bong" }), ["400"]);
  assert.deepEqual(ids({ text: "không có" }), []);
});

await test("finds a group by a long enough part of its ID", () => {
  const found = (text: string) => searchGroups(numbered, query({ text })).items.map((item) => item.name);
  assert.deepEqual(found("9090374647943076923"), ["Group 10"]);
  assert.deepEqual(found("909037"), ["Group 10"]);
});

await test("a short number only searches names, not IDs", () => {
  const found = (text: string) => searchGroups(numbered, query({ text })).items.map((item) => item.name);
  // "10" is inside two of the IDs and "12345" inside another, but only the names count here.
  assert.deepEqual(found("10"), ["Group 10"]);
  assert.deepEqual(found("12345"), ["Đã xong 12345"]);
  assert.deepEqual(found("2"), ["Group 2", "Đã xong 12345"]);
});

await test("applies the filter together with the search text", () => {
  assert.deepEqual(ids({ filter: "enabled" }), ["100", "200", "600"]);
  assert.deepEqual(ids({ filter: "admin" }), ["100", "300", "600"]);
  assert.deepEqual(ids({ filter: "member" }), ["200", "400", "500"]);
  assert.deepEqual(ids({ filter: "member", text: "nhom" }), ["200"]);
});

await test("pages the matches and reports the total", () => {
  const first = searchGroups(groups, query({ pageSize: 2 }));
  assert.deepEqual([first.items.map((item) => item.groupId), first.total, first.page, first.pageSize], [["100", "200"], 6, 1, 2]);
  assert.deepEqual(ids({ pageSize: 2, page: 3 }), ["500", "600"]);
});

await test("clamps a page past the end to the last page", () => {
  const page = searchGroups(groups, query({ pageSize: 2, page: 99 }));
  assert.deepEqual([page.page, page.items.map((item) => item.groupId)], [3, ["500", "600"]]);
  assert.equal(searchGroups(groups, query({ text: "zzz", page: 4 })).page, 1);
});

await test("summarises the groups for the dashboard", () => {
  // Groups 300 and 400 have a feature set but the bot off, and group 200 kicks on paper but the bot is not an admin there.
  assert.deepEqual(summarizeGroups(groups), { total: 6, botAdmin: 3, enabled: 3, linkGuard: 2, badWordFilter: 1, spamGuard: 1, kicking: 2 });
});
