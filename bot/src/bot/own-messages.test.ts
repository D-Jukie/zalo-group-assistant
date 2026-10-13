import assert from "node:assert/strict";
import test from "node:test";
import { OwnMessages } from "./own-messages.js";

await test("a message echoed before it is asked for is known at once", async () => {
  const own = new OwnMessages();
  own.note("1", "c1");
  assert.deepEqual(await own.resolve(["1"], 0), [{ msgId: "1", cliMsgId: "c1" }]);
});

await test("a message is waited for until its echo arrives", async () => {
  const own = new OwnMessages();
  const pending = own.resolve(["1", "2"], 1000);
  own.note("2", "c2");
  own.note("1", "c1");
  assert.deepEqual(await pending, [{ msgId: "1", cliMsgId: "c1" }, { msgId: "2", cliMsgId: "c2" }]);
});

await test("a message whose echo does not come in time is kept without its second id, and can be found later", async () => {
  const own = new OwnMessages();
  assert.deepEqual(await own.resolve(["1"], 10), [{ msgId: "1" }]);
  own.note("1", "c1");
  assert.equal(own.clientIdOf("1"), "c1");
});
