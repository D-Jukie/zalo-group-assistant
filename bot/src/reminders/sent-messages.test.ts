import assert from "node:assert/strict";
import test from "node:test";
import { parseReminderMessage } from "./reminder.js";
import { ReminderBoard } from "./reminder-board.js";
import { sendGroupMessage } from "./reminder-messenger.js";
import type { AdminGroupView } from "../types.js";

type Api = Parameters<typeof sendGroupMessage>[0];

function recordingApi(answers: unknown[]): { api: Api; sent: unknown[] } {
  const sent: unknown[] = [];
  const api = { sendMessage: (content: unknown) => { sent.push(content); return Promise.resolve(answers.shift()); } } as unknown as Api;
  return { api, sent };
}

await test("sending answers with the ids of the messages that went out", async () => {
  const { api } = recordingApi([{ message: { msgId: 11 }, attachment: [] }]);
  assert.deepEqual(await sendGroupMessage(api, "g1", { text: "Thông báo" }), ["11"]);
});

await test("a message marked important or urgent is sent with that mark, an ordinary one without", async () => {
  const { api, sent } = recordingApi([undefined, undefined, undefined]);
  await sendGroupMessage(api, "g1", { text: "a" });
  await sendGroupMessage(api, "g1", { text: "b", urgency: "important" });
  await sendGroupMessage(api, "g1", { text: "c", urgency: "urgent" });
  assert.deepEqual(sent, [{ msg: "a" }, { msg: "b", urgency: 1 }, { msg: "c", urgency: 2 }]);
});

await test("the mark of a message is read from a request, and anything else is refused", () => {
  assert.deepEqual(parseReminderMessage({ text: "a", urgency: "urgent" }), { text: "a", urgency: "urgent" });
  assert.deepEqual(parseReminderMessage({ text: "a", urgency: "normal" }), { text: "a" });
  assert.deepEqual(parseReminderMessage({ text: "a" }), { text: "a" });
  assert.equal(parseReminderMessage({ text: "a", urgency: "loud" }), "Mức độ của tin nhắn không hợp lệ");
});

await test("a round sent at once names the messages of each group, with the second id when it is known", async () => {
  const { api } = recordingApi([{ message: { msgId: 11 }, attachment: [] }, { message: { msgId: 22 }, attachment: [] }]);
  const groups = { ownId: "bot", listGroups: () => Promise.resolve([{ groupId: "g1", name: "Nhóm 1", botEnabled: true }, { groupId: "g2", name: "Nhóm 2", botEnabled: true }] as AdminGroupView[]) };
  const queue = { addReminderMessage: () => Promise.resolve(), removeReminderMessages: () => Promise.resolve(), listReminderMessageKeys: () => Promise.resolve(new Set<string>()) };
  const sent = { resolve: (msgIds: readonly string[]) => Promise.resolve(msgIds.map((msgId) => (msgId === "11" ? { msgId, cliMsgId: "c11" } : { msgId }))) };
  const results = await new ReminderBoard(api as unknown as ConstructorParameters<typeof ReminderBoard>[0], groups, queue, 0, sent).sendMessageNow({ text: "Thông báo" }, ["g1", "g2", "nope"]);
  assert.deepEqual(results, [
    { groupId: "g1", groupName: "Nhóm 1", ok: true, messages: [{ msgId: "11", cliMsgId: "c11" }] },
    { groupId: "g2", groupName: "Nhóm 2", ok: true, messages: [{ msgId: "22" }] },
    { groupId: "nope", groupName: "", ok: false, error: "Bot không ở trong nhóm này hoặc chưa được bật", messages: [] },
  ]);
});
