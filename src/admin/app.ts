import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { formatLogTime, noActivity, parseActivityCursor, parseActivityFilter, previewText, type ActivityRecorder } from "../activity/activity-log.js";
import { parseJoinApprovalSettings } from "../approval/join-approval.js";
import { parseAutoReply } from "../auto-reply/auto-reply.js";
import type { AutoReplies, AutoReplySaveOutcome } from "../auto-reply/auto-replies.js";
import type { JoinApprover } from "../approval/join-approver.js";
import type { SimpleBot } from "../bot/simple-bot.js";
import type { BannedWords } from "../moderation/banned-words.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import { parseMessageRequest, parseReminderMessageEdit, parseReminderRequest } from "../reminders/reminder.js";
import type { ReminderBoard } from "../reminders/reminder-board.js";
import type { Store } from "../storage/store.js";
import { violationMessageStatuses, violationRuleNames, violationRules, type ActivityCategory, type NewActivity, type GroupMember, type GroupSetting, type RateRule, type ViolationLogFilter, type ViolationRule } from "../types.js";
import { maxSpamWindowSeconds } from "../moderation/spam-detector.js";
import { isRecord, now } from "../utils.js";
import { groupFilters, searchGroups, summarizeGroups, type GroupFilter } from "./group-search.js";
import { memberSorts, searchMembers } from "./member-search.js";
import { authMiddleware } from "./session.js";

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
const activityPageSize = 50;
// What each per-group switch is called in the history.
const groupSettingNames: Readonly<Record<GroupSetting, string>> = { botEnabled: "bot", linkGuardEnabled: "chặn link", badWordFilterEnabled: "lọc từ cấm", spamGuardEnabled: "chống spam" };
const defaultGroupPageSize = 25;
const maxGroupPageSize = 100;
const maxSearchLength = 100;
// How many rows one bulk action may cover.
const maxBulkItems = 200;
const groupBulkActions = ["enable", "disable", "leave"] as const;
const memberBulkActions = ["kick", "block", "clear"] as const;

// A list of distinct, non-empty strings no longer than a bulk action allows; undefined for anything else.
function parseIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string" && item !== "")) return undefined;
  const ids = Array.from(new Set(value));
  return ids.length === 0 || ids.length > maxBulkItems ? undefined : ids;
}
// A reminder's two messages with up to 12 MB of pictures each, written as base64.
const reminderBodyLimit = "36mb";

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
// `noun` is what an entry of the list is called in the history; `log` writes a change into it.
function registerListRoutes(app: Express, store: Store, base: string, field: string, list: ManagedList, invalidMessage: string, noun: string, log: (title: string, detail: string, groupId: string | undefined) => void): void {
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
      log(`Thêm ${noun}`, value, scope.groupId);
      response.json(list.list(scope.groupId));
    } catch (error: unknown) {
      response.status(400).json({ error: errorMessage(error) });
    }
  });
  app.delete(base, async (request, response) => {
    const scope = await guard(request, response);
    if (scope === undefined) return;
    const body: unknown = request.body;
    // One entry by name, or several at once as "values".
    const value = isRecord(body) ? body[field] : undefined;
    const values = typeof value === "string" ? [value] : isRecord(body) ? parseIdList(body.values) : undefined;
    if (values === undefined) {
      response.status(400).json({ error: `${field} phải là chuỗi` });
      return;
    }
    for (const item of values) await list.remove(item, scope.groupId);
    log(`Xóa ${noun}`, values.join(", "), scope.groupId);
    response.json(list.list(scope.groupId));
  });
}

