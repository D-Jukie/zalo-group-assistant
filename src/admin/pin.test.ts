import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { EncryptedSecret } from "../storage/secret-box.js";
import { AdminPin, isValidPin, type PinStore } from "./pin.js";

function memoryStore(): PinStore & { secrets: Map<string, EncryptedSecret> } {
  const secrets = new Map<string, EncryptedSecret>();
  return {
    secrets,
    getSecret: (name) => Promise.resolve(secrets.get(name)),
    setSecret: (name, secret) => {
      secrets.set(name, secret);
      return Promise.resolve();
    },
  };
}

await test("a PIN is exactly 6 digits", () => {
  assert.equal(isValidPin("123456"), true);
  assert.equal(isValidPin("12345"), false);
  assert.equal(isValidPin("1234567"), false);
  assert.equal(isValidPin("12345a"), false);
  assert.equal(isValidPin(123456), false);
});

await test("there is no PIN until one is set, and the PIN itself is not what gets stored", async () => {
  const store = memoryStore();
  const pin = new AdminPin(store, randomBytes(32));
  assert.equal(await pin.isSet(), false);
  assert.deepEqual(await pin.verify("482915"), { ok: false });
  await pin.set("482915");
  assert.equal(await pin.isSet(), true);
  assert.equal(JSON.stringify(Array.from(store.secrets.values())).includes("482915"), false);
});

await test("only the PIN that was set is accepted", async () => {
  const pin = new AdminPin(memoryStore(), randomBytes(32));
  await pin.set("482915");
  assert.deepEqual(await pin.verify("482915"), { ok: true });
  assert.deepEqual(await pin.verify("482916"), { ok: false });
  assert.deepEqual(await pin.verify(undefined), { ok: false });
});

await test("a PIN saved under another key counts as not set", async () => {
  const store = memoryStore();
  await new AdminPin(store, randomBytes(32)).set("482915");
  assert.equal(await new AdminPin(store, randomBytes(32)).isSet(), false);
});

await test("five wrong tries pause every try, the right PIN included", async () => {
  const pin = new AdminPin(memoryStore(), randomBytes(32));
  await pin.set("482915");
  for (let attempt = 0; attempt < 4; attempt += 1) assert.deepEqual(await pin.verify("000000"), { ok: false });
  const fifth = await pin.verify("000000");
  assert.equal(fifth.ok, false);
  assert.equal(pin.lockedForSeconds() > 0, true);
  const blocked = await pin.verify("482915");
  assert.equal(blocked.ok, false);
});

await test("a right PIN clears the count of wrong tries", async () => {
  const pin = new AdminPin(memoryStore(), randomBytes(32));
  await pin.set("482915");
  for (let attempt = 0; attempt < 4; attempt += 1) await pin.verify("000000");
  assert.deepEqual(await pin.verify("482915"), { ok: true });
  for (let attempt = 0; attempt < 4; attempt += 1) await pin.verify("000000");
  assert.equal(pin.lockedForSeconds(), 0);
});

await test("the right PIN with a wrong email is a wrong try, and does not clear the count", async () => {
  const pin = new AdminPin(memoryStore(), randomBytes(32));
  await pin.set("482915");
  for (let attempt = 0; attempt < 4; attempt += 1) assert.deepEqual(await pin.verify("482915", false), { ok: false });
  assert.equal(pin.lockedForSeconds(), 0);
  assert.equal((await pin.verify("482915", false)).ok, false);
  assert.equal(pin.lockedForSeconds() > 0, true);
});
