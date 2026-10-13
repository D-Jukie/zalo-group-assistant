import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { SimpleBot } from "../bot/simple-bot.js";
import type { BannedWords } from "../moderation/banned-words.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import { parseReminderMessageEdit, parseReminderRequest } from "../reminders/reminder.js";
import type { ReminderBoard } from "../reminders/reminder-board.js";
import type { Store } from "../storage/store.js";
import { violationRules, type GroupSetting, type RateRule, type ViolationRule } from "../types.js";
import { maxSpamWindowSeconds } from "../moderation/spam-detector.js";
import { isRecord, now } from "../utils.js";
import { groupFilters, searchGroups, summarizeGroups, type GroupFilter } from "./group-search.js";
import type { LoginCodeService } from "./login-code.js";
import { authMiddleware, endSession, isAuthenticated, startSession } from "./session.js";

// URL segment of each per-group switch.
const groupToggles: ReadonlyMap<string, GroupSetting> = new Map([
  ["bot", "botEnabled"],
  ["links", "linkGuardEnabled"],
  ["bad-words", "badWordFilterEnabled"],
  ["spam", "spamGuardEnabled"],
]);
const maxKickCount = 100;
const maxKickWindowSeconds = 7 * 24 * 60 * 60;
const maxSpamCount = 50;
const overviewDays = 14;
const recentViolationLimit = 20;
const violationPageSize = 30;
const defaultGroupPageSize = 25;
const maxGroupPageSize = 100;
const maxSearchLength = 100;
// Two pictures of up to 5 MB each, written as base64.
const reminderBodyLimit = "15mb";

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// What the blocked links and the banned words have in common, as far as the API is concerned.
type ManagedList = Readonly<{
  list(groupId?: string): readonly string[];
  add(input: string, groupId?: string): Promise<boolean>;
  remove(value: string, groupId?: string): Promise<void>;
}>;