// The JSON API behind the dashboard in web/. It serves no pages of its own.
export function createAdminApp(bot: SimpleBot, store: Store, blockedLinks: BlockedLinks, bannedWords: BannedWords, reminders: ReminderBoard, approver: JoinApprover, autoReplies: AutoReplies, activity: ActivityRecorder = noActivity): Express {
  const app = express();
  // What an admin does from the dashboard goes into the history, next to what the bot does by itself.
  const logAdmin = (category: ActivityCategory, title: string, more: Omit<NewActivity, "category" | "actor" | "title"> = {}): void => activity.record({ category, actor: "admin", title, ...more });
  // How one row of a bulk action ended, as the history takes it.
  const outcome = (result: Readonly<{ ok: boolean; error?: string }>): Readonly<{ ok?: boolean; error?: string }> => result.ok ? {} : { ok: false, error: result.error ?? "" };
  const logList = (title: string, detail: string, groupId: string | undefined): void => logAdmin("settings", title, groupId === undefined ? { detail: `${detail} (danh sách chung)` } : { detail, groupId });
  const randomDetail = (random: Readonly<{ enabled: boolean; adminOnly: boolean }>): string => random.enabled ? `Bật, ${random.adminOnly ? "chỉ trưởng và phó nhóm" : "mọi thành viên"} dùng được` : "Tắt";
  // Names for the history. They are a nicety: when they cannot be read, the entry simply has none.
  const memberNames = async (groupId: string): Promise<ReadonlyMap<string, string>> => {
    try {
      return new Map((await bot.listMembers(groupId)).members.map((member) => [member.userId, member.name]));
    } catch {
      return new Map();
    }
  };
  const violatorNames = async (groupId: string): Promise<ReadonlyMap<string, string>> => new Map((await store.listViolations(groupId)).map((record) => [record.userId, record.userName]));
  const reminderTitles = async (): Promise<ReadonlyMap<string, string>> => {
    try {
      return new Map((await reminders.list()).items.map((reminder) => [`${reminder.groupId}:${reminder.reminderId}`, reminder.title]));
    } catch {
      return new Map();
    }
  };
  app.disable("x-powered-by");
  // Requests are small, except the ones that may carry pictures: a new reminder, a new scheduled
  // message, a change to a waiting message, and a new or changed automatic answer. Those are read by their own routes, after sign-in.
  const readJson = express.json({ limit: "32kb" });
  const readPictures = express.json({ limit: reminderBodyLimit });
  app.use((request, response, next) => {
    const carriesPictures = (request.method === "POST" && (request.path === "/api/reminders" || request.path === "/api/reminder-messages" || request.path === "/api/auto-replies"))
      || (request.method === "PATCH" && (request.path.startsWith("/api/reminder-messages/") || request.path.startsWith("/api/auto-replies/")));
    if (carriesPictures) next();
    else readJson(request, response, next);
  });
  app.use("/api", (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });
  app.get("/health", (_request, response) => response.json({ ok: true, ownId: bot.ownId }));

  // Signing in is handled by the gate in front of this app; everything here needs a session.
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

  // The violation log across every group, newest first, narrowed down by ?q= (name, message, link,
  // group), ?rule=, ?status= and the period ?from= to ?to= (timestamps). ?before=<timestamp> continues
  // from the previous page; the first page also says how many entries there are in all.
  app.get("/api/violations", async (request, response) => {
    const timestamp = (value: unknown): number | undefined => {
      const number = Number(value);
      return typeof value === "string" && value !== "" && Number.isFinite(number) && number > 0 ? number : undefined;
    };
    const text = typeof request.query.q === "string" ? request.query.q.slice(0, maxSearchLength).trim() : "";
    const rule = violationRules.find((item: ViolationRule) => item === request.query.rule);
    const status = violationMessageStatuses.find((item) => item === request.query.status);
    const from = timestamp(request.query.from);
    const to = timestamp(request.query.to);
    const before = timestamp(request.query.before);
    const filter: ViolationLogFilter = {
      ...(text === "" ? {} : { text }),
      ...(rule === undefined ? {} : { rule }),
      ...(status === undefined ? {} : { status }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
    const items = await store.listRecentViolationMessages(violationPageSize, { ...filter, ...(before === undefined ? {} : { before }) });
    response.json(before === undefined ? { items, total: await store.countViolationMessages(filter) } : { items });
  });

  // The history of what the bot and its admins did, newest first, narrowed down by ?q=, ?category=,
  // ?actor=, ?result= (ok or failed), ?groupId= and the period ?from= to ?to=. ?before=<at>_<id> continues
  // after the last entry of the previous page; the first page also says how many entries there are in all.
  app.get("/api/activity", async (request, response) => {
    const filter = parseActivityFilter(request.query, maxSearchLength);
    const before = parseActivityCursor(request.query.before);
    const items = await store.listActivity(activityPageSize, filter, before);
    response.json(before === undefined ? { items, total: await store.countActivity(filter) } : { items });
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
  // One action for several groups: switch the bot on or off, or take the account out of them.
  // The answer says what happened in each group.
  app.post("/api/groups/bulk", async (request, response) => {
    const body: unknown = request.body;
    const action = isRecord(body) ? groupBulkActions.find((item) => item === body.action) : undefined;
    const groupIds = isRecord(body) ? parseIdList(body.groupIds) : undefined;
    if (action === undefined || groupIds === undefined) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} nhóm` });
      return;
    }
    try {
      const names = new Map((await bot.listGroups()).map((group) => [group.groupId, group.name]));
      const results: { groupId: string; groupName: string; ok: boolean; error?: string }[] = [];
      for (const groupId of groupIds) {
        const groupName = names.get(groupId);
        if (groupName === undefined) {
          results.push({ groupId, groupName: "", ok: false, error: "Bot không ở trong nhóm này" });
          continue;
        }
        try {
          if (action === "leave") {
            await bot.leaveGroup(groupId);
            // Nothing can be sent to a group the account has left.
            await store.removeGroupReminderMessages(groupId);
            reminders.forget(groupId);
          } else {
            await store.setGroupSetting(groupId, "botEnabled", action === "enable");
          }
          results.push({ groupId, groupName, ok: true });
        } catch (error: unknown) {
          results.push({ groupId, groupName, ok: false, error: errorMessage(error) });
        }
      }
      const title = action === "leave" ? "Rời nhóm" : action === "enable" ? "Bật bot" : "Tắt bot";
      for (const result of results) {
        if (result.groupName !== "") logAdmin("settings", title, { groupId: result.groupId, groupName: result.groupName, ...outcome(result) });
      }
      response.json({ results });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  app.post("/api/groups/sync", async (_request, response) => {
    try {
      await bot.syncAllGroups();
      logAdmin("system", "Đồng bộ danh sách nhóm");
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
    const rate = (value: RateRule): string => value.enabled ? `${value.count} trong ${value.windowSeconds} giây` : "tắt";
    logAdmin("settings", "Đổi cài đặt chống spam", { groupId: request.params.groupId, detail: `Gửi dồn dập: ${rate(flood)}; lặp nội dung: ${rate(repeat)}; số điện thoại hoặc số tài khoản: ${contact.enabled ? "bật" : "tắt"}` });
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });
  // The bot's own commands across the groups the bot is on in, for the page that sets them up in one place.
  // A command cannot answer where the bot is off, so those groups are left out.
  const groupCommandRows = async () => (await bot.listGroups()).filter((group) => group.botEnabled).map((group) => ({ groupId: group.groupId, name: group.name, memberCount: group.memberCount, commands: group.commands }));
  app.get("/api/group-commands", async (_request, response) => {
    try {
      response.json(await groupCommandRows());
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  // Changes "/random" in several groups at once. Only the given fields change; the rest of each group's setting stays.
  app.post("/api/group-commands", async (request, response) => {
    const body: unknown = request.body;
    const groupIds = isRecord(body) ? parseIdList(body.groupIds) : undefined;
    const random = isRecord(body) && isRecord(body.random) ? body.random : undefined;
    const enabled = random?.enabled;
    const adminOnly = random?.adminOnly;
    const valid = (value: unknown): value is boolean | undefined => value === undefined || typeof value === "boolean";
    if (groupIds === undefined || random === undefined || !valid(enabled) || !valid(adminOnly) || (enabled === undefined && adminOnly === undefined)) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} nhóm và cài đặt cần đổi` });
      return;
    }
    try {
      const current = new Map((await bot.listGroups()).map((group) => [group.groupId, group.commands]));
      for (const groupId of groupIds) {
        const commands = current.get(groupId);
        // A group the account has left is skipped.
        if (commands === undefined) continue;
        const random = { enabled: enabled ?? commands.random.enabled, adminOnly: adminOnly ?? commands.random.adminOnly };
        await store.setGroupCommands(groupId, { random });
        logAdmin("replies", "Đổi cài đặt lệnh /random", { groupId, detail: randomDetail(random) });
      }
      response.json(await groupCommandRows());
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  // Which of the bot's own commands work in the group, and for whom.
  app.patch("/api/groups/:groupId/commands", async (request, response) => {
    const body: unknown = request.body;
    const random = isRecord(body) && isRecord(body.random) ? body.random : undefined;
    if (random === undefined || typeof random.enabled !== "boolean" || typeof random.adminOnly !== "boolean") {
      response.status(400).json({ error: "Cài đặt lệnh không hợp lệ" });
      return;
    }
    const updated = await store.setGroupCommands(request.params.groupId, { random: { enabled: random.enabled, adminOnly: random.adminOnly } });
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    logAdmin("replies", "Đổi cài đặt lệnh /random", { groupId: request.params.groupId, detail: randomDetail(updated.commands.random) });
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });
  // Who the bot lets into the group by itself. Saving goes through the waiting list at once.
  app.patch("/api/groups/:groupId/join-approval", async (request, response) => {
    const { groupId } = request.params;
    const settings = parseJoinApprovalSettings(request.body);
    if (settings === undefined) {
      response.status(400).json({ error: "Tuổi tài khoản tối thiểu phải từ 0 đến 3650 ngày" });
      return;
    }
    // Approving needs admin rights, so it cannot be turned on without them. Turning it off is always allowed.
    if (settings.enabled && !await bot.isBotAdminIn(groupId)) {
      response.status(409).json({ error: "Bot phải là trưởng/phó nhóm thì mới duyệt được thành viên" });
      return;
    }
    const updated = await store.setJoinApproval(groupId, settings);
    if (updated === undefined) {
      response.status(404).json({ error: "Không tìm thấy nhóm" });
      return;
    }
    logAdmin("approval", "Đổi cài đặt duyệt thành viên", {
      groupId,
      detail: settings.enabled ? ["Bật duyệt tự động", settings.requireAvatar ? "cần có ảnh đại diện" : "", settings.minAccountAgeDays > 0 ? `tài khoản Zalo từ ${settings.minAccountAgeDays} ngày` : ""].filter((part) => part !== "").join(", ") : "Tắt duyệt tự động",
    });
    if (settings.enabled) await approver.process(groupId);
    response.json(await bot.getGroup(groupId) ?? updated);
  });
  // Everyone waiting to be let into the group, with the criteria each one fails.
  app.get("/api/groups/:groupId/pending-members", async (request, response) => {
    try {
      response.json(await approver.listPending(request.params.groupId));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách chờ duyệt từ Zalo: ${errorMessage(error)}` });
    }
  });
  // An admin's decision on several waiting requests. The answer says what happened to each.
  app.post("/api/groups/:groupId/pending-members/review", async (request, response) => {
    const body: unknown = request.body;
    const userIds = isRecord(body) ? parseIdList(body.userIds) : undefined;
    const approve = isRecord(body) ? body.approve : undefined;
    if (userIds === undefined || typeof approve !== "boolean") {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} người` });
      return;
    }
    try {
      response.json({ results: await approver.review(request.params.groupId, userIds, approve) });
    } catch (error: unknown) {
      response.status(409).json({ error: errorMessage(error) });
    }
  });
  app.get("/api/groups/:groupId/join-reviews", async (request, response) => {
    response.json(await store.listJoinReviews(request.params.groupId));
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
    logAdmin("settings", "Đổi quy tắc mời ra khỏi nhóm", { groupId: request.params.groupId, detail: `${violationRuleNames[rule]}: ${enabled ? `bật, ${count} lần trong ${windowSeconds} giây` : "tắt"}` });
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });
  registerListRoutes(app, store, "/api/groups/:groupId/blocked-links", "link", blockedLinks, "Link không hợp lệ; hãy nhập dạng example.com hoặc example.com/duong-dan", "link bị chặn", logList);
  registerListRoutes(app, store, "/api/groups/:groupId/banned-words", "word", bannedWords, "Từ không hợp lệ; hãy nhập từ hoặc cụm từ dài 2–50 ký tự", "từ cấm", logList);
  // One page of the group's members with their Zalo account date and their record in this group.
  // ?q= searches names and IDs, ?sort= is name, violations or newest, ?refresh=1 reads Zalo again.
  app.get("/api/groups/:groupId/members", async (request, response) => {
    const { groupId } = request.params;
    const text = typeof request.query.q === "string" ? request.query.q.slice(0, maxSearchLength) : "";
    const sort = memberSorts.find((item) => item === request.query.sort) ?? "name";
    const page = Number(request.query.page);
    const pageSize = Number(request.query.pageSize);
    try {
      const [{ members, complete }, group, records] = await Promise.all([bot.listMembers(groupId, request.query.refresh === "1"), bot.getGroup(groupId), store.listViolations(groupId)]);
      const recordOf = new Map(records.map((record) => [record.userId, record]));
      const rows = members.map((member): GroupMember => {
        const record = recordOf.get(member.userId);
        return {
          ...member,
          role: member.userId === group?.creatorId ? "owner" : group?.adminIds.includes(member.userId) === true ? "admin" : "member",
          isBot: member.userId === bot.ownId,
          violations: record === undefined ? 0 : violationRules.reduce((sum, rule) => sum + record.counts[rule], 0),
          kicks: record?.kicks ?? 0,
        };
      });
      const found = searchMembers(rows, {
        text,
        sort,
        page: Number.isInteger(page) && page >= 1 ? page : 1,
        pageSize: isIntegerBetween(pageSize, 1, maxGroupPageSize) ? pageSize : defaultGroupPageSize,
      });
      response.json({ ...found, memberCount: rows.length, complete });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách thành viên từ Zalo: ${errorMessage(error)}` });
    }
  });
  // One action for several members of a group: remove them ("kick"), remove them and stop them from
  // joining again ("block"), or clear their record of violations ("clear"). The answer says what
  // happened to each member.
  app.post("/api/groups/:groupId/members/bulk", async (request, response) => {
    const { groupId } = request.params;
    const body: unknown = request.body;
    const action = isRecord(body) ? memberBulkActions.find((item) => item === body.action) : undefined;
    const userIds = isRecord(body) ? parseIdList(body.userIds) : undefined;
    if (action === undefined || userIds === undefined) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} thành viên` });
      return;
    }
    try {
      if (action === "clear") {
        const names = await violatorNames(groupId);
        await store.clearViolations(groupId, userIds);
        for (const userId of userIds) logAdmin("moderation", "Xóa lịch sử vi phạm", { groupId, userId, userName: names.get(userId) ?? "" });
        response.json({ results: userIds.map((userId) => ({ userId, ok: true })) });
        return;
      }
      // Read before the removal: afterwards the members are no longer in the list.
      const names = await memberNames(groupId);
      const results = await bot.removeMembers(groupId, userIds, action === "block");
      for (const result of results) {
        logAdmin("moderation", action === "block" ? "Mời ra khỏi nhóm và chặn" : "Mời ra khỏi nhóm", { groupId, userId: result.userId, userName: names.get(result.userId) ?? "", ...(result.warning === undefined ? {} : { detail: result.warning }), ...outcome(result) });
      }
      response.json({ results });
    } catch (error: unknown) {
      response.status(409).json({ error: errorMessage(error) });
    }
  });
  app.get("/api/groups/:groupId/blocked-members", async (request, response) => {
    try {
      response.json(await bot.listBlockedMembers(request.params.groupId));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách bị chặn từ Zalo: ${errorMessage(error)}` });
    }
  });
  // Lets blocked accounts join the group again.
  app.post("/api/groups/:groupId/blocked-members/remove", async (request, response) => {
    const body: unknown = request.body;
    const userIds = isRecord(body) ? parseIdList(body.userIds) : undefined;
    if (userIds === undefined) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} tài khoản` });
      return;
    }
    const { groupId } = request.params;
    const names = new Map((await bot.listBlockedMembers(groupId).catch(() => [])).map((member) => [member.userId, member.name]));
    const logUnblock = (result: Readonly<{ ok: boolean; error?: string }>): void => {
      for (const userId of userIds) logAdmin("moderation", "Bỏ chặn thành viên", { groupId, userId, userName: names.get(userId) ?? "", ...outcome(result) });
    };
    try {
      await bot.unblockMembers(groupId, userIds);
      logUnblock({ ok: true });
      response.json(await bot.listBlockedMembers(groupId));
    } catch (error: unknown) {
      logUnblock({ ok: false, error: errorMessage(error) });
      response.status(502).json({ error: `Zalo không cho bỏ chặn: ${errorMessage(error)}` });
    }
  });
  app.get("/api/groups/:groupId/violations", async (request, response) => {
    response.json(await store.listViolations(request.params.groupId));
  });
  app.get("/api/groups/:groupId/members/:userId/messages", async (request, response) => {
    response.json(await store.listViolationMessages(request.params.groupId, request.params.userId));
  });
  app.delete("/api/groups/:groupId/violations", async (request, response) => {
    const body: unknown = request.body;
    // One member, several members ("userIds"), or with neither the whole group.
    const userId = isRecord(body) ? body.userId : undefined;
    const several = isRecord(body) && body.userIds !== undefined;
    const userIds = typeof userId === "string" ? [userId] : several ? parseIdList(body.userIds) : undefined;
    if ((userId !== undefined && typeof userId !== "string") || (several && userIds === undefined)) {
      response.status(400).json({ error: "userId phải là chuỗi" });
      return;
    }
    const names = await violatorNames(request.params.groupId);
    await store.clearViolations(request.params.groupId, userIds);
    if (userIds === undefined) logAdmin("moderation", "Xóa lịch sử vi phạm của cả nhóm", { groupId: request.params.groupId });
    else for (const id of userIds) logAdmin("moderation", "Xóa lịch sử vi phạm", { groupId: request.params.groupId, userId: id, userName: names.get(id) ?? "" });
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
    const { groupId, reminderId } = request.params;
    const title = (await reminderTitles()).get(`${groupId}:${reminderId}`);
    const detail = title === undefined ? {} : { detail: `“${title}”` };
    try {
      await reminders.remove(groupId, reminderId);
      logAdmin("messages", "Xóa nhắc hẹn", { groupId, ...detail });
      response.json({ ok: true });
    } catch (error: unknown) {
      logAdmin("messages", "Xóa nhắc hẹn", { groupId, ...detail, ok: false, error: errorMessage(error) });
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
    logAdmin("settings", `${enabled ? "Bật" : "Tắt"} ${groupSettingNames[setting]}`, { groupId: request.params.groupId });
    response.json(await bot.getGroup(request.params.groupId) ?? updated);
  });

  const invalidLink = "Link không hợp lệ; hãy nhập dạng example.com hoặc example.com/duong-dan";
  const invalidWord = "Từ không hợp lệ; hãy nhập từ hoặc cụm từ dài 2–50 ký tự";
  registerListRoutes(app, store, "/api/blocked-links", "link", blockedLinks, invalidLink, "link bị chặn", logList);
  registerListRoutes(app, store, "/api/banned-words", "word", bannedWords, invalidWord, "từ cấm", logList);
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
  // Removes several reminders at once. The answer says what happened to each.
  app.post("/api/reminders/delete", async (request, response) => {
    const body: unknown = request.body;
    const rawItems: unknown = isRecord(body) ? body.items : undefined;
    const items = Array.isArray(rawItems) && rawItems.length > 0 && rawItems.length <= maxBulkItems
      ? rawItems.map((item: unknown) => isRecord(item) && typeof item.groupId === "string" && typeof item.reminderId === "string" && item.reminderId !== "" ? { groupId: item.groupId, reminderId: item.reminderId } : undefined)
      : [undefined];
    const valid = items.filter((item) => item !== undefined);
    if (valid.length !== items.length) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} nhắc hẹn` });
      return;
    }
    try {
      // Only groups the account is still in can be acted on.
      const groupIds = new Set((await bot.listGroups()).map((group) => group.groupId));
      const known = valid.filter((item) => groupIds.has(item.groupId));
      const skipped = valid.filter((item) => !groupIds.has(item.groupId)).map((item) => ({ ...item, ok: false, error: "Bot không ở trong nhóm này" }));
      const titles = await reminderTitles();
      const results = await reminders.removeMany(known);
      for (const result of results) {
        const title = titles.get(`${result.groupId}:${result.reminderId}`);
        logAdmin("messages", "Xóa nhắc hẹn", { groupId: result.groupId, ...(title === undefined ? {} : { detail: `“${title}”` }), ...outcome(result) });
      }
      response.json({ results: [...results, ...skipped] });
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
      const results = await reminders.create(parsed, parsed.groupIds);
      for (const result of results) {
        if (result.groupName === "") continue;
        const detail = [`“${parsed.title}” lúc ${formatLogTime(parsed.startTime)}`, result.warning ?? ""].filter((part) => part !== "").join(". ");
        logAdmin("messages", "Tạo nhắc hẹn", { groupId: result.groupId, groupName: result.groupName, detail, ...outcome(result) });
      }
      response.json({ results });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });

  // The messages still waiting for their time: those that go with a reminder and those scheduled on
  // their own. They are listed apart from the reminders, so one whose reminder was removed in Zalo
  // itself can still be found, changed or cancelled.
  app.get("/api/reminder-messages", async (_request, response) => {
    try {
      const names = new Map((await bot.listGroups()).map((group) => [group.groupId, group.name]));
      response.json((await store.listReminderMessages()).map((message) => ({ ...message, groupName: names.get(message.groupId) ?? "" })));
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  // A message of the bot's own for several groups, sent at once or scheduled. The answer says what happened in each of them.
  app.post("/api/reminder-messages", readPictures, async (request, response) => {
    const parsed = parseMessageRequest(request.body, now());
    if (typeof parsed === "string") {
      response.status(400).json({ error: parsed });
      return;
    }
    try {
      const results = parsed.sendNow ? await reminders.sendMessageNow(parsed.message, parsed.groupIds) : await reminders.scheduleMessage(parsed.message, parsed, parsed.groupIds);
      const preview = previewText(parsed.message.text, parsed.message.images?.length ?? 0);
      for (const result of results) {
        if (result.groupName === "") continue;
        logAdmin("messages", parsed.sendNow ? "Gửi tin nhắn" : "Hẹn giờ tin nhắn", { groupId: result.groupId, groupName: result.groupName, detail: parsed.sendNow ? preview : `${preview} lúc ${formatLogTime(parsed.startTime)}`, ...outcome(result) });
      }
      response.json({ results });
    } catch (error: unknown) {
      response.status(502).json({ error: `Không lấy được danh sách nhóm từ Zalo: ${errorMessage(error)}` });
    }
  });
  app.get("/api/reminder-messages/:messageId/images/:index", async (request, response) => {
    const index = Number(request.params.index);
    const image = Number.isInteger(index) && index >= 0 ? await store.getReminderMessageImage(request.params.messageId, index) : undefined;
    if (image === undefined) {
      response.status(404).json({ error: "Tin nhắn này không có ảnh đó" });
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
    const saved = await store.updateReminderMessage(request.params.messageId, edit);
    if (saved === "missing") response.status(404).json({ error: "Tin nhắn này không còn chờ gửi" });
    else if (saved === "empty") response.status(400).json({ error: "Tin nhắn cần có nội dung hoặc ảnh" });
    else if (saved === "invalid") response.status(409).json({ error: "Ảnh của tin nhắn đã thay đổi; hãy mở lại để sửa" });
    else if (saved === "tooHeavy") response.status(400).json({ error: "Tổng dung lượng ảnh của một tin tối đa 12 MB" });
    else {
      const message = (await store.listReminderMessages()).find((item) => item.id === request.params.messageId);
      if (message !== undefined) logAdmin("messages", "Sửa tin nhắn chờ gửi", { groupId: message.groupId, detail: previewText(message.text, message.imageCount) });
      response.json({ ok: true });
    }
  });
  // Cancels several waiting messages at once.
  app.post("/api/reminder-messages/delete", async (request, response) => {
    const body: unknown = request.body;
    const ids = isRecord(body) ? parseIdList(body.ids) : undefined;
    if (ids === undefined) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} tin nhắn` });
      return;
    }
    const waiting = (await store.listReminderMessages()).filter((message) => ids.includes(message.id));
    const deleted = await store.deleteReminderMessages(ids);
    for (const message of waiting) logAdmin("messages", "Hủy tin nhắn chờ gửi", { groupId: message.groupId, detail: previewText(message.text, message.imageCount) });
    response.json({ deleted });
  });
  app.delete("/api/reminder-messages/:messageId", async (request, response) => {
    const waiting = (await store.listReminderMessages()).find((message) => message.id === request.params.messageId);
    if (!await store.deleteReminderMessage(request.params.messageId)) {
      response.status(404).json({ error: "Tin nhắn này không còn chờ gửi" });
      return;
    }
    if (waiting !== undefined) logAdmin("messages", "Hủy tin nhắn chờ gửi", { groupId: waiting.groupId, detail: previewText(waiting.text, waiting.imageCount) });
    response.json({ ok: true });
  });

  // The answers the bot gives by itself when a member types a keyword or a command.
  const autoReplyErrors: Readonly<Record<Exclude<AutoReplySaveOutcome, "saved">, readonly [number, string]>> = {
    missing: [404, "Câu trả lời này không còn nữa"],
    empty: [400, "Câu trả lời cần có nội dung hoặc ảnh"],
    invalid: [409, "Ảnh của câu trả lời đã thay đổi; hãy mở lại để sửa"],
    tooHeavy: [400, "Tổng dung lượng ảnh của một câu trả lời tối đa 12 MB"],
  };
  const answerSave = (response: Response, outcome: AutoReplySaveOutcome): void => {
    if (outcome === "saved") {
      response.json(autoReplies.list());
      return;
    }
    const [status, error] = autoReplyErrors[outcome];
    response.status(status).json({ error });
  };
  app.get("/api/auto-replies", (_request, response) => response.json(autoReplies.list()));
  app.post("/api/auto-replies", readPictures, async (request, response) => {
    const draft = parseAutoReply(request.body);
    if (typeof draft === "string") {
      response.status(400).json({ error: draft });
      return;
    }
    const saved = await autoReplies.create(draft);
    if (saved === "saved") logAdmin("replies", "Thêm câu trả lời tự động", { detail: draft.triggers.join(", ") });
    answerSave(response, saved);
  });
  // Switches several answers on or off, or removes them, in one request.
  app.post("/api/auto-replies/bulk", async (request, response) => {
    const body: unknown = request.body;
    const ids = isRecord(body) ? parseIdList(body.ids) : undefined;
    const action = isRecord(body) ? body.action : undefined;
    if (ids === undefined || (action !== "enable" && action !== "disable" && action !== "delete")) {
      response.status(400).json({ error: `Hãy chọn từ 1 đến ${maxBulkItems} câu trả lời` });
      return;
    }
    const chosen = autoReplies.list().filter((rule) => ids.includes(rule.id));
    if (action === "delete") await autoReplies.remove(ids);
    else for (const id of ids) await autoReplies.setEnabled(id, action === "enable");
    const title = action === "delete" ? "Xóa câu trả lời tự động" : action === "enable" ? "Bật câu trả lời tự động" : "Tắt câu trả lời tự động";
    for (const rule of chosen) logAdmin("replies", title, { detail: rule.triggers.join(", ") });
    response.json(autoReplies.list());
  });
  app.get("/api/auto-replies/:replyId/images/:index", async (request, response) => {
    const index = Number(request.params.index);
    const image = Number.isInteger(index) && index >= 0 ? (await autoReplies.images(request.params.replyId))[index] : undefined;
    if (image === undefined) {
      response.status(404).json({ error: "Câu trả lời này không có ảnh đó" });
      return;
    }
    response.type(image.extension === "jpg" ? "image/jpeg" : `image/${image.extension}`).send(image.data);
  });
  app.patch("/api/auto-replies/:replyId", readPictures, async (request, response) => {
    const draft = parseAutoReply(request.body);
    if (typeof draft === "string") {
      response.status(400).json({ error: draft });
      return;
    }
    const saved = await autoReplies.update(request.params.replyId, draft);
    if (saved === "saved") logAdmin("replies", "Sửa câu trả lời tự động", { detail: draft.triggers.join(", ") });
    answerSave(response, saved);
  });

  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  return app;
}
