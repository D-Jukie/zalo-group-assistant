import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminGroupView, ScheduledReminderMessage, StoredGroup } from "../types.js";
import { readImageInfo } from "./image-size.js";
import { parseReminderMessage, parseReminderMessageEdit, parseReminderRequest } from "./reminder.js";
import { ReminderBoard } from "./reminder-board.js";
import { ReminderMessenger } from "./reminder-messenger.js";

// The smallest files that still say what they are and how large the picture is.
function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "latin1");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]);
}

function webp(width: number, height: number): Buffer {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "latin1");
  data.write("WEBP", 8, "latin1");
  data.write("VP8X", 12, "latin1");
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

await test("reads the kind and size of a picture from the file itself", () => {
  assert.deepEqual(readImageInfo(png(640, 480)), { extension: "png", width: 640, height: 480 });
  assert.deepEqual(readImageInfo(jpeg(1280, 720)), { extension: "jpg", width: 1280, height: 720 });
  assert.deepEqual(readImageInfo(webp(300, 200)), { extension: "webp", width: 300, height: 200 });
  assert.equal(readImageInfo(Buffer.from("GIF89a not supported")), undefined);
  assert.equal(readImageInfo(Buffer.from("<script>alert(1)</script>")), undefined);
  assert.equal(readImageInfo(Buffer.alloc(0)), undefined);
});

await test("reads the optional messages of a reminder request", () => {
  assert.equal(parseReminderMessage(undefined), undefined);
  assert.deepEqual(parseReminderMessage({ text: "  Nhớ tham gia nhé  " }), { text: "Nhớ tham gia nhé" });
  const withImage = parseReminderMessage({ text: "", image: { data: png(10, 20).toString("base64") } });
  assert.ok(typeof withImage === "object");
  assert.deepEqual({ text: withImage.text, extension: withImage.image?.extension, width: withImage.image?.width, height: withImage.image?.height }, { text: "", extension: "png", width: 10, height: 20 });
  for (const invalid of ["text", { text: "   " }, { text: "a".repeat(2001) }, { text: "x", image: { data: Buffer.from("not a picture").toString("base64") } }, { text: "x", image: {} }]) {
    assert.equal(typeof parseReminderMessage(invalid), "string");
  }
});

await test("a reminder request carries its messages, and says which one is wrong", () => {
  const now = 1_000_000;
  const base = { title: "Họp", startTime: now + 60_000, repeat: "none", groupIds: ["g1"] };
  assert.deepEqual(parseReminderRequest({ ...base, onDue: { text: "Đến giờ rồi" } }, now), { ...base, onDue: { text: "Đến giờ rồi" } });
  const refusal = (body: unknown) => { const parsed = parseReminderRequest(body, now); return typeof parsed === "string" ? parsed : ""; };
  assert.match(refusal({ ...base, onCreate: { text: "" } }), /^Tin nhắn khi tạo: /u);
  assert.match(refusal({ ...base, onDue: { text: "" } }), /^Tin nhắn khi đến giờ: /u);
});

await test("reads a change to a waiting message", () => {
  assert.deepEqual(parseReminderMessageEdit({ text: "  Đổi nội dung  " }), { text: "Đổi nội dung" });
  assert.deepEqual(parseReminderMessageEdit({ text: "", image: null }), { text: "", image: null });
  const replaced = parseReminderMessageEdit({ text: "x", image: { data: png(8, 6).toString("base64") } });
  assert.ok(typeof replaced === "object" && replaced.image !== null && replaced.image !== undefined);
  assert.deepEqual([replaced.image.extension, replaced.image.width, replaced.image.height], ["png", 8, 6]);
  for (const invalid of [null, {}, { text: 5 }, { text: "a".repeat(2001) }, { text: "x", image: { data: "bm9wZQ==" } }]) {
    assert.equal(typeof parseReminderMessageEdit(invalid), "string");
  }
});

const group = (groupId: string) => ({ groupId, name: `Nhóm ${groupId}`, botEnabled: true }) as AdminGroupView;
const groups = { ownId: "bot", listGroups: () => Promise.resolve([group("g1"), group("g2")]) };

