import assert from "node:assert/strict";
import test from "node:test";
import { defaultGroupCommands, defaultGroupWelcome, defaultJoinApproval, defaultKickRules, defaultSpamSettings, type NewActivity, type QuietHoursSettings, type QuietHoursState, type StoredGroup } from "../types.js";
import { QuietHoursKeeper } from "./quiet-hours-keeper.js";
import { describeQuietHours, parseQuietHours, quietWindow } from "./quiet-hours.js";

const night = { start: 23 * 60, end: 6 * 60 };
const noon = { start: 12 * 60, end: 13 * 60 + 30 };
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

await test("reads the hours from a time field, and refuses hours that are equal or not times", () => {
  assert.deepEqual(parseQuietHours({ enabled: true, start: "23:00", end: "06:00" }), { enabled: true, start: 1380, end: 360 });
  assert.deepEqual(parseQuietHours({ enabled: false, start: "7:05", end: "08:30" }), { enabled: false, start: 425, end: 510 });
  assert.equal(parseQuietHours({ enabled: true, start: "22:00", end: "22:00" }), "Giờ bắt đầu và giờ kết thúc phải khác nhau");
  assert.equal(parseQuietHours({ enabled: true, start: "24:00", end: "06:00" }), "Giờ bắt đầu và giờ kết thúc phải có dạng HH:MM");
  assert.equal(parseQuietHours({ start: "23:00", end: "06:00" }), "Cài đặt giờ yên lặng không hợp lệ");
  assert.equal(describeQuietHours(night), "23:00 – 06:00 hôm sau");
  assert.equal(describeQuietHours(noon), "12:00 – 13:30");
});

await test("hours that run past midnight belong to the day they began, until they end", () => {
  assert.equal(quietWindow(night, at(18, 22, 59)), undefined);
  assert.equal(quietWindow(night, at(18, 23)), "2026-10-18");
  assert.equal(quietWindow(night, at(19, 0, 30)), "2026-10-18");
  assert.equal(quietWindow(night, at(19, 5, 59)), "2026-10-18");
  assert.equal(quietWindow(night, at(19, 6)), undefined);
  // The first of the month still belongs to the night that began on the last day of the one before.
  assert.equal(quietWindow(night, at(1, 2)), "2026-09-30");
});

await test("hours within one day start at the start and stop at the end", () => {
  assert.equal(quietWindow(noon, at(19, 11, 59)), undefined);
  assert.equal(quietWindow(noon, at(19, 12)), "2026-10-19");
  assert.equal(quietWindow(noon, at(19, 13, 29)), "2026-10-19");
  assert.equal(quietWindow(noon, at(19, 13, 30)), undefined);
});

function setup(options: Readonly<{ locked?: boolean; inGroup?: boolean; refuse?: boolean; quietHours?: Partial<QuietHoursSettings>; state?: QuietHoursState | null; botEnabled?: boolean }> = {}) {
  const zalo = { lockSendMsg: options.locked ?? false, changes: [] as boolean[], refuse: options.refuse ?? false };
  const history: NewActivity[] = [];
  const group: { current: StoredGroup } = {
    current: {
      groupId: "g1", name: "Lớp A", creatorId: "owner", adminIds: ["bot"], memberCount: 20, botEnabled: options.botEnabled ?? true,
      linkGuardEnabled: false, badWordFilterEnabled: false, spamGuardEnabled: false, spamSettings: defaultSpamSettings, joinApproval: defaultJoinApproval,
      commands: defaultGroupCommands, welcome: defaultGroupWelcome, kickRules: defaultKickRules, updatedAt: 0,
      quietHours: { enabled: true, ...night, ...options.quietHours }, quietHoursState: options.state ?? null,
    },
  };
  const clock = { now: at(18, 23, 1) };
  const keeper = new QuietHoursKeeper(
    {
      isInGroup: () => Promise.resolve(options.inGroup ?? true),
      zaloSettings: () => Promise.resolve({ settings: { lockSendMsg: zalo.lockSendMsg } }),
      updateZaloSettings: (_groupId, change) => {
        if (zalo.refuse) return Promise.reject(new Error("Bot phải là trưởng hoặc phó nhóm"));
        zalo.lockSendMsg = change.lockSendMsg;
        zalo.changes.push(change.lockSendMsg);
        return Promise.resolve();
      },
    },
    {
      listGroups: () => Promise.resolve([group.current]),
      setQuietHoursState: (_groupId, state) => {
        group.current = { ...group.current, quietHoursState: state };
        return Promise.resolve();
      },
    },
    { record: (entry) => history.push(entry) },
    () => clock.now,
  );
  return { keeper, zalo, history, group, clock };
}

