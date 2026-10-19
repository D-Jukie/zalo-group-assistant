import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type { Store } from "../storage/store.js";
import type { ZaloLoginState } from "../zalo/auth.js";
import { createGate } from "./gate.js";
import type { LoginCodeService } from "./login-code.js";
import type { AdminPin, UnlockPasses } from "./pin.js";

async function setup() {
  const state = { signedIn: false, zalo: { status: "ready" } as ZaloLoginState, signOuts: 0, failSignOut: false };
  // Only what the routes below use: whether the browser's cookie names a signed-in admin.
  const store = { hasSession: () => Promise.resolve(state.signedIn) } as unknown as Store;
  const gate = createGate({
    store,
    pin: {} as AdminPin,
    passes: { has: () => false } as unknown as UnlockPasses,
    adminEmail: "admin@example.com",
    zaloState: () => state.zalo,
    signOutBot: () => {
      state.signOuts += 1;
      if (state.failSignOut) return Promise.reject(new Error("database down"));
      gate.close();
      return Promise.resolve();
    },
  });
  const admin = express();
  admin.get("/api/status", (_request, response) => {
    response.json({ ok: true });
  });
  const server = gate.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const call = async (method: "GET" | "POST", path: string) => {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { method, headers: { cookie: "zalo_admin_session=token" } });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { state, gate, admin, server, call };
}

await test("only a signed-in admin can sign the bot out of Zalo, and only while it is signed in", async () => {
  const { state, gate, admin, server, call } = await setup();
  try {
    assert.equal((await call("POST", "/api/auth/bot/logout")).status, 401);
    state.signedIn = true;
    assert.equal((await call("POST", "/api/auth/bot/logout")).status, 409);
    gate.open(admin, {} as LoginCodeService);
    assert.equal((await call("GET", "/api/status")).status, 200);
    assert.deepEqual(await call("POST", "/api/auth/bot/logout"), { status: 200, body: { ok: true } });
    assert.equal(state.signOuts, 1);
    // A second press finds the bot already signed out.
    assert.equal((await call("POST", "/api/auth/bot/logout")).status, 409);
    assert.equal(state.signOuts, 1);
  } finally {
    server.close();
  }
});

await test("a sign-out that fails is reported with the reason", async () => {
  const { state, gate, admin, server, call } = await setup();
  try {
    state.signedIn = true;
    state.failSignOut = true;
    gate.open(admin, {} as LoginCodeService);
    const answer = await call("POST", "/api/auth/bot/logout");
    assert.equal(answer.status, 500);
    assert.match(String(answer.body.error), /database down/u);
  } finally {
    server.close();
  }
});

await test("the dashboard is sent to the QR code only when one is waiting to be scanned, not while the bot starts up", async () => {
  const { state, server, call } = await setup();
  try {
    state.signedIn = true;
    state.zalo = { status: "starting" };
    assert.deepEqual(await call("GET", "/api/status"), { status: 503, body: { error: "Bot chưa đăng nhập Zalo" } });
    state.zalo = { status: "ready" };
    assert.equal((await call("GET", "/api/status")).body.code, undefined);
    state.zalo = { status: "qr", image: "data:image/png;base64," };
    assert.deepEqual(await call("GET", "/api/status"), { status: 503, body: { error: "Bot chưa đăng nhập Zalo", code: "bot-signed-out" } });
  } finally {
    server.close();
  }
});
