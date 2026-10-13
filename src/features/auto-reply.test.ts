import assert from "node:assert/strict";
import { test } from "node:test";
import { AutoReplies, type AutoReplyStore } from "../auto-reply/auto-replies.js";
import type { GroupMessageContext } from "../bot/feature.js";
import type { AutoReplyRule, MemberProfile, MessageImage } from "../types.js";
import { AutoReplyFeature } from "./auto-reply.js";

const rule = (id: string, overrides: Partial<AutoReplyRule>): AutoReplyRule => ({
  id, kind: "keyword", match: "contains", triggers: ["giá"], text: "Bảng giá ở tin ghim", imageCount: 0, groupIds: [], cooldownSeconds: 60, enabled: true, createdAt: 1, updatedAt: 1, sentCount: 0, lastSentAt: null, ...overrides,
});

// The feature over rules kept in memory and a fake Zalo that records what is sent.
async function setup(rules: AutoReplyRule[], options: { refuseQuote?: boolean; images?: MessageImage[]; random?: { enabled: boolean; adminOnly: boolean }; members?: MemberProfile[]; complete?: boolean } = {}) {
  const sent: { msg: string; quoted: boolean; attachments: number; groupId: string; mentions?: { pos: number; uid: string; len: number }[] }[] = [];
  const counted: string[] = [];
  const store: AutoReplyStore = {
    listAutoReplies: () => Promise.resolve(rules),
    createAutoReply: () => Promise.resolve("saved"),
    updateAutoReply: () => Promise.resolve("saved"),
    setAutoReplyEnabled: () => Promise.resolve(true),
    deleteAutoReplies: () => Promise.resolve(0),
    getAutoReplyImages: () => Promise.resolve(options.images ?? []),
    recordAutoReplySent: (id) => { counted.push(id); return Promise.resolve(); },
  };
  const api = {
    sendMessage: (content: { msg: string; quote?: unknown; attachments?: unknown[]; mentions?: { pos: number; uid: string; len: number }[] }, groupId: string) => {
      if (content.quote !== undefined && options.refuseQuote === true) return Promise.reject(new Error("Tham số không hợp lệ"));
      sent.push({ msg: content.msg, quoted: content.quote !== undefined, attachments: content.attachments?.length ?? 0, groupId, ...(content.mentions === undefined ? {} : { mentions: content.mentions }) });
      return Promise.resolve({});
    },
  } as unknown as ConstructorParameters<typeof AutoReplyFeature>[0];
  const replies = await AutoReplies.load(store);
  const members = { ownId: "bot", listMembers: () => Promise.resolve({ members: options.members ?? [], complete: options.complete ?? true }) };
  const feature = new AutoReplyFeature(api, replies, members);
  const group = { commands: { random: options.random ?? { enabled: false, adminOnly: false } } };
  const say = (content: unknown, groupId = "g1", senderIsAdmin = false) => feature.onGroupMessage({ message: { data: { content, msgId: "m1" } }, groupId, userId: "u1", group, senderIsAdmin } as unknown as GroupMessageContext);
  return { say, sent, counted, replies };
}

await test("answers a keyword by quoting the message, and counts the answer", async () => {
  const { say, sent, counted, replies } = await setup([rule("r1", {})]);
  await say("cho hỏi giá với");
  assert.deepEqual(sent, [{ msg: "Bảng giá ở tin ghim", quoted: true, attachments: 0, groupId: "g1" }]);
  assert.deepEqual(counted, ["r1"]);
  assert.equal(replies.list()[0]?.sentCount, 1);
});

await test("stays quiet for messages that match nothing, and for anything that is not typed text", async () => {
  const { say, sent } = await setup([rule("r1", {})]);
  await say("chào cả nhà");
  await say({ title: "giá", description: "giá" });
  assert.deepEqual(sent, []);
});

await test("a rule rests after answering in a group, but not in another group", async () => {
  const { say, sent } = await setup([rule("r1", {})]);
  await say("giá?");
  await say("giá bao nhiêu");
  await say("giá?", "g2");
  assert.deepEqual(sent.map((item) => item.groupId), ["g1", "g2"]);
  // Without a rest time every message is answered.
  const eager = await setup([rule("r1", { cooldownSeconds: 0 })]);
  await eager.say("giá?");
  await eager.say("giá?");
  assert.equal(eager.sent.length, 2);
});