await test("locks the chat when the quiet hours begin and unlocks it when they end, once each", async () => {
  const { keeper, zalo, history, group, clock } = setup();
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(zalo.changes, [true]);
  assert.deepEqual(group.current.quietHoursState, { window: "2026-10-18", locked: true });
  clock.now = at(19, 6, 1);
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(zalo.changes, [true, false]);
  assert.deepEqual(history.map((entry) => [entry.title, entry.ok ?? true, entry.groupName]), [["Bắt đầu giờ yên lặng", true, "Lớp A"], ["Kết thúc giờ yên lặng", true, "Lớp A"]]);
});

await test("a chat an admin had locked already is left to them, before and after", async () => {
  const { keeper, zalo, group, clock } = setup({ locked: true });
  await keeper.tick();
  clock.now = at(19, 7);
  await keeper.tick();
  assert.deepEqual(zalo.changes, []);
  assert.equal(zalo.lockSendMsg, true);
  assert.deepEqual(group.current.quietHoursState, { window: "2026-10-18", locked: false });
});

await test("a chat an admin unlocks during the night is not locked again until the next night", async () => {
  const { keeper, zalo, clock } = setup();
  await keeper.tick();
  zalo.lockSendMsg = false;
  clock.now = at(19, 2);
  await keeper.tick();
  clock.now = at(19, 6, 5);
  await keeper.tick();
  // Nothing to unlock in the morning either.
  assert.deepEqual(zalo.changes, [true]);
  clock.now = at(19, 23, 0);
  await keeper.tick();
  assert.deepEqual(zalo.changes, [true, true]);
});

await test("switching the quiet hours off, or the bot off in the group, gives the chat back at once", async () => {
  for (const change of [{ quietHours: { ...night, enabled: false } }, { botEnabled: false }]) {
    const { keeper, zalo, group } = setup();
    await keeper.tick();
    group.current = { ...group.current, ...change };
    await keeper.tick();
    assert.deepEqual(zalo.changes, [true, false]);
  }
});

await test("a group where the bot may not change settings is written down once a night, not on every look", async () => {
  const { keeper, history } = setup({ refuse: true });
  await keeper.tick();
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(history.map((entry) => [entry.title, entry.ok]), [["Bắt đầu giờ yên lặng", false]]);
});

await test("an unlock that fails is tried again until it works, and written down once", async () => {
  const { keeper, zalo, history, group, clock } = setup();
  await keeper.tick();
  zalo.refuse = true;
  clock.now = at(19, 6, 1);
  await keeper.tick();
  await keeper.tick();
  assert.equal(zalo.lockSendMsg, true);
  assert.equal(group.current.quietHoursState?.locked, true);
  zalo.refuse = false;
  await keeper.tick();
  assert.equal(zalo.lockSendMsg, false);
  assert.deepEqual(history.map((entry) => [entry.title, entry.ok ?? true]), [["Bắt đầu giờ yên lặng", true], ["Kết thúc giờ yên lặng", false], ["Kết thúc giờ yên lặng", true]]);
});

await test("a group the bot is no longer in is passed over without asking Zalo", async () => {
  const { keeper, zalo, history, group } = setup({ inGroup: false });
  await keeper.tick();
  assert.deepEqual([zalo.changes, history.length, group.current.quietHoursState], [[], 0, { window: "2026-10-18", locked: false }]);
});
