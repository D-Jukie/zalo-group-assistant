import { noActivity, type ActivityRecorder } from "../activity/activity-log.js";

// How long to wait before signing in again when the bot could not be started on a fresh session.
const startRetryDelayMs = 30_000;

// The bot running on one Zalo account. `open` hands it to the dashboard; `account` names the account
// for the history.
export type SessionRun = Readonly<{ open(): void; stop(): void; account(): string }>;

export type SessionsOptions<Api> = Readonly<{
  // Signs in, by the saved session or a QR code, and only returns once signed in; signOut forgets the session.
  login: Readonly<{ run(): Promise<Api>; signOut(): Promise<void> }>;
  start(api: Api): Promise<SessionRun>;
  // Takes the dashboard back to the QR code.
  closeGate(): void;
  activity?: ActivityRecorder;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The bot's life, one Zalo account after another: sign in, run until the admin signs the account
// out, then show the QR code again for the next one. A bot that fails to start is tried again rather
// than ending the process, since that may happen in the middle of the day, after a sign-out.
export class BotSessions<Api> {
  private running: SessionRun | undefined;
  // Ends the wait of the running session, once it has been signed out or the process is ending.
  private release: () => void = () => undefined;
  private ended = false;

  public constructor(private readonly options: SessionsOptions<Api>) {}

  public get isRunning(): boolean {
    return this.running !== undefined;
  }

  // Signs the running bot out of its Zalo account. Whatever goes wrong on the way, the loop goes back
  // to signing in: with a QR code, or with the old session again if it could not be forgotten.
  public async signOut(): Promise<void> {
    const run = this.running;
    if (run === undefined) throw new Error("Bot chưa đăng nhập Zalo");
    this.running = undefined;
    this.options.closeGate();
    try {
      run.stop();
      await this.options.login.signOut();
      (this.options.activity ?? noActivity).record({ category: "system", actor: "admin", title: "Đăng xuất tài khoản Zalo của bot", detail: run.account() });
    } finally {
      this.release();
    }
  }

  // For the end of the process: stops the running bot, if any, and the loop. Says whether a bot was running.
  public shutdown(): boolean {
    this.ended = true;
    const run = this.running;
    this.running = undefined;
    try {
      run?.stop();
    } finally {
      this.release();
    }
    return run !== undefined;
  }

  public async run(): Promise<void> {
    const sleep = this.options.sleep ?? wait;
    while (!this.ended) {
      const api = await this.options.login.run();
      if (this.ended) return;
      let session: SessionRun;
      try {
        session = await this.options.start(api);
      } catch (error: unknown) {
        console.error("[BOT START FAILED]", errorMessage(error));
        (this.options.activity ?? noActivity).record({ category: "system", actor: "bot", title: "Bot khởi động", ok: false, error: errorMessage(error) });
        await sleep(this.options.retryDelayMs ?? startRetryDelayMs);
        continue;
      }
      if (this.ended) {
        session.stop();
        return;
      }
      this.running = session;
      session.open();
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
  }
}
