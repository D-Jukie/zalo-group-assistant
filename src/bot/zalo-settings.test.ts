import assert from "node:assert/strict";
import test from "node:test";
import type { GroupSetting } from "zca-js";
import { describeSettingsChange, parseZaloSettingsChange, readInviteLink, readZaloSettings, settingsUpdate } from "./zalo-settings.js";

const current: GroupSetting = { blockName: 1, signAdminMsg: 0, addMemberOnly: 0, setTopicOnly: 1, enableMsgHistory: 1, joinAppr: 0, lockCreatePost: 0, lockCreatePoll: 0, lockSendMsg: 0, lockViewMember: 1, bannFeature: 0, dirtyMedia: 0, banDuration: 0 };

await test("reads Zalo's settings as on or off", () => {
  assert.deepEqual(readZaloSettings(current), { lockSendMsg: false, joinAppr: false, blockName: true, signAdminMsg: false, enableMsgHistory: true, setTopicOnly: true, lockCreatePost: false, lockCreatePoll: false });
});

await test("a change names known settings with true or false, and nothing else", () => {
  assert.deepEqual(parseZaloSettingsChange({ joinAppr: true, lockSendMsg: false }), { joinAppr: true, lockSendMsg: false });
  assert.equal(parseZaloSettingsChange({}), undefined);
  assert.equal(parseZaloSettingsChange({ joinAppr: 1 }), undefined);
  assert.equal(parseZaloSettingsChange({ lockViewMember: true }), undefined);
  assert.equal(parseZaloSettingsChange({ joinAppr: true, other: true }), undefined);
  assert.equal(parseZaloSettingsChange("joinAppr"), undefined);
});

await test("a change goes to Zalo with every setting the group has now", () => {
  assert.deepEqual(settingsUpdate(current, { joinAppr: true, blockName: false }), {
    lockSendMsg: false, joinAppr: true, blockName: false, signAdminMsg: false, enableMsgHistory: true, setTopicOnly: true, lockCreatePost: false, lockCreatePoll: false, lockViewMember: true,
  });
});

await test("tells a change in words", () => {
  assert.equal(describeSettingsChange({ joinAppr: true, lockCreatePoll: false }), "Bật duyệt thành viên mới, tắt khóa tạo bình chọn");
});

await test("reads an invite link, with its expiry in milliseconds", () => {
  assert.deepEqual(readInviteLink({ enabled: 0 }), { enabled: false });
  assert.deepEqual(readInviteLink({ enabled: 1, link: "" }), { enabled: false });
  assert.deepEqual(readInviteLink({ enabled: 1, link: "https://zalo.me/g/abc", expiration_date: 0 }), { enabled: true, link: "https://zalo.me/g/abc" });
  assert.deepEqual(readInviteLink({ enabled: 1, link: "https://zalo.me/g/abc", expiration_date: 1_800_000_000 }), { enabled: true, link: "https://zalo.me/g/abc", expiresAt: 1_800_000_000_000 });
});