await test("creating a reminder posts its first message and queues the one for its time", async () => {
  const sent: unknown[][] = [];
  const queued: Omit<ScheduledReminderMessage, "id">[] = [];
  const api = {
    // Zalo answers one group with the new reminder's ID and the other without it.
    createReminder: (_options: unknown, groupId: string) => Promise.resolve(groupId === "g1" ? { id: "r-g1" } : {}),
    getListReminder: (_options: unknown, groupId: string) => Promise.resolve([{ id: `board-${groupId}`, startTime: 5_000_000, creatorId: "bot", params: { title: "Họp" } }]),
    sendMessage: (...args: unknown[]) => {
      sent.push(args);
      return args[1] === "g2" ? Promise.reject(new Error("Nhóm đã khóa gửi tin")) : Promise.resolve({});
    },
  } as unknown as ConstructorParameters<typeof ReminderBoard>[0];
  const queue = { addReminderMessage: (message: Omit<ScheduledReminderMessage, "id">) => { queued.push(message); return Promise.resolve(); }, removeReminderMessages: () => Promise.resolve(), listReminderMessageKeys: () => Promise.resolve(new Set<string>()) };
  const image = { data: png(4, 4), extension: "png" as const, width: 4, height: 4 };
  const results = await new ReminderBoard(api, groups, queue, 0).create({ title: "Họp", startTime: 5_000_000, repeat: "weekly", onCreate: { text: "Vừa tạo nhắc hẹn", image }, onDue: { text: "Đến giờ họp" } }, ["g1", "g2"]);

  assert.deepEqual(results, [
    { groupId: "g1", groupName: "Nhóm g1", ok: true },
    { groupId: "g2", groupName: "Nhóm g2", ok: true, warning: "Không gửi được tin nhắn khi tạo: Nhóm đã khóa gửi tin" },
  ]);
  const [content, threadId] = sent[0] as [{ msg: string; attachments: { filename: string; metadata: unknown }[] }, string];
  assert.equal(threadId, "g1");
  assert.equal(content.msg, "Vừa tạo nhắc hẹn");
  assert.deepEqual(content.attachments.map((item) => [item.filename, item.metadata]), [["nhac-hen.png", { totalSize: 24, width: 4, height: 4 }]]);
  assert.deepEqual(queued.map((item) => [item.groupId, item.reminderId, item.text, item.dueAt, item.repeat]), [
    ["g1", "r-g1", "Đến giờ họp", 5_000_000, "weekly"],
    ["g2", "board-g2", "Đến giờ họp", 5_000_000, "weekly"],
  ]);
});

// A queue kept in memory, with the same take-before-send behaviour as the stored one.
function fakeStore(messages: ScheduledReminderMessage[], enabledGroups: readonly string[]) {
  return {
    messages,
    getGroup: (groupId: string) => Promise.resolve({ groupId, botEnabled: enabledGroups.includes(groupId) } as StoredGroup),
    findDueReminderMessage: (at: number) => Promise.resolve(messages.filter((item) => item.dueAt <= at).sort((left, right) => left.dueAt - right.dueAt)[0]),
    claimReminderMessage: (message: ScheduledReminderMessage, nextDueAt: number | null) => {
      const index = messages.findIndex((item) => item.id === message.id && item.dueAt === message.dueAt);
      if (index < 0) return Promise.resolve(false);
      if (nextDueAt === null) messages.splice(index, 1);
      else messages[index] = { ...message, dueAt: nextDueAt };
      return Promise.resolve(true);
    },
  };
}

const minute = 60_000;
const day = 24 * 60 * minute;
const scheduled = (id: string, groupId: string, dueAt: number, repeat: ScheduledReminderMessage["repeat"] = "none"): ScheduledReminderMessage => ({ id, groupId, reminderId: `r-${id}`, title: "Họp", text: `tin ${id}`, dueAt, startTime: dueAt, repeat });

await test("sends each message once its time has come, and only once", async () => {
  const start = 10 * day;
  const sent: string[] = [];
  const api = { sendMessage: (content: { msg: string }) => { sent.push(content.msg); return Promise.resolve({}); } } as unknown as ConstructorParameters<typeof ReminderMessenger>[0];
  const store = fakeStore([scheduled("a", "g1", start), scheduled("b", "g1", start + 10 * minute), scheduled("daily", "g1", start, "daily")], ["g1"]);
  const messenger = new ReminderMessenger(api, store);

  await messenger.tick(start - 1);
  assert.deepEqual(sent, []);
  await messenger.tick(start + 5_000);
  assert.deepEqual(sent.sort(), ["tin a", "tin daily"]);
  await messenger.tick(start + 20_000);
  assert.equal(sent.length, 2);
  // The one-off message is gone; the daily one waits for tomorrow.
  assert.deepEqual(store.messages.map((item) => [item.id, item.dueAt]), [["b", start + 10 * minute], ["daily", start + day]]);
  await messenger.tick(start + 11 * minute);
  assert.deepEqual(sent.sort(), ["tin a", "tin b", "tin daily"]);
  await messenger.tick(start + day + 1_000);
  assert.deepEqual(sent.sort(), ["tin a", "tin b", "tin daily", "tin daily"]);
});

await test("does not send a message long after its time, or to a group the bot is off for", async () => {
  const start = 10 * day;
  const sent: string[] = [];
  const api = { sendMessage: (content: { msg: string }) => { sent.push(content.msg); return Promise.resolve({}); } } as unknown as ConstructorParameters<typeof ReminderMessenger>[0];
  const store = fakeStore([scheduled("late", "g1", start - 2 * 60 * minute), scheduled("off", "g2", start), scheduled("ok", "g1", start - 5 * minute)], ["g1"]);
  await new ReminderMessenger(api, store).tick(start);
  assert.deepEqual(sent, ["tin ok"]);
  assert.deepEqual(store.messages, []);
});
