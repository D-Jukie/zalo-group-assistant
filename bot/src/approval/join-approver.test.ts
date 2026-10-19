import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultGroupCommands, defaultGroupWelcome, defaultQuietHours, defaultKickRules, defaultSpamSettings, type JoinApprovalSettings, type JoinReview, type LiveGroupInfo, type NewActivity, type StoredGroup } from "../types.js";
import { JoinApprover } from "./join-approver.js";

const day = 24 * 60 * 60 * 1000;
const photo = "https://s120-ava-talk.zadn.vn/17/abc.jpg";
const noPhoto = "https://s120-ava-talk.zadn.vn/default";

type Waiting = Readonly<{ uid: string; dpn: string; avatar: string; ageDays: number }>;

// A group with a waiting list, a fake Zalo that records what is decided, and the approver over them.
function setup(options: Readonly<{ waiting: readonly Waiting[]; settings?: Partial<JoinApprovalSettings>; totalMember?: number; botEnabled?: boolean; adminIds?: readonly string[]; refuse?: Readonly<Record<string, number>> }>) {
  const decided: { members: string[]; approve: boolean }[] = [];
  const logged: Omit<JoinReview, "at">[] = [];
  const history: NewActivity[] = [];
  let waiting = [...options.waiting];
  const info = { groupId: "g1", creatorId: "owner", adminIds: options.adminIds ?? ["bot"], totalMember: options.totalMember ?? 10, maxMember: 1000, setting: { joinAppr: 1 } } as unknown as LiveGroupInfo;
  const group = {
    groupId: "g1", name: "Nhóm", creatorId: "owner", adminIds: [], memberCount: 10, botEnabled: options.botEnabled ?? true, linkGuardEnabled: false, badWordFilterEnabled: false, spamGuardEnabled: false,
    spamSettings: defaultSpamSettings, joinApproval: { enabled: true, requireAvatar: true, minAccountAgeDays: 90, ...options.settings }, commands: defaultGroupCommands, welcome: defaultGroupWelcome, quietHours: defaultQuietHours, quietHoursState: null, kickRules: defaultKickRules, updatedAt: 0,
  } satisfies StoredGroup;
  const api = {
    listener: { on: () => undefined },
    getPendingGroupMembers: () => Promise.resolve({ time: 0, users: waiting.map((user) => ({ uid: user.uid, dpn: user.dpn, avatar: user.avatar, user_submit: null })) }),
    getUserInfo: (ids: string[]) => Promise.resolve({ unchanged_profiles: {}, phonebook_version: 0, changed_profiles: Object.fromEntries(ids.map((id) => [`${id}_0`, { userId: id, createdTs: Math.floor((Date.now() - (waiting.find((user) => user.uid === id)?.ageDays ?? 0) * day) / 1000) }])) }),
    reviewPendingMemberRequest: (payload: { members: string[]; isApprove: boolean }) => {
      decided.push({ members: payload.members, approve: payload.isApprove });
      const done = payload.members.filter((id) => options.refuse?.[id] === undefined);
      waiting = waiting.filter((user) => !done.includes(user.uid));
      return Promise.resolve(Object.fromEntries(payload.members.map((id) => [id, options.refuse?.[id] ?? 0])));
    },
  } as unknown as ConstructorParameters<typeof JoinApprover>[0];
  const groups = { ownId: "bot", syncGroup: () => Promise.resolve(info), isInGroup: () => Promise.resolve(true) };
  const store = { getGroup: () => Promise.resolve(group), listGroups: () => Promise.resolve([group]), logJoinReview: (_groupId: string, review: Omit<JoinReview, "at">) => { logged.push(review); return Promise.resolve(); } };
  return { approver: new JoinApprover(api, groups, store, { record: (entry) => history.push(entry) }), decided, logged, history };
}

const waiting: Waiting[] = [
  { uid: "old", dpn: "Tài khoản lâu năm", avatar: photo, ageDays: 800 },
  { uid: "new", dpn: "Tài khoản mới", avatar: photo, ageDays: 5 },
  { uid: "faceless", dpn: "Không ảnh", avatar: noPhoto, ageDays: 800 },
  { uid: "fine", dpn: "Đủ điều kiện", avatar: photo, ageDays: 120 },
];

await test("lets in the applicants who meet the criteria and leaves the rest waiting", async () => {
  const { approver, decided, logged } = setup({ waiting });
  await approver.process("g1");
  assert.deepEqual(decided, [{ members: ["old", "fine"], approve: true }]);
  assert.deepEqual(logged.map((review) => [review.userId, review.decision, review.by]), [["old", "approved", "auto"], ["fine", "approved", "auto"]]);
  // Nobody is turned away by the bot: the two who fail are still in the list, with the reason.
  const list = await approver.listPending("g1");
  assert.deepEqual(list.items.map((item) => [item.userId, item.reasons]), [["new", ["Tham gia Zalo chưa đủ 3 tháng"]], ["faceless", ["Chưa có ảnh đại diện"]]]);
});

await test("never lets in more people than the group has room for", async () => {
  const almostFull = setup({ waiting, totalMember: 999 });
  await almostFull.approver.process("g1");
  assert.deepEqual(almostFull.decided, [{ members: ["old"], approve: true }]);
  const full = setup({ waiting, totalMember: 1000 });
  await full.approver.process("g1");
  assert.deepEqual(full.decided, []);
  assert.equal((await full.approver.listPending("g1")).freeSlots, 0);
});

await test("does nothing where the bot is off, the feature is off, or the bot is not an admin", async () => {
  for (const options of [{ botEnabled: false }, { settings: { enabled: false } }, { adminIds: [] }]) {
    const { approver, decided } = setup({ waiting, ...options });
    await approver.process("g1");
    assert.deepEqual(decided, []);
  }
});

await test("an admin's decision is carried out, logged, and stops where the group is full", async () => {
  const { approver, decided, logged } = setup({ waiting, totalMember: 999, refuse: { gone: 170 } });
  const approved = await approver.review("g1", ["new", "faceless"], true);
  assert.deepEqual(approved.map((result) => [result.userId, result.ok, result.error ?? null]), [["new", true, null], ["faceless", false, "Nhóm đã đủ 1000 thành viên"]]);
  const rejected = await approver.review("g1", ["faceless", "gone"], false);
  assert.deepEqual(rejected.map((result) => [result.userId, result.ok, result.error ?? null]), [["faceless", true, null], ["gone", false, "Không còn trong danh sách chờ"]]);
  assert.deepEqual(decided, [{ members: ["new"], approve: true }, { members: ["faceless", "gone"], approve: false }]);
  assert.deepEqual(logged.map((review) => [review.userId, review.userName, review.decision, review.by]), [["new", "Tài khoản mới", "approved", "manual"], ["faceless", "Không ảnh", "rejected", "manual"]]);
});

await test("each decision goes into the history: the bot's own, an admin's, and one Zalo refused", async () => {
  const { approver, history } = setup({ waiting, refuse: { gone: 170 } });
  await approver.process("g1");
  await approver.review("g1", ["faceless", "gone"], false);
  assert.deepEqual(history.map((entry) => [entry.actor, entry.title, entry.userName, entry.ok ?? true, entry.error ?? ""]), [
    ["bot", "Duyệt vào nhóm", "Tài khoản lâu năm", true, ""],
    ["bot", "Duyệt vào nhóm", "Đủ điều kiện", true, ""],
    ["admin", "Từ chối vào nhóm", "Không ảnh", true, ""],
    ["admin", "Từ chối vào nhóm", "", false, "Không còn trong danh sách chờ"],
  ]);
});
