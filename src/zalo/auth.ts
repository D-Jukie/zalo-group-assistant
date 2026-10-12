import { rm } from "node:fs/promises";
import { Zalo, type API, type Credentials } from "zca-js";
import { decryptSecret, encryptSecret } from "../storage/secret-box.js";
import type { Store } from "../storage/store.js";
import { isRecord } from "../utils.js";

const credentialsSecretName = "zalo-credentials";
const qrPath = "./qr.png";

function isCredentials(value: unknown): value is Credentials {
  if (!isRecord(value)) return false;
  const cookie = value.cookie;
  return typeof value.imei === "string" && typeof value.userAgent === "string" && (Array.isArray(cookie) || isRecord(cookie));
}

async function loadCredentials(store: Store, key: Buffer): Promise<Credentials | undefined> {
  const secret = await store.getSecret(credentialsSecretName);
  if (secret === undefined) return undefined;
  const plaintext = decryptSecret(secret, key, credentialsSecretName);
  if (plaintext === undefined) {
    console.warn("[AUTH] Không giải mã được phiên Zalo đã lưu; ZALO_CREDENTIALS_KEY có thể đã bị đổi.");
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(plaintext);
    return isCredentials(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function saveCredentials(store: Store, key: Buffer, api: API): Promise<void> {
  const context = api.getContext();
  const cookie = context.cookie.toJSON();
  if (cookie === undefined) throw new Error("Không thể lưu cookie Zalo");
  const plaintext = JSON.stringify({
    imei: context.imei,
    cookie: cookie.cookies,
    userAgent: context.userAgent,
    language: context.language,
  });
  await store.setSecret(credentialsSecretName, encryptSecret(plaintext, key, credentialsSecretName));
}

async function loginWithQr(zalo: Zalo): Promise<API> {
  try {
    return await zalo.loginQR({ qrPath });
  } finally {
    // The QR image is only useful while waiting for the scan.
    await rm(qrPath, { force: true });
  }
}

export async function login(store: Store, credentialsKey: Buffer): Promise<API> {
  const zalo = new Zalo({ logging: false });
  const saved = await loadCredentials(store, credentialsKey);
  let api: API;
  if (saved !== undefined) {
    console.log("[AUTH] Đang thử phiên Zalo đã lưu...");
    try {
      api = await zalo.login(saved);
      console.log("[AUTH] Đăng nhập bằng phiên đã lưu thành công.");
    } catch {
      console.warn("[AUTH] Phiên đã lưu không còn hợp lệ; QR mới sẽ được lưu tại ./qr.png.");
      api = await loginWithQr(zalo);
    }
  } else {
    console.log("[AUTH] Chưa có phiên Zalo; QR đăng nhập sẽ được lưu tại ./qr.png.");
    api = await loginWithQr(zalo);
  }
  await saveCredentials(store, credentialsKey, api);
  console.log("[AUTH] Đã lưu phiên Zalo.");
  return api;
}
