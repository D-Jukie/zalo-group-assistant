import "dotenv/config";
import type { API } from "zca-js";
import { ActivityLog } from "./activity/activity-log.js";
import { createAdminApp } from "./admin/app.js";
import { createGate } from "./admin/gate.js";
import { LoginCodeService } from "./admin/login-code.js";
import { AdminPin, UnlockPasses } from "./admin/pin.js";
import { JoinApprover } from "./approval/join-approver.js";
import { AutoReplies } from "./auto-reply/auto-replies.js";
import { SimpleBot } from "./bot/simple-bot.js";
import { parseConfig, type Config } from "./config.js";
import { AutoReplyFeature } from "./features/auto-reply.js";
import { BadWordFilterFeature } from "./features/bad-word-filter.js";
import { LinkGuardFeature } from "./features/link-guard.js";
import { SpamGuardFeature } from "./features/spam-guard.js";
import { BannedWords } from "./moderation/banned-words.js";
import { BlockedLinks } from "./moderation/blocked-links.js";
import { PollBoard } from "./polls/poll-board.js";
import { QuietHoursKeeper } from "./quiet-hours/quiet-hours-keeper.js";
import { ReminderBoard } from "./reminders/reminder-board.js";
import { ReminderMessenger } from "./reminders/reminder-messenger.js";
import { Store } from "./storage/store.js";
import { Welcomer } from "./welcome/welcomer.js";
import { ZaloLogin } from "./zalo/auth.js";
import { BotSessions, type SessionRun } from "./zalo/sessions.js";

// Zalo rejects messages from an account to itself, so the code goes to the owner's own Zalo account.
function createLoginCodeSender(bot: SimpleBot, config: Config): (code: string) => Promise<void> {
  let recipientId = config.adminZaloId;
  if (recipientId === undefined && config.adminZaloPhone === undefined) {
    console.warn("[CONFIG] Chưa đặt ADMIN_ZALO_ID hoặc ADMIN_ZALO_PHONE; không thể đăng nhập trang quản trị.");
  }
  return async (code) => {
    if (recipientId === undefined) {
      if (config.adminZaloPhone === undefined) throw new Error("Chưa đặt ADMIN_ZALO_ID hoặc ADMIN_ZALO_PHONE");
      recipientId = await bot.findUserIdByPhone(config.adminZaloPhone);
      console.log(`[LOGIN CODE] Đã tìm thấy tài khoản quản trị, ADMIN_ZALO_ID=${recipientId}`);
    }
    if (recipientId === bot.ownId) throw new Error("Tài khoản nhận mã phải khác tài khoản Zalo của bot");
    await bot.sendToUser(recipientId, `Mã đăng nhập trang quản trị Zalo bot: ${code}\nMã có hiệu lực 5 phút. Nếu bạn không yêu cầu, hãy bỏ qua tin này.`);
  };
}

async function main(): Promise<void> {
  const config = parseConfig();
  const store = await Store.open(config.mongodbUri, config.mongodbDatabase);
  const activity = new ActivityLog(store);
  const blockedLinks = await BlockedLinks.load(store);
  const bannedWords = await BannedWords.load(store);
  const autoReplies = await AutoReplies.load(store);
  if (config.adminEmail === undefined) console.warn("[CONFIG] Chưa đặt ADMIN_EMAIL; không thể đặt mã PIN và mở trang quản trị.");
  const zaloLogin = new ZaloLogin(store, config.credentialsKey);
  // The gate listens first: the QR code that signs the bot in to Zalo is shown on the dashboard.
  const gate = createGate({ store, pin: new AdminPin(store, config.credentialsKey), passes: new UnlockPasses(), adminEmail: config.adminEmail, zaloState: () => zaloLogin.state, signOutBot: () => sessions.signOut(), activity });
  const server = gate.app.listen(config.port, config.host);

  // Everything that works through one account's session, from its sign-in until it is signed out.
  async function startBot(api: API): Promise<SessionRun> {
    const ownId = api.getOwnId();
    // "/random" picks from the group's members, which the bot reads; the bot itself is made just below.
    const members = { ownId, listMembers: (groupId: string) => bot.listMembers(groupId) };
    const bot: SimpleBot = new SimpleBot(api, store, ownId, [new LinkGuardFeature(blockedLinks), new BadWordFilterFeature(bannedWords), new SpamGuardFeature(), new AutoReplyFeature(api, autoReplies, members, activity)], activity);
    const stoppers: (() => void)[] = [];
    const stop = (): void => {
      for (const item of stoppers) item();
    };
    try {
      await bot.start();
      stoppers.push(() => bot.stop());
      const reminders = new ReminderBoard(api, bot, store, undefined, bot.ownMessages);
      const reminderMessenger = new ReminderMessenger(api, store, activity, bot.ownMessages);
      reminderMessenger.start();
      stoppers.push(() => reminderMessenger.stop());
      const approver = new JoinApprover(api, bot, store, activity);
      approver.start();
      stoppers.push(() => approver.stop());
      const welcomer = new Welcomer(api, store, ownId, activity);
      welcomer.start();
      stoppers.push(() => welcomer.stop());
      const quietHours = new QuietHoursKeeper(bot, store, activity);
      quietHours.start();
      stoppers.push(() => quietHours.stop());
      // Reminders are created, changed and answered through group events.
      api.listener.on("group_event", (event) => reminders.forget(event.threadId));
      const adminApp = createAdminApp(bot, store, blockedLinks, bannedWords, reminders, approver, autoReplies, new PollBoard(api, bot), activity);
      const loginCodes = new LoginCodeService(createLoginCodeSender(bot, config));
      const account = `${bot.status().displayName || "Bot"} (${ownId})`;
      activity.record({ category: "system", actor: "bot", title: "Bot khởi động", detail: account });
      return { open: () => gate.open(adminApp, loginCodes), stop, account: () => account };
    } catch (error: unknown) {
      // Whatever had been started is stopped again before the next attempt.
      stop();
      throw error;
    }
  }

  const sessions = new BotSessions({ login: zaloLogin, start: startBot, closeGate: () => gate.close(), activity });
  const shutdown = (): void => {
    server.close();
    if (!sessions.shutdown()) {
      // Waiting for the QR code to be scanned: that wait never ends by itself, so the process is ended here.
      void store.close().finally(() => process.exit(0));
      return;
    }
    void store.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await sessions.run();
}

void main().catch((error: unknown) => {
  console.error("[STARTUP FAILED]", error instanceof Error ? error.stack ?? error.message : String(error));
  // The gate may already be listening, which would keep a bot that cannot start alive and answering.
  process.exit(1);
});
