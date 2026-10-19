import assert from "node:assert/strict";
import test from "node:test";
import type { NewActivity } from "../types.js";
import { BotSessions, type SessionRun } from "./sessions.js";

// Lets every pending step of the loop happen.
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

type Setup = Readonly<{ failStart?: number; failStop?: boolean; failSignOut?: boolean }>;

function setup({ failStart = 0, failStop = false, failSignOut = false }: Setup = {}) {
  const log: string[] = [];
  const history: NewActivity[] = [];
  let logins = 0;
  let starts = 0;
  const sessions = new BotSessions<string>({
    login: {
      run: () => {
        logins += 1;
        log.push(`login ${logins}`);
        return Promise.resolve(`account ${logins}`);
      },
      signOut: () => {
        log.push("forget session");
        return failSignOut ? Promise.reject(new Error("database down")) : Promise.resolve();
      },
    },
    start: (api) => {
      starts += 1;
      if (starts <= failStart) {
        log.push(`start ${api} failed`);
        return Promise.reject(new Error("Zalo refused"));
      }
      const run: SessionRun = {
        open: () => log.push(`open ${api}`),
        stop: () => {
          log.push(`stop ${api}`);
          if (failStop && api === "account 1") throw new Error("listener stuck");
        },
        account: () => api,
      };
      return Promise.resolve(run);
    },
    closeGate: () => log.push("close gate"),
    activity: { record: (entry) => history.push(entry) },
    retryDelayMs: 5,
    sleep: () => Promise.resolve(),
  });
  return { sessions, log, history };
}

await test("signing out stops the bot, forgets its session and goes back to signing in for the next account", async () => {
  const { sessions, log, history } = setup();
  const loop = sessions.run();
  await settle();
  assert.equal(sessions.isRunning, true);
  await sessions.signOut();
  await settle();
  assert.deepEqual(log, ["login 1", "open account 1", "close gate", "stop account 1", "forget session", "login 2", "open account 2"]);
  assert.deepEqual(history.map((entry) => [entry.title, entry.actor, entry.detail]), [["Đăng xuất tài khoản Zalo của bot", "admin", "account 1"]]);
  assert.equal(sessions.shutdown(), true);
  await loop;
});

await test("there is nothing to sign out before the bot has signed in", async () => {
  const { sessions } = setup();
  await assert.rejects(sessions.signOut(), /Bot chưa đăng nhập Zalo/u);
});

await test("a bot that will not stop, or a session that cannot be forgotten, still goes back to signing in", async () => {
  for (const options of [{ failStop: true }, { failSignOut: true }]) {
    const { sessions, log } = setup(options);
    const loop = sessions.run();
    await settle();
    await assert.rejects(sessions.signOut());
    await settle();
    assert.equal(log.at(-1), "open account 2");
    assert.equal(sessions.isRunning, true);
    sessions.shutdown();
    await loop;
  }
});

await test("a bot that fails to start is written down and tried again instead of ending the process", async () => {
  const { sessions, log, history } = setup({ failStart: 2 });
  const loop = sessions.run();
  await settle();
  assert.deepEqual(log, ["login 1", "start account 1 failed", "login 2", "start account 2 failed", "login 3", "open account 3"]);
  assert.deepEqual(history.map((entry) => [entry.title, entry.ok, entry.error]), [["Bot khởi động", false, "Zalo refused"], ["Bot khởi động", false, "Zalo refused"]]);
  sessions.shutdown();
  await loop;
});

await test("shutting down says whether a bot was running, and ends the loop", async () => {
  const { sessions, log } = setup();
  assert.equal(sessions.shutdown(), false);
  await sessions.run();
  assert.deepEqual(log, []);
  const second = setup();
  const loop = second.sessions.run();
  await settle();
  assert.equal(second.sessions.shutdown(), true);
  await loop;
  assert.deepEqual(second.log, ["login 1", "open account 1", "stop account 1"]);
});
