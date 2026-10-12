import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Store } from "../storage/store.js";
import { now } from "../utils.js";

const adminSessionCookie = "zalo_admin_session";
const rememberedSessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const browserSessionMaxAgeSeconds = 12 * 60 * 60;

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Only the hash is stored, so a database leak does not hand out usable sessions.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(store: Store, response: Response, remember: boolean): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const maxAgeSeconds = remember ? rememberedSessionMaxAgeSeconds : browserSessionMaxAgeSeconds;
  await store.createSession(hashToken(token), new Date(now() + maxAgeSeconds * 1000));
  const attributes = [`${adminSessionCookie}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (remember) attributes.push(`Max-Age=${maxAgeSeconds}`);
  response.setHeader("Set-Cookie", attributes.join("; "));
}

export async function endSession(store: Store, request: Request, response: Response): Promise<void> {
  const token = cookieValue(request, adminSessionCookie);
  if (token !== undefined) await store.deleteSession(hashToken(token));
  response.setHeader("Set-Cookie", `${adminSessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function isAuthenticated(request: Request, store: Store): Promise<boolean> {
  const token = cookieValue(request, adminSessionCookie);
  return token !== undefined && await store.hasSession(hashToken(token));
}

export function authMiddleware(store: Store) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (await isAuthenticated(request, store)) {
      next();
      return;
    }
    response.status(401).json({ error: "Đăng nhập quản trị viên đã hết hạn" });
  };
}
