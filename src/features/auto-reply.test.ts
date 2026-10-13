import assert from "node:assert/strict";
import { test } from "node:test";
import { AutoReplies, type AutoReplyStore } from "../auto-reply/auto-replies.js";
import type { GroupMessageContext } from "../bot/feature.js";
import type { AutoReplyRule, MessageImage } from "../types.js";
import { AutoReplyFeature } from "./auto-reply.js";

const rule = (id: string, overrides: Partial<AutoReplyRule>): AutoReplyRule => ({
  id, kind: "keyword", match: "contains", triggers: ["giá"], text: "Bảng giá ở tin ghim", imageCount: 0, groupIds: [], cooldownSeconds: 60, enabled: true, createdAt: 1, updatedAt: 1, sentCount: 0, lastSentAt: null, ...overrides,
});

// The feature over rules kept in memory and a fake Zalo that records what is sent.
async function setup(rules: AutoReplyRule[], options: { refuseQuote?: boolean; images?: MessageImage[] } = {}) {
  const sent: { msg: string; quoted: boolean; attachments: number; groupId: string }[] = [];
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
    sendMessage: (content: { msg: string; quote?: unknown; attachments?: unknown[] }, groupId: string) => {
      if (content.quote !== undefined && options.refuseQuote === true) return Promise.reject(new Error("Tham số không hợp lệ"));
      sent.push({ msg: content.msg, quoted: content.quote !== undefined, attachments: content.attachments?.length ?? 0, groupId });
      return Promise.resolve({});
    },
  } as unknown as ConstructorParameters<typeof AutoReplyFeature>[0];
  const replies = await AutoReplies.load(store);
  const feature = new AutoReplyFeature(api, replies);
  const say = (content: unknown, groupId = "g1") => feature.onGroupMessage({ message: { data: { content, msgId: "m1" } }, groupId, userId: "u1" } as unknown as GroupMessageContext);
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
