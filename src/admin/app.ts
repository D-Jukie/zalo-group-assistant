import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { SimpleBot } from "../bot/simple-bot.js";
import type { BannedWords } from "../moderation/banned-words.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import type { Store } from "../storage/store.js";
import { violationRules, type GroupSetting, type ViolationRule } from "../types.js";
import { isRecord } from "../utils.js";
import { groupFilters, searchGroups, summarizeGroups, type GroupFilter } from "./group-search.js";
import type { LoginCodeService } from "./login-code.js";
import { authMiddleware, endSession, isAuthenticated, startSession } from "./session.js";

// URL segment of each per-group switch.
const groupToggles: ReadonlyMap<string, GroupSetting> = new Map([
  ["bot", "botEnabled"],
  ["links", "linkGuardEnabled"],
  ["bad-words", "badWordFilterEnabled"],
]);
const maxKickCount = 100;
const maxKickWindowSeconds = 7 * 24 * 60 * 60;
const overviewDays = 14;
const recentViolationLimit = 20;
const violationPageSize = 30;
const defaultGroupPageSize = 25;
const maxGroupPageSize = 100;
const maxSearchLength = 100;

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// What the blocked links and the banned words have in common, as far as the API is concerned.
type ManagedList = Readonly<{
  list(groupId?: string): readonly string[];
  add(input: string, groupId?: string): Promise<boolean>;
  remove(value: string, groupId?: string): Promise<void>;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Routes for one admin-managed list: read it, add to it, remove from it. With :groupId in the base
// path they serve that group's own list; without it, the list shared by every group.
function registerListRoutes(app: Express, store: Store, base: string, field: string, list: ManagedList, invalidMessage: string): void {
  const scoped = base.includes(":groupId");
  const guard = async (request: Request, response: Response): Promise<{ groupId: string | undefined } | undefined> => {
    const parameter: unknown = scoped ? request.params.groupId : undefined;
    const groupId = typeof parameter === "string" ? parameter : undefined;
    if (groupId !== undefined && await store.getGroup(groupId) === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return undefined;
    }
    return { groupId };
  };
  app.get(base, async (request, response) => {
    const scope = await guard(request, response);
    if (scope !== undefined) response.json(list.list(scope.groupId));
  });
  app.post(base, async (request, response) => {
    const scope = await guard(request, response);
    if (scope === undefined) return;
    const body: unknown = request.body;
    const value = isRecord(body) ? body[field] : undefined;
    try {
      if (typeof value !== "string" || !await list.add(value, scope.groupId)) {
        response.status(400).json({ error: invalidMessage });
        return;
      }
      response.json(list.list(scope.groupId));
    } catch (error: unknown) {
      response.status(400).json({ error: errorMessage(error) });
    }
  });
  app.delete(base, async (request, response) => {
    const scope = await guard(request, response);
    if (scope === undefined) return;
    const body: unknown = request.body;
    const value = isRecord(body) ? body[field] : undefined;
    if (typeof value !== "string") {
      response.status(400).json({ error: `${field} phải là chuỗi` });
      return;
    }
    await list.remove(value, scope.groupId);
    response.json(list.list(scope.groupId));
  });
}

// The JSON API behind the dashboard in web/. It serves no pages of its own.
export function createAdminApp(bot: SimpleBot, store: Store, loginCodes: LoginCodeService, blockedLinks: BlockedLinks, bannedWords: BannedWords): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });
  app.get("/health", (_request, response) => response.json({ ok: true, ownId: bot.ownId }));

  // Sign-in routes are the only part of the API open to visitors without a session.
  app.get("/api/auth/session", async (request, response) => {
    response.json({ authenticated: await isAuthenticated(request, store) });
  });
  app.post("/api/auth/code", async (_request, response) => {
    try {
      const result = await loginCodes.request();
      if (!result.sent) {
        response.status(429).json({ error: `Vừa gửi mã, hãy thử lại sau ${result.retryAfterSeconds} giây` });
        return;
      }
      response.json({ ok: true });
    } catch (error: unknown) {
      console.error("[LOGIN CODE FAILED]", errorMessage(error));
      response.status(502).json({ error: "Không gửi được mã đăng nhập qua Zalo" });
    }
  });
  app.post("/api/auth/login", async (request, response) => {
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
  app.post("/api/auth/logout", async (request, response) => {
    await endSession(store, request, response);
    response.json({ ok: true });
  });

  app.use("/api", authMiddleware(store));

  app.get("/api/status", (_request, response) => response.json(bot.status()));
  app.get("/api/overview", async (_request, response) => {
    const [series, recent] = await Promise.all([
      store.violationSeries(overviewDays),
      store.listRecentViolationMessages(recentViolationLimit),
    ]);
    response.json({ series, recent });
  });

  // The violation log across every group, newest first. ?before=<timestamp> continues from the previous page.
  app.get("/api/violations", async (request, response) => {
    const before = Number(request.query.before);
    const rule = violationRules.find((item: ViolationRule) => item === request.query.rule);
    response.json(await store.listRecentViolationMessages(violationPageSize, {
      ...(Number.isFinite(before) && before > 0 ? { before } : {}),
      ...(rule === undefined ? {} : { rule }),
    }));
  });

  // One page of groups. Searching and filtering happen here, so every page of the table reflects the whole list.
  app.get("/api/groups", async (request, response) => {
    const text = typeof request.query.q === "string" ? request.query.q.slice(0, maxSearchLength) : "";
    const filter = groupFilters.find((item: GroupFilter) => item === request.query.filter) ?? "all";
    const page = Number(request.query.page);
    const pageSize = Number(request.query.pageSize);
    response.json(searchGroups(await bot.listGroups(), {
      text,
      filter,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      pageSize: isIntegerBetween(pageSize, 1, maxGroupPageSize) ? pageSize : defaultGroupPageSize,
    }));
  });
  app.get("/api/groups/summary", async (_request, response) => response.json(summarizeGroups(await bot.listGroups())));
  app.post("/api/groups/sync", async (_request, response) => {
    try {
      await bot.syncAllGroups();
      response.json({ ok: true });
    } catch (error: unknown) {
      response.status(502).json({ error: errorMessage(error) });
    }
  });
  app.get("/api/groups/:groupId", async (request, response) => {
    const group = await bot.getGroup(request.params.groupId);
    if (group === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(group);
  });
  app.patch("/api/groups/:groupId/kick-rule", async (request, response) => {
    const body: unknown = request.body;
    const rule = isRecord(body) ? violationRules.find((item: ViolationRule) => item === body.rule) : undefined;
    const enabled = isRecord(body) ? body.enabled : undefined;
    const count = isRecord(body) ? body.count : undefined;
    const windowSeconds = isRecord(body) ? body.windowSeconds : undefined;
    if (rule === undefined || typeof enabled !== "boolean" || !isIntegerBetween(count, 1, maxKickCount) || !isIntegerBetween(windowSeconds, 1, maxKickWindowSeconds)) {
      response.status(400).json({ error: `Số lần phải từ 1 đến ${maxKickCount} và khoảng thời gian từ 1 giây đến 7 ngày` });
      return;
    }
    // Kicking needs admin rights, so it cannot be turned on without them. Turning it off is always allowed.
    if (enabled && !await bot.isBotAdminIn(request.params.groupId)) {
      response.status(409).json({ error: "Bot phải là trưởng/phó nhóm thì mới bật kick được" });
      return;
    }
    const updated = await store.setKickRule(request.params.groupId, rule, { enabled, count, windowSeconds });
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });
  registerListRoutes(app, store, "/api/groups/:groupId/blocked-links", "link", blockedLinks, "Link không hợp lệ; hãy nhập dạng example.com hoặc example.com/duong-dan");
  registerListRoutes(app, store, "/api/groups/:groupId/banned-words", "word", bannedWords, "Từ không hợp lệ; hãy nhập từ hoặc cụm từ dài 2–50 ký tự");
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
    const updated = await store.setGroupSetting(request.params.groupId, setting, enabled);
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });

  const invalidLink = "Link không hợp lệ; hãy nhập dạng example.com hoặc example.com/duong-dan";
  const invalidWord = "Từ không hợp lệ; hãy nhập từ hoặc cụm từ dài 2–50 ký tự";
  registerListRoutes(app, store, "/api/blocked-links", "link", blockedLinks, invalidLink);
  registerListRoutes(app, store, "/api/banned-words", "word", bannedWords, invalidWord);
  app.post("/api/banned-words/check", (request, response) => {
    const body: unknown = request.body;
    const text = isRecord(body) ? body.text : undefined;
    // With a group, the sentence is also checked against that group's own words.
    const groupId = isRecord(body) && typeof body.groupId === "string" ? body.groupId : undefined;
    response.json({ match: typeof text === "string" ? bannedWords.find(text, groupId) ?? null : null });
  });

  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  return app;
}