await test("still answers, without the quote, when Zalo refuses the quote", async () => {
  const { say, sent } = await setup([rule("r1", {})], { refuseQuote: true });
  await say("giá?");
  assert.deepEqual(sent, [{ msg: "Bảng giá ở tin ghim", quoted: false, attachments: 0, groupId: "g1" }]);
});

await test("an answer with pictures sends them along", async () => {
  const picture = { data: Buffer.alloc(24), extension: "png" as const, width: 4, height: 4 };
  const { say, sent } = await setup([rule("r1", { kind: "command", match: "exact", triggers: ["/huongdan"], text: "Xem hướng dẫn trong ảnh", imageCount: 2 })], { images: [picture, picture] });
  await say("/huongdan");
  assert.deepEqual(sent, [{ msg: "Xem hướng dẫn trong ảnh", quoted: false, attachments: 2, groupId: "g1" }]);
});

const member = (userId: string, name: string): MemberProfile => ({ userId, name, avatar: "", accountCreatedAt: null });
const everyone = [member("bot", "Bot"), member("u1", "Nguyễn Văn A"), member("u2", "Trần Thị B"), member("u3", "Lê Văn C")];
const on = { enabled: true, adminOnly: false };

await test("/random picks a member of the group, never the bot, and mentions them", async () => {
  const { say, sent } = await setup([], { random: on, members: everyone });
  await say("/random");
  assert.equal(sent.length, 1);
  const [answer] = sent;
  assert.ok(answer !== undefined && answer.mentions !== undefined);
  assert.match(answer.msg, /^🎲 Chọn ngẫu nhiên 1 trong 3 thành viên:\n@/u);
  const [mention] = answer.mentions;
  assert.ok(mention !== undefined && ["u1", "u2", "u3"].includes(mention.uid));
  assert.equal(answer.msg.slice(mention.pos, mention.pos + mention.len), `@${everyone.find((item) => item.userId === mention.uid)?.name ?? ""}`);
});

await test("/random with a count picks that many different members", async () => {
  const { say, sent } = await setup([], { random: on, members: everyone, complete: false });
  await say("/random 2");
  const [answer] = sent;
  assert.ok(answer !== undefined && answer.mentions !== undefined);
  assert.match(answer.msg, /^🎲 Chọn ngẫu nhiên 2 trong 3 thành viên bot đọc được:\n1\. @.+\n2\. @/u);
  assert.equal(new Set(answer.mentions.map((mention) => mention.uid)).size, 2);
});

await test("/random with a range answers a number inside it", async () => {
  const { say, sent } = await setup([], { random: on });
  await say("/random 10-12");
  const found = /^🎲 Số ngẫu nhiên từ 10 đến 12: (\d+)$/u.exec(sent[0]?.msg ?? "");
  assert.ok(found !== null && Number(found[1]) >= 10 && Number(found[1]) <= 12);
  assert.equal(sent[0]?.quoted, true);
});

await test("/random explains itself when it cannot read what follows, and rests between answers", async () => {
  const { say, sent } = await setup([], { random: on });
  await say("/random abc");
  assert.match(sent[0]?.msg ?? "", /^Cách dùng: \/random/u);
  // Typed again at once, it stays quiet.
  await say("/random 1-6");
  assert.equal(sent.length, 1);
  // In another group it answers.
  await say("/random 1-6", "g2");
  assert.equal(sent.length, 2);
});

await test("/random does nothing where it is off, and only answers admins where it is for admins", async () => {
  const off = await setup([], { members: everyone });
  await off.say("/random");
  assert.deepEqual(off.sent, []);
  const adminsOnly = await setup([], { random: { enabled: true, adminOnly: true } });
  await adminsOnly.say("/random 1-6");
  assert.deepEqual(adminsOnly.sent, []);
  await adminsOnly.say("/random 1-6", "g1", true);
  assert.equal(adminsOnly.sent.length, 1);
});

await test("an admin's own /random answer is used while the built-in command is off, and gives way once it is on", async () => {
  const own = rule("r1", { kind: "command", match: "exact", triggers: ["/random"], text: "Lệnh quay số đang tắt", cooldownSeconds: 0 });
  const off = await setup([own]);
  await off.say("/random");
  assert.deepEqual(off.sent.map((item) => item.msg), ["Lệnh quay số đang tắt"]);
  const switchedOn = await setup([own], { random: on });
  await switchedOn.say("/random 1-1");
  assert.deepEqual(switchedOn.sent.map((item) => item.msg), ["🎲 Số ngẫu nhiên từ 1 đến 1: 1"]);
});