// A spam check needs at least two messages to mean anything, and cannot look back further than the detector remembers.
function parseSpamRate(value: unknown): RateRule | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
  if (!isIntegerBetween(value.count, 2, maxSpamCount) || !isIntegerBetween(value.windowSeconds, 1, maxSpamWindowSeconds)) return undefined;
  return { enabled: value.enabled, count: value.count, windowSeconds: value.windowSeconds };
}

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
export function createAdminApp(bot: SimpleBot, store: Store, loginCodes: LoginCodeService, blockedLinks: BlockedLinks, bannedWords: BannedWords, reminders: ReminderBoard): Express {
  const app = express();
  app.disable("x-powered-by");
  // Requests are small, except the ones that may carry pictures: a new reminder and a change to a
  // waiting message. Those are read by their own routes, after sign-in.
  const readJson = express.json({ limit: "32kb" });
  const readPictures = express.json({ limit: reminderBodyLimit });
  app.use((request, response, next) => {
    const carriesPictures = (request.method === "POST" && request.path === "/api/reminders") || (request.method === "PATCH" && request.path.startsWith("/api/reminder-messages/"));
    if (carriesPictures) next();
    else readJson(request, response, next);
  });
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

  // Every route under a group only works while the account is still in that group. Settings saved
  // for a group it has left would otherwise be shown and changed as if they still did something.
  app.param("groupId", async (_request, response, next, groupId: string) => {
    try {
      if (!await bot.isInGroup(groupId)) {
        response.status(404).json({ error: "Bot không ở trong nhóm này" });
        return;
      }
      next();
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });

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
    try {
      const found = searchGroups(await bot.listGroups(), {
        text,
        filter,
        page: Number.isInteger(page) && page >= 1 ? page : 1,
        pageSize: isIntegerBetween(pageSize, 1, maxGroupPageSize) ? pageSize : defaultGroupPageSize,
      });
      // The rows about to be shown are read from Zalo again, so names, member counts and the bot's rights are current.
      response.json({ ...found, items: await bot.refreshGroups(found.items.map((group) => group.groupId)) });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  app.get("/api/groups/summary", async (_request, response) => {
    try {
      response.json(summarizeGroups(await bot.listGroups()));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
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
  app.patch("/api/groups/:groupId/spam-settings", async (request, response) => {
    const body: unknown = request.body;
    const flood = isRecord(body) ? parseSpamRate(body.flood) : undefined;
    const repeat = isRecord(body) ? parseSpamRate(body.repeat) : undefined;
    const contact = isRecord(body) && isRecord(body.contact) && typeof body.contact.enabled === "boolean" ? { enabled: body.contact.enabled } : undefined;
    if (flood === undefined || repeat === undefined || contact === undefined) {
      response.status(400).json({ error: `Số tin phải từ 2 đến ${maxSpamCount} và khoảng thời gian từ 1 giây đến 1 giờ` });
      return;
    }
    const updated = await store.setSpamSettings(request.params.groupId, { flood, repeat, contact });
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
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
  app.get("/api/groups/:groupId/reminders/:reminderId/responses", async (request, response) => {
    try {
      response.json(await reminders.responses(request.params.reminderId));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách phản hồi từ Zalo: ${errorMessage(error)}` });
    }
  });
  app.delete("/api/groups/:groupId/reminders/:reminderId", async (request, response) => {
    try {
      await reminders.remove(request.params.groupId, request.params.reminderId);
      response.json({ ok: true });
    } catch (error: unknown) {
      response.status(502).json({ error: `Zalo không cho xóa nhắc hẹn này: ${errorMessage(error)}` });
    }
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

  // Zalo's own reminders across the groups the bot is switched on for. ?refresh=1 reads every group again.
  app.get("/api/reminders", async (request, response) => {
    try {
      response.json(await reminders.list(request.query.refresh === "1"));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  // The groups a reminder can be created in.
  app.get("/api/reminders/groups", async (_request, response) => {
    try {
      response.json((await reminders.listGroups()).map((group) => ({ groupId: group.groupId, name: group.name, memberCount: group.memberCount })));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  // One reminder for several groups. The answer says what happened in each of them.
  app.post("/api/reminders", readPictures, async (request, response) => {
    const parsed = parseReminderRequest(request.body, now());
    if (typeof parsed === "string") {
      response.status(400).json({ error: parsed });
      return;
    }
    try {
      response.json({ results: await reminders.create(parsed, parsed.groupIds) });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });

  // The messages still waiting for their reminder's time. They are listed on their own, so one whose
  // reminder was removed in Zalo itself can still be found, changed or cancelled.
  app.get("/api/reminder-messages", async (_request, response) => {
    try {
      const names = new Map((await bot.listGroups()).map((group) => [group.groupId, group.name]));
      response.json((await store.listReminderMessages()).map((message) => ({ ...message, groupName: names.get(message.groupId) ?? "" })));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  app.get("/api/reminder-messages/:messageId/image", async (request, response) => {
    const image = await store.getReminderMessageImage(request.params.messageId);
    if (image === undefined) {
      response.status(404).json({ error: "Tin nhắn này không có ảnh" });
      return;
    }
    response.type(image.extension === "jpg" ? "image/jpeg" : `image/${image.extension}`).send(image.data);
  });
  app.patch("/api/reminder-messages/:messageId", readPictures, async (request, response) => {
    const edit = parseReminderMessageEdit(request.body);
    if (typeof edit === "string") {
      response.status(400).json({ error: edit });
      return;
    }
    const outcome = await store.updateReminderMessage(request.params.messageId, edit);
    if (outcome === "missing") response.status(404).json({ error: "Tin nhắn này không còn chờ gửi" });
    else if (outcome === "empty") response.status(400).json({ error: "Tin nhắn cần có nội dung hoặc ảnh" });
    else response.json({ ok: true });
  });
  app.delete("/api/reminder-messages/:messageId", async (request, response) => {
    if (!await store.deleteReminderMessage(request.params.messageId)) {
      response.status(404).json({ error: "Tin nhắn này không còn chờ gửi" });
      return;
    }
    response.json({ ok: true });
  });

  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  return app;
}
