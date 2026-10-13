import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { noActivity, type ActivityRecorder } from "../activity/activity-log.js";
import type { Store } from "../storage/store.js";
import type { ZaloLoginState } from "../zalo/auth.js";
import { isRecord } from "../utils.js";
import type { LoginCodeService } from "./login-code.js";
import { isValidPin, type AdminPin, type UnlockPasses } from "./pin.js";
import { endSession, isAuthenticated, startSession } from "./session.js";

export type Gate = Readonly<{
  app: Express;
  // Hands over to the admin API once the bot is signed in to Zalo.
  open(adminApp: Express, loginCodes: LoginCodeService): void;
}>;

export type GateOptions = Readonly<{
  store: Store;
  pin: AdminPin;
  passes: UnlockPasses;
  adminEmail: string | undefined;
  zaloState: () => ZaloLoginState;
  activity?: ActivityRecorder;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameText(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// Everything a visitor goes through before the dashboard opens, in this order: the admin's email and
// PIN, the bot's own sign-in to Zalo by QR code when it has no session, then a code the bot sends
// to the admin over Zalo, which is what makes a browser remembered. It listens before the bot is
// signed in, so that the QR code can be shown on the dashboard.
export function createGate({ store, pin, passes, adminEmail, zaloState, activity = noActivity }: GateOptions): Gate {
  const app = express();
  let adminApp: Express | undefined;
  let loginCodes: LoginCodeService | undefined;
  const log = (title: string, more: Readonly<{ ok?: boolean; error?: string }> = {}): void => activity.record({ category: "system", actor: "admin", title, ...more });
  const readJson = express.json({ limit: "4kb" });

  app.disable("x-powered-by");
  app.use("/api/auth", (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });

  const emailMatches = (value: unknown): boolean => adminEmail !== undefined && typeof value === "string" && sameText(value.trim().toLowerCase(), adminEmail);
  const refuseWhileLocked = (response: Response): boolean => {
    const wait = pin.lockedForSeconds();
    if (wait === 0) return false;
    response.status(429).json({ error: `Nhập sai quá nhiều lần, hãy thử lại sau ${Math.ceil(wait / 60)} phút` });
    return true;
  };
  // The steps after the PIN are open to a browser that has just entered it, or that is already signed in.
  const requireUnlocked = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (passes.has(request) || await isAuthenticated(request, store)) {
      next();
      return;
    }
    response.status(401).json({ error: "Hãy nhập mã PIN trước" });
  };

  app.get("/api/auth/session", async (request, response) => {
    response.json({
      authenticated: await isAuthenticated(request, store),
      unlocked: passes.has(request),
      pinSet: await pin.isSet(),
      emailConfigured: adminEmail !== undefined,
      botReady: adminApp !== undefined,
    });
  });
  // The PIN is chosen once, by whoever knows the admin's email from the bot's configuration.
  app.post("/api/auth/pin/setup", readJson, async (request, response) => {
    const body: unknown = request.body;
    if (adminEmail === undefined) {
      response.status(409).json({ error: "Chưa đặt ADMIN_EMAIL trong file .env của bot" });
      return;
    }
    if (await pin.isSet()) {
      response.status(409).json({ error: "Mã PIN đã được đặt" });
      return;
    }
    if (refuseWhileLocked(response)) return;
    if (!isRecord(body) || !emailMatches(body.email)) {
      pin.fail();
      response.status(401).json({ error: "Email không khớp với email quản trị đã cấu hình" });
      return;
    }
    if (!isValidPin(body.pin)) {
      response.status(400).json({ error: "Mã PIN phải gồm đúng 6 chữ số" });
      return;
    }
    await pin.set(body.pin);
    passes.grant(response);
    log("Đặt mã PIN trang quản trị");
    response.json({ ok: true });
  });
  app.post("/api/auth/pin/unlock", readJson, async (request, response) => {
    const body: unknown = request.body;
    if (refuseWhileLocked(response)) return;
    const emailOk = isRecord(body) && emailMatches(body.email);
    // The PIN is checked even when the email is wrong, so the answer takes as long either way.
    const check = await pin.verify(isRecord(body) ? body.pin : undefined, emailOk);
    if (!check.ok) {
      if (refuseWhileLocked(response)) return;
      response.status(401).json({ error: "Email hoặc mã PIN không đúng" });
      return;
    }
    passes.grant(response);
    response.json({ ok: true });
  });
  // The bot's sign-in to Zalo: the QR code to scan while it has no session.
  app.get("/api/auth/bot", requireUnlocked, (_request, response) => {
    const state = zaloState();
    response.json(adminApp === undefined && state.status === "ready" ? { status: "starting" } : state);
  });
  app.post("/api/auth/code", requireUnlocked, async (_request, response) => {
    if (loginCodes === undefined) {
      response.status(409).json({ error: "Bot chưa đăng nhập Zalo" });
      return;
    }
    try {
      const result = await loginCodes.request();
      if (!result.sent) {
        response.status(429).json({ error: `Vừa gửi mã, hãy thử lại sau ${result.retryAfterSeconds} giây` });
        return;
      }
      log("Gửi mã đăng nhập trang quản trị");
      response.json({ ok: true });
    } catch (error: unknown) {
      console.error("[LOGIN CODE FAILED]", errorMessage(error));
      log("Gửi mã đăng nhập trang quản trị", { ok: false, error: errorMessage(error) });
      response.status(502).json({ error: "Không gửi được mã đăng nhập qua Zalo" });
    }
  });
  app.post("/api/auth/login", requireUnlocked, readJson, async (request, response) => {
    const body: unknown = request.body;
    const code = isRecord(body) ? body.code : undefined;
    const remember = isRecord(body) && body.remember === true;
    if (loginCodes === undefined || typeof code !== "string" || !loginCodes.verify(code)) {
      response.status(401).json({ error: "Mã không đúng hoặc đã hết hạn" });
      return;
    }
    passes.revoke(request, response);
    await startSession(store, response, remember);
    log("Đăng nhập trang quản trị");
    response.json({ ok: true });
  });
  app.post("/api/auth/logout", async (request, response) => {
    // The route is open to visitors, so only a real sign-out is written into the history.
    const signedIn = await isAuthenticated(request, store);
    passes.revoke(request, response);
    await endSession(store, request, response);
    if (signedIn) log("Đăng xuất trang quản trị");
    response.json({ ok: true });
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (adminApp !== undefined) adminApp(request, response, next);
    else response.status(503).json({ error: "Bot chưa đăng nhập Zalo" });
  });

  return {
    app,
    open(admin, codes) {
      adminApp = admin;
      loginCodes = codes;
    },
  };
}
