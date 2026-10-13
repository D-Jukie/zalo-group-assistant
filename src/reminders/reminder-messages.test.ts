import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminGroupView, ScheduledReminderMessage, StoredGroup } from "../types.js";
import { readImageInfo } from "./image-size.js";
import { parseMessageRequest, parseReminderMessage, parseReminderMessageEdit, parseReminderRequest } from "./reminder.js";
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
  const picture = (width: number, height: number) => ({ data: png(width, height).toString("base64") });
  const withImages = parseReminderMessage({ text: "", images: [picture(10, 20), { data: jpeg(30, 40).toString("base64") }] });
  assert.ok(typeof withImages === "object");
  assert.equal(withImages.text, "");
  assert.deepEqual(withImages.images?.map((image) => [image.extension, image.width, image.height]), [["png", 10, 20], ["jpg", 30, 40]]);
  // An empty list of pictures is the same as none.
  assert.deepEqual(parseReminderMessage({ text: "x", images: [] }), { text: "x" });
  assert.equal(typeof parseReminderMessage({ text: "x", images: Array.from({ length: 6 }, () => picture(2, 2)) }), "object");
  for (const invalid of ["text", { text: "   " }, { text: "", images: [] }, { text: "a".repeat(2001) }, { text: "x", images: [{ data: Buffer.from("not a picture").toString("base64") }] }, { text: "x", images: [{}] }, { text: "x", images: "one" }, { text: "x", images: Array.from({ length: 7 }, () => picture(2, 2)) }]) {
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

await test("checks a request to schedule a message on its own", () => {
  const now = 1_000_000;
  const valid = { message: { text: " Thông báo nghỉ lễ " }, startTime: now + 60_000, repeat: "weekly", groupIds: ["g1", "g2", "g1"] };
  assert.deepEqual(parseMessageRequest(valid, now), { message: { text: "Thông báo nghỉ lễ" }, startTime: now + 60_000, repeat: "weekly", groupIds: ["g1", "g2"], sendNow: false });
  // Sent at once, a message needs no time.
  assert.deepEqual(parseMessageRequest({ message: { text: "Gửi ngay" }, groupIds: ["g1"], sendNow: true }, now), { message: { text: "Gửi ngay" }, groupIds: ["g1"], sendNow: true });
  assert.equal(typeof parseMessageRequest({ message: { text: "Gửi ngay" }, groupIds: [], sendNow: true }, now), "string");
  for (const invalid of [null, { ...valid, message: undefined }, { ...valid, message: { text: "" } }, { ...valid, startTime: now }, { ...valid, repeat: "yearly" }, { ...valid, groupIds: [] }]) {
    assert.equal(typeof parseMessageRequest(invalid, now), "string");
  }
});

await test("a message scheduled on its own is queued for each switched-on group", async () => {
  const queued: Omit<ScheduledReminderMessage, "id">[] = [];
  const queue = { addReminderMessage: (message: Omit<ScheduledReminderMessage, "id">) => { queued.push(message); return Promise.resolve(); }, removeReminderMessages: () => Promise.resolve(), listReminderMessageKeys: () => Promise.resolve(new Set<string>()) };
  const board = new ReminderBoard({} as ConstructorParameters<typeof ReminderBoard>[0], { ownId: "bot", listGroups: () => Promise.resolve([{ groupId: "g1", name: "Nhóm g1", botEnabled: true }, { groupId: "g9", name: "Nhóm tắt", botEnabled: false }] as AdminGroupView[]) }, queue, 0);
  const results = await board.scheduleMessage({ text: "Thông báo" }, { startTime: 5_000_000, repeat: "daily" }, ["g1", "g9"]);
  assert.deepEqual(results.map((item) => [item.groupId, item.ok]), [["g1", true], ["g9", false]]);
  assert.deepEqual(queued, [{ text: "Thông báo", groupId: "g1", reminderId: "", title: "", dueAt: 5_000_000, startTime: 5_000_000, repeat: "daily" }]);
});

await test("a message sent at once goes to each switched-on group, and one failure does not stop the rest", async () => {
  const sent: string[] = [];
  const api = { sendMessage: (_content: unknown, groupId: string) => { sent.push(groupId); return groupId === "g2" ? Promise.reject(new Error("Nhóm đã khóa gửi tin")) : Promise.resolve({}); } } as unknown as ConstructorParameters<typeof ReminderBoard>[0];
  const allGroups = { ownId: "bot", listGroups: () => Promise.resolve(["g1", "g2", "g3"].map((groupId) => ({ groupId, name: `Nhóm ${groupId}`, botEnabled: true }) as AdminGroupView)) };
  const queue = { addReminderMessage: () => Promise.resolve(), removeReminderMessages: () => Promise.resolve(), listReminderMessageKeys: () => Promise.resolve(new Set<string>()) };
  const results = await new ReminderBoard(api, allGroups, queue, 0).sendMessageNow({ text: "Thông báo" }, ["g1", "g2", "nope", "g3"]);
  assert.deepEqual(results.map((item) => [item.groupId, item.ok, item.error ?? null]), [["g1", true, null], ["g2", false, "Nhóm đã khóa gửi tin"], ["nope", false, "Bot không ở trong nhóm này hoặc chưa được bật"], ["g3", true, null]]);
  assert.deepEqual(sent, ["g1", "g2", "g3"]);
});

await test("reads a change to a waiting message", () => {
  assert.deepEqual(parseReminderMessageEdit({ text: "  Đổi nội dung  " }), { text: "Đổi nội dung" });
  assert.deepEqual(parseReminderMessageEdit({ text: "", images: [] }), { text: "", images: [] });
  // The new list mixes pictures the message already has with new ones, in the order they should be sent.
  const changed = parseReminderMessageEdit({ text: "x", images: [{ keep: 1 }, { data: png(8, 6).toString("base64") }, { keep: 0 }] });
  assert.ok(typeof changed === "object" && changed.images !== undefined);
  assert.deepEqual(changed.images.map((image) => "keep" in image ? image.keep : [image.extension, image.width, image.height]), [1, ["png", 8, 6], 0]);
  for (const invalid of [null, {}, { text: 5 }, { text: "a".repeat(2001) }, { text: "x", images: [{ data: "bm9wZQ==" }] }, { text: "x", images: [{ keep: -1 }] }, { text: "x", images: Array.from({ length: 7 }, () => ({ keep: 0 })) }]) {
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
  const images = [{ data: png(4, 4), extension: "png" as const, width: 4, height: 4 }, { data: jpeg(8, 6), extension: "jpg" as const, width: 8, height: 6 }];
  const results = await new ReminderBoard(api, groups, queue, 0).create({ title: "Họp", startTime: 5_000_000, repeat: "weekly", onCreate: { text: "Vừa tạo nhắc hẹn", images }, onDue: { text: "Đến giờ họp" } }, ["g1", "g2"]);

  assert.deepEqual(results, [
    { groupId: "g1", groupName: "Nhóm g1", ok: true },
    { groupId: "g2", groupName: "Nhóm g2", ok: true, warning: "Không gửi được tin nhắn khi tạo: Nhóm đã khóa gửi tin" },
  ]);
  const [content, threadId] = sent[0] as [{ msg: string; attachments: { filename: string; metadata: unknown }[] }, string];
  assert.equal(threadId, "g1");
  assert.equal(content.msg, "Vừa tạo nhắc hẹn");
  assert.deepEqual(content.attachments.map((item) => [item.filename, item.metadata]), [["nhac-hen-1.png", { totalSize: 24, width: 4, height: 4 }], ["nhac-hen-2.jpg", { totalSize: jpeg(8, 6).length, width: 8, height: 6 }]]);
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
