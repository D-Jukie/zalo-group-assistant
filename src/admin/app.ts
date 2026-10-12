import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { SimpleBot } from "../bot/simple-bot.js";
import type { Store } from "../storage/store.js";
import { violationRules, type GroupSetting, type ViolationRule } from "../types.js";
import type { BannedWords } from "../moderation/banned-words.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import { isRecord } from "../utils.js";
import type { LoginCodeService } from "./login-code.js";
import { adminHtml } from "./admin-page.js";
import { loginHtml } from "./pages.js";
import { authMiddleware, endSession, isAuthenticated, startSession } from "./session.js";

// URL segment of each per-group switch on the admin page.
const groupToggles: ReadonlyMap<string, GroupSetting> = new Map([
  ["bot", "botEnabled"],
  ["bad-words", "badWordFilterEnabled"],
  ["kick", "kickEnabled"],
]);
const maxKickCount = 100;
const maxKickWindowSeconds = 7 * 24 * 60 * 60;

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function createAdminApp(bot: SimpleBot, store: Store, loginCodes: LoginCodeService, blockedLinks: BlockedLinks, bannedWords: BannedWords): Express {
  const app = express();
  const auth = authMiddleware(store);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.json({ ok: true, ownId: bot.ownId }));
  app.get("/login", async (request, response) => {
    if (await isAuthenticated(request, store)) {
      response.redirect("/admin");
      return;
    }
    response.type("html").send(loginHtml());
  });
  app.post("/login/code", async (_request, response) => {
    try {
      const result = await loginCodes.request();
      if (!result.sent) {
        response.status(429).json({ error: `Vừa gửi mã, hãy thử lại sau ${result.retryAfterSeconds} giây` });
        return;
      }
      response.json({ ok: true });
    } catch (error: unknown) {
      console.error("[LOGIN CODE FAILED]", error instanceof Error ? error.message : String(error));
      response.status(502).json({ error: "Không gửi được mã đăng nhập qua Zalo" });
    }
  });
  app.post("/login", async (request, response) => {
    const body: unknown = request.body;
    const code = isRecord(body) ? body.code : undefined;
    const remember = isRecord(body) && body.remember === true;
    if (typeof code !== "string" || !loginCodes.verify(code)) {
      response.status(401).json({ error: "Mã không đúng hoặc đã hết hạn" });
      return;
    }
    await startSession(store, response, remember);
    response.json({ ok: true });
  });
  app.post("/logout", async (request, response) => {
    await endSession(store, request, response);
    response.json({ ok: true });
  });
  app.get("/admin", async (request, response) => {
    if (!await isAuthenticated(request, store)) {
      response.redirect("/login");
      return;
    }
    response.type("html").send(adminHtml());
  });
  app.use("/api", auth);
  app.use("/api", (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });
  app.get("/api/status", (_request, response) => response.json({ connected: true, ownId: bot.ownId }));
  app.get("/api/groups", async (_request, response) => {
    try {
      response.json(await bot.listGroups());
    } catch (error: unknown) {
      response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.patch("/api/groups/:groupId/kick-rule", async (request, response) => {
    const body: unknown = request.body;
    const rule = isRecord(body) ? violationRules.find((item: ViolationRule) => item === body.rule) : undefined;
    const count = isRecord(body) ? body.count : undefined;
    const windowSeconds = isRecord(body) ? body.windowSeconds : undefined;
    if (rule === undefined || !isIntegerBetween(count, 0, maxKickCount) || !isIntegerBetween(windowSeconds, 1, maxKickWindowSeconds)) {
      response.status(400).json({ error: `Số lần phải từ 0 đến ${maxKickCount} và khoảng thời gian từ 1 giây đến 7 ngày` });
      return;
    }
    const updated = await store.setKickRule(request.params.groupId, rule, { count, windowSeconds });
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(updated);
  });
  app.get("/api/groups/:groupId/violations", async (request, response) => {
    response.json(await store.listViolations(request.params.groupId));
  });
  app.get("/api/groups/:groupId/members/:userId/messages", async (request, response) => {
    response.json(await store.listViolationMessages(request.params.groupId, request.params.userId));
  });
  app.delete("/api/groups/:groupId/violations", async (request, response) => {
    const body: unknown = request.body;
    const userId = isRecord(body) ? body.userId : undefined;
    if (userId !== undefined && typeof userId !== "string") {
      response.status(400).json({ error: "userId phải là chuỗi" });
      return;
    }
    await store.clearViolations(request.params.groupId, userId);
    response.json(await store.listViolations(request.params.groupId));
  });
  app.patch("/api/groups/:groupId/:toggle", async (request, response) => {
    const setting = groupToggles.get(request.params.toggle);
    if (setting === undefined) {
      response.status(404).json({ error: "Not found" });
      return;
    }
    const body: unknown = request.body;
    const enabled = isRecord(body) ? body.enabled : undefined;
    if (typeof enabled !== "boolean") {
      response.status(400).json({ error: "enabled phải là boolean" });
      return;
    }
    // Kicking needs admin rights, so the switch cannot be turned on without them. Turning it off is always allowed.
    if (setting === "kickEnabled" && enabled && !await bot.isBotAdminIn(request.params.groupId)) {
      response.status(409).json({ error: "Bot phải là trưởng/phó nhóm thì mới bật kick được" });
      return;
    }
    const updated = await store.setGroupSetting(request.params.groupId, setting, enabled);
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(updated);
  });
  app.get("/api/banned-words", (_request, response) => response.json(bannedWords.list()));
  app.post("/api/banned-words", async (request, response) => {
    const body: unknown = request.body;
    const word = isRecord(body) ? body.word : undefined;
    try {
      if (typeof word !== "string" || !await bannedWords.add(word)) {
        response.status(400).json({ error: "Từ không hợp lệ; hãy nhập từ hoặc cụm từ dài 2–50 ký tự" });
        return;
      }
      response.json(bannedWords.list());
    } catch (error: unknown) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete("/api/banned-words", async (request, response) => {
    const body: unknown = request.body;
    const word = isRecord(body) ? body.word : undefined;
    if (typeof word !== "string") {
      response.status(400).json({ error: "word phải là chuỗi" });
      return;
    }
    await bannedWords.remove(word);
    response.json(bannedWords.list());
  });
  app.post("/api/banned-words/check", (request, response) => {
    const body: unknown = request.body;
    const text = isRecord(body) ? body.text : undefined;
    response.json({ match: typeof text === "string" ? bannedWords.find(text) ?? null : null });
  });
  app.get("/api/blocked-links", (_request, response) => response.json(blockedLinks.list()));
  app.post("/api/blocked-links", async (request, response) => {
    const body: unknown = request.body;
    const link = isRecord(body) ? body.link : undefined;
    try {
      const added = typeof link === "string" ? await blockedLinks.add(link) : undefined;
      if (added === undefined) {
        response.status(400).json({ error: "Link không hợp lệ; hãy nhập dạng example.com hoặc example.com/duong-dan" });
        return;
      }
      response.json(blockedLinks.list());
    } catch (error: unknown) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete("/api/blocked-links", async (request, response) => {
    const body: unknown = request.body;
    const link = isRecord(body) ? body.link : undefined;
    if (typeof link !== "string") {
      response.status(400).json({ error: "link phải là chuỗi" });
      return;
    }
    await blockedLinks.remove(link);
    response.json(blockedLinks.list());
  });
  app.post("/api/groups/sync", async (_request, response) => {
    try {
      await bot.syncAllGroups();
      response.json({ ok: true });
    } catch (error: unknown) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  return app;
}
