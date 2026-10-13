import "dotenv/config";
import { createAdminApp } from "./admin/app.js";
import { LoginCodeService } from "./admin/login-code.js";
import { JoinApprover } from "./approval/join-approver.js";
import { SimpleBot } from "./bot/simple-bot.js";
import { parseConfig, type Config } from "./config.js";
import { BadWordFilterFeature } from "./features/bad-word-filter.js";
import { LinkGuardFeature } from "./features/link-guard.js";
import { SpamGuardFeature } from "./features/spam-guard.js";
import { BannedWords } from "./moderation/banned-words.js";
import { BlockedLinks } from "./moderation/blocked-links.js";
import { ReminderBoard } from "./reminders/reminder-board.js";
import { ReminderMessenger } from "./reminders/reminder-messenger.js";
import { Store } from "./storage/store.js";
import { login } from "./zalo/auth.js";

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
  const blockedLinks = await BlockedLinks.load(store);
  const bannedWords = await BannedWords.load(store);
  const api = await login(store, config.credentialsKey);
  const bot = new SimpleBot(api, store, api.getOwnId(), [new LinkGuardFeature(blockedLinks), new BadWordFilterFeature(bannedWords), new SpamGuardFeature()]);
  await bot.start();
  const reminders = new ReminderBoard(api, bot, store);
  const reminderMessenger = new ReminderMessenger(api, store);
  reminderMessenger.start();
  const approver = new JoinApprover(api, bot, store);
  approver.start();
  // Reminders are created, changed and answered through group events.
  api.listener.on("group_event", (event) => reminders.forget(event.threadId));
  const loginCodes = new LoginCodeService(createLoginCodeSender(bot, config));
  const app = createAdminApp(bot, store, loginCodes, blockedLinks, bannedWords, reminders, approver);
  const server = app.listen(config.port, config.host);
  const shutdown = (): void => {
    bot.stop();
    reminderMessenger.stop();
    approver.stop();
    server.close();
    void store.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  console.error("[STARTUP FAILED]", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
