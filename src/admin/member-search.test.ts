import assert from "node:assert/strict";
import { test } from "node:test";
import type { GroupMember } from "../types.js";
import { searchMembers } from "./member-search.js";

const member = (userId: string, name: string, violations = 0, accountCreatedAt: number | null = null): GroupMember => ({ userId, name, avatar: "", accountCreatedAt, role: "member", isBot: false, violations, kicks: 0 });
const members = [member("1003", "Lê Văn Cường", 2, 300), member("1001", "Nguyễn Văn A", 5, 100), member("1002", "Trần Thị Bình", 0, 900), member("1004", "", 0, null)];
const ids = (text: string, sort: "name" | "violations" | "newest" = "name") => searchMembers(members, { text, sort, page: 1, pageSize: 10 }).items.map((item) => item.userId);

await test("finds members by name without accents, or by part of their ID", () => {
  assert.deepEqual(ids("nguyen"), ["1001"]);
  assert.deepEqual(ids("VAN"), ["1003", "1001"]);
  assert.deepEqual(ids("1004"), ["1004"]);
  assert.deepEqual(ids("không có"), []);
});

await test("orders by name, by violations or by the youngest account", () => {
  assert.deepEqual(ids(""), ["1004", "1003", "1001", "1002"]);
  assert.deepEqual(ids("", "violations"), ["1001", "1003", "1004", "1002"]);
  assert.deepEqual(ids("", "newest"), ["1002", "1003", "1001", "1004"]);
});

await test("the owner and the deputies lead the list, whatever the order", () => {
  const led = [...members, { ...member("2001", "Zung Phó Nhóm", 0, 50), role: "admin" as const }, { ...member("2002", "Yến Trưởng Nhóm", 0, 10), role: "owner" as const }, { ...member("2003", "An Phó Nhóm", 9, 20), role: "admin" as const }];
  const order = (sort: "name" | "violations" | "newest") => searchMembers(led, { text: "", sort, page: 1, pageSize: 10 }).items.map((item) => item.userId);
  assert.deepEqual(order("name"), ["2002", "2003", "2001", "1004", "1003", "1001", "1002"]);
  assert.deepEqual(order("violations"), ["2002", "2003", "2001", "1001", "1003", "1004", "1002"]);
  assert.deepEqual(order("newest"), ["2002", "2001", "2003", "1002", "1003", "1001", "1004"]);
});

await test("pages the result and keeps a page number in range", () => {
  const page = searchMembers(members, { text: "", sort: "name", page: 9, pageSize: 3 });
  assert.deepEqual([page.total, page.page, page.items.length], [4, 2, 1]);
});
