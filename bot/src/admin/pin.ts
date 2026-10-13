import type { Request, Response } from "express";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../storage/secret-box.js";
import { isRecord, now } from "../utils.js";
import { cookieValue, hashToken } from "./session.js";

const pinSecretName = "admin-pin";
const pinPattern = /^[0-9]{6}$/u;
const hashLength = 32;
const maxFailures = 5;
const lockMs = 15 * 60 * 1000;
const unlockCookie = "zalo_admin_unlock";
const unlockMaxAgeSeconds = 30 * 60;

export type PinStore = Readonly<{
  getSecret(name: string): Promise<EncryptedSecret | undefined>;
  setSecret(name: string, secret: EncryptedSecret): Promise<void>;
}>;

export type PinCheck = Readonly<{ ok: true } | { ok: false; retryAfterSeconds?: number }>;

export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && pinPattern.test(value);
}

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, hashLength, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

// The admin's PIN: the first of the two things asked for before the dashboard opens.
// Only a salted scrypt hash is kept, itself encrypted like the bot's other secrets.
export class AdminPin {
  private failures = 0;
  private lockedUntil = 0;

  public constructor(private readonly store: PinStore, private readonly key: Buffer) {}

  private async load(): Promise<Readonly<{ salt: Buffer; hash: Buffer }> | undefined> {
    const secret = await this.store.getSecret(pinSecretName);
    if (secret === undefined) return undefined;
    const plaintext = decryptSecret(secret, this.key, pinSecretName);
    if (plaintext === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(plaintext);
      if (!isRecord(value) || typeof value.salt !== "string" || typeof value.hash !== "string") return undefined;
      return { salt: Buffer.from(value.salt, "base64"), hash: Buffer.from(value.hash, "base64") };
    } catch {
      return undefined;
    }
  }

  public async isSet(): Promise<boolean> {
    return await this.load() !== undefined;
  }

  public async set(pin: string): Promise<void> {
    const salt = randomBytes(16);
    const hash = await derive(pin, salt);
    const plaintext = JSON.stringify({ salt: salt.toString("base64"), hash: hash.toString("base64") });
    await this.store.setSecret(pinSecretName, encryptSecret(plaintext, this.key, pinSecretName));
  }

  // Seconds left of the pause that follows too many wrong tries; 0 when there is none.
  public lockedForSeconds(): number {
    return Math.max(0, Math.ceil((this.lockedUntil - now()) / 1000));
  }

  public fail(): void {
    this.failures += 1;
    if (this.failures < maxFailures) return;
    this.failures = 0;
    this.lockedUntil = now() + lockMs;
  }

  // A PIN is short, so guessing is paused for everyone after a few wrong tries.
  // `emailMatches` is the other half of what was entered: a right PIN with a wrong email is a wrong try
  // like any other, and does not clear the count either.
  public async verify(pin: unknown, emailMatches = true): Promise<PinCheck> {
    const wait = this.lockedForSeconds();
    if (wait > 0) return { ok: false, retryAfterSeconds: wait };
    const saved = await this.load();
    const matches = saved !== undefined && typeof pin === "string" && timingSafeEqual(await derive(pin, saved.salt), saved.hash);
    if (matches && emailMatches) {
      this.failures = 0;
      return { ok: true };
    }
    this.fail();
    const locked = this.lockedForSeconds();
    return locked > 0 ? { ok: false, retryAfterSeconds: locked } : { ok: false };
  }
}

// Remembers, for a short while, which browsers have entered the PIN. It is kept in memory only:
// it covers the minutes between the PIN and the code from Zalo, and a restart just asks for the PIN again.
export class UnlockPasses {
  private readonly passes = new Map<string, number>();

  public grant(response: Response): void {
    const token = randomBytes(32).toString("base64url");
    for (const [hash, expiresAt] of this.passes) if (expiresAt <= now()) this.passes.delete(hash);
    this.passes.set(hashToken(token), now() + unlockMaxAgeSeconds * 1000);
    response.append("Set-Cookie", `${unlockCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${unlockMaxAgeSeconds}`);
  }

  public has(request: Request): boolean {
    const token = cookieValue(request, unlockCookie);
    if (token === undefined) return false;
    const expiresAt = this.passes.get(hashToken(token));
    return expiresAt !== undefined && expiresAt > now();
  }

  public revoke(request: Request, response: Response): void {
    const token = cookieValue(request, unlockCookie);
    if (token !== undefined) this.passes.delete(hashToken(token));
    response.append("Set-Cookie", `${unlockCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }
}
