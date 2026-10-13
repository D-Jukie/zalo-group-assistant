import "dotenv/config";
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
import { ReminderBoard } from "./reminders/reminder-board.js";
import { ReminderMessenger } from "./reminders/reminder-messenger.js";
import { Store } from "./storage/store.js";
import { Welcomer } from "./welcome/welcomer.js";
import { ZaloLogin } from "./zalo/auth.js";

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
  // The gate listens first: the QR code that signs the bot in to Zalo is shown on the dashboard.
  const zaloLogin = new ZaloLogin(store, config.credentialsKey);
  const gate = createGate({ store, pin: new AdminPin(store, config.credentialsKey), passes: new UnlockPasses(), adminEmail: config.adminEmail, zaloState: () => zaloLogin.state, activity });
  const server = gate.app.listen(config.port, config.host);
  // Set once the bot is signed in to Zalo and running.
  let stopBot: (() => void) | undefined = undefined;
  const shutdown = (): void => {
    server.close();
    if (stopBot === undefined) {
      // Still waiting for the QR code to be scanned: that wait never ends by itself, so the process is ended here.
      void store.close().finally(() => process.exit(0));
      return;
    }
    stopBot();
    void store.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const api = await zaloLogin.run();
  const ownId = api.getOwnId();
  // "/random" picks from the group's members, which the bot reads; the bot itself is made just below.
  const members = { ownId, listMembers: (groupId: string) => bot.listMembers(groupId) };
  const bot: SimpleBot = new SimpleBot(api, store, ownId, [new LinkGuardFeature(blockedLinks), new BadWordFilterFeature(bannedWords), new SpamGuardFeature(), new AutoReplyFeature(api, autoReplies, members, activity)], activity);
  await bot.start();
  activity.record({ category: "system", actor: "bot", title: "Bot khởi động" });
  const reminders = new ReminderBoard(api, bot, store, undefined, bot.ownMessages);
  const reminderMessenger = new ReminderMessenger(api, store, activity, bot.ownMessages);
  reminderMessenger.start();
  const approver = new JoinApprover(api, bot, store, activity);
  approver.start();
  const welcomer = new Welcomer(api, store, ownId, activity);
  welcomer.start();
  // Reminders are created, changed and answered through group events.
  api.listener.on("group_event", (event) => reminders.forget(event.threadId));
  const loginCodes = new LoginCodeService(createLoginCodeSender(bot, config));
  stopBot = (): void => {
    bot.stop();
    reminderMessenger.stop();
    approver.stop();
    welcomer.stop();
  };
  gate.open(createAdminApp(bot, store, blockedLinks, bannedWords, reminders, approver, autoReplies, new PollBoard(api, bot), activity), loginCodes);
}

void main().catch((error: unknown) => {
  console.error("[STARTUP FAILED]", error instanceof Error ? error.stack ?? error.message : String(error));
  // The gate may already be listening, which would keep a bot that cannot start alive and answering.
  process.exit(1);
});
