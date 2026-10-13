import { randomInt, timingSafeEqual } from "node:crypto";
import { now } from "../utils.js";

const codeLength = 8;
const codeTtlMs = 5 * 60 * 1000;
const requestCooldownMs = 60 * 1000;
const maxAttempts = 5;

type PendingCode = { code: string; expiresAt: number; attemptsLeft: number };

export type LoginCodeRequestResult = Readonly<{ sent: true } | { sent: false; retryAfterSeconds: number }>;

// One-time admin login codes, delivered through a channel only the bot owner can read.
export class LoginCodeService {
  private pending: PendingCode | undefined;
  private lastRequestAt = 0;

  public constructor(private readonly deliver: (code: string) => Promise<void>) {}

  public async request(): Promise<LoginCodeRequestResult> {
    // Anyone who can reach the login page can trigger a message, so requests are throttled globally.
    const waitMs = this.lastRequestAt + requestCooldownMs - now();
    if (waitMs > 0) return { sent: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
    this.lastRequestAt = now();
    const code = String(randomInt(0, 10 ** codeLength)).padStart(codeLength, "0");
    this.pending = undefined;
    await this.deliver(code);
    this.pending = { code, expiresAt: now() + codeTtlMs, attemptsLeft: maxAttempts };
    return { sent: true };
  }

  public verify(candidate: string): boolean {
    const pending = this.pending;
    if (pending === undefined) return false;
    if (pending.expiresAt <= now()) {
      this.pending = undefined;
      return false;
    }
    pending.attemptsLeft -= 1;
    const expected = Buffer.from(pending.code, "utf8");
    const actual = Buffer.from(candidate.trim(), "utf8");
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    // A code is single use, and guessing is cut off after a few wrong tries.
    if (matches || pending.attemptsLeft <= 0) this.pending = undefined;
    return matches;
  }
}
