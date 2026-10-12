import assert from "node:assert/strict";
import { test } from "node:test";
import { ThreadType, type Message } from "zca-js";
import { defaultKickRules, type KickRules, type StoredGroup } from "../types.js";
import { Enforcer, type EnforcerApi, type EnforcerStore } from "./enforcer.js";

type Scenario = Readonly<{
  botIsAdmin?: boolean;
  kickEnabled?: boolean;
  kickRules?: KickRules;
  // What the store reports as the member's violations of the rule inside the window.
  recent?: number;
  failRecording?: boolean;
  failDelete?: boolean;
  rejectKick?: boolean;
}>;

function setup(scenario: Scenario = {}) {
  const calls: string[] = [];
  const api = {
    deleteMessage: () => {
      calls.push("delete");
      return scenario.failDelete === true ? Promise.reject(new Error("refused")) : Promise.resolve({ status: 0 });
    },
    removeUserFromGroup: (userId: string) => {
      calls.push("kick");
      return Promise.resolve({ errorMembers: scenario.rejectKick === true ? [userId] : [] });
    },
  } as unknown as EnforcerApi;
  const store: EnforcerStore = {
    recordViolation: (_groupId, _userId, _userName, rule) => {
      if (scenario.failRecording === true) return Promise.reject(new Error("database down"));
      calls.push(`record:${rule}`);
      return Promise.resolve();
    },
    logViolationMessage: (_groupId, message, match) => {
      calls.push(`log:${match.rule}:${message.text}`);
      return Promise.resolve();
    },
    setViolationMessageStatus: (_groupId, _messageId, status) => {
      calls.push(`status:${status}`);
      return Promise.resolve();
    },
    countRecentViolations: (_groupId, _userId, rule, windowSeconds) => {
      calls.push(`count:${rule}:${windowSeconds}`);
      return Promise.resolve(scenario.recent ?? 0);
    },
    recordKick: () => {
      calls.push("recordKick");
      return Promise.resolve();
    },
  };
  const group: StoredGroup = {
    groupId: "g1",
    name: "Test",
    creatorId: "owner",
    adminIds: [],
    memberCount: 3,
    botEnabled: true,
    badWordFilterEnabled: true,
    kickEnabled: scenario.kickEnabled ?? true,
    kickRules: scenario.kickRules ?? defaultKickRules,
    updatedAt: 0,
  };
  const message = {
    type: ThreadType.Group,
    threadId: "g1",
    isSelf: false,
    data: { uidFrom: "u1", dName: "Member", msgId: "m1", cliMsgId: "c1", msgType: "webchat", content: "hello" },
  } as unknown as Message;
  const report = new Enforcer(api, store).forMessage({ message, group, botIsAdmin: scenario.botIsAdmin ?? true });
  return { calls, report };
}

const neverKick: KickRules = { link: { count: 0, windowSeconds: 10 }, badWord: { count: 0, windowSeconds: 600 } };
const kickLinksAt3: KickRules = { ...neverKick, link: { count: 3, windowSeconds: 10 } };

await test("deletes, records and logs the message, and never kicks while the count is 0", async () => {
  const { calls, report } = setup({ kickRules: neverKick, recent: 99 });
  await report("link", "zalo.me/g/x");
  assert.deepEqual(calls, ["delete", "record:link", "log:link:hello", "status:deleted"]);
});

await test("does not kick while the group's kick switch is off", async () => {
  const { calls, report } = setup({ kickEnabled: false, kickRules: kickLinksAt3, recent: 99 });
  await report("link", "zalo.me/g/x");
  assert.deepEqual(calls, ["delete", "record:link", "log:link:hello", "status:deleted"]);
});

await test("kicks by the default rules once the switch is on", async () => {
  assert.deepEqual(defaultKickRules, { link: { count: 3, windowSeconds: 10 }, badWord: { count: 3, windowSeconds: 600 } });
  const { calls, report } = setup({ recent: 3 });
  await report("badWord", "word");
  assert.ok(calls.includes("count:badWord:600"));
  assert.ok(calls.includes("kick"));
});

await test("only records when the bot has no admin rights", async () => {
  const { calls, report } = setup({ botIsAdmin: false, kickRules: kickLinksAt3, recent: 5 });
  await report("link", "zalo.me/g/x");
  assert.deepEqual(calls, ["record:link", "log:link:hello"]);
});

await test("kicks once the rule's count is reached inside its window", async () => {
  const below = setup({ kickRules: kickLinksAt3, recent: 2 });
  await below.report("link", "zalo.me/g/x");
  assert.ok(below.calls.includes("count:link:10"));
  assert.ok(!below.calls.includes("kick"));

  const reached = setup({ kickRules: kickLinksAt3, recent: 3 });
  await reached.report("link", "zalo.me/g/x");
  assert.deepEqual(reached.calls.slice(-2), ["kick", "recordKick"]);
});

await test("applies each rule's own setting", async () => {
  const { calls, report } = setup({ kickRules: kickLinksAt3, recent: 50 });
  await report("badWord", "word");
  assert.ok(!calls.some((call) => call.startsWith("count:")));
  assert.ok(!calls.includes("kick"));
});

await test("deletes a message once when it breaks two rules", async () => {
  const { calls, report } = setup({ kickRules: neverKick });
  await Promise.all([report("link", "zalo.me/g/x"), report("badWord", "word")]);
  assert.equal(calls.filter((call) => call === "delete").length, 1);
  assert.deepEqual(calls.filter((call) => call.startsWith("record:")).sort(), ["record:badWord", "record:link"]);
});

await test("still deletes when the database fails, and does not kick", async () => {
  const { calls, report } = setup({ failRecording: true, kickRules: kickLinksAt3, recent: 3 });
  await report("link", "zalo.me/g/x");
  assert.deepEqual(calls, ["delete"]);
});

await test("marks a failed deletion", async () => {
  const { calls, report } = setup({ failDelete: true });
  await report("link", "zalo.me/g/x");
  assert.ok(calls.includes("status:deleteFailed"));
});

await test("does not record a kick that Zalo rejected", async () => {
  const { calls, report } = setup({ kickRules: kickLinksAt3, recent: 3, rejectKick: true });
  await report("link", "zalo.me/g/x");
  assert.ok(calls.includes("kick"));
  assert.ok(!calls.includes("recordKick"));
});
