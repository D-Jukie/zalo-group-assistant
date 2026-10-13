import { LoginQRCallbackEventType, Zalo, type API, type Credentials } from "zca-js";
import { decryptSecret, encryptSecret } from "../storage/secret-box.js";
import type { Store } from "../storage/store.js";
import { isRecord } from "../utils.js";

const credentialsSecretName = "zalo-credentials";

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

// Where signing the bot in to Zalo stands, as the dashboard shows it.
export type ZaloLoginState = Readonly<
  | { status: "starting" }
  | { status: "qr"; image: string; scannedBy?: string }
  | { status: "ready" }
>;

const retryDelayMs = 5000;

// Signs the bot in to Zalo: with the saved session when it still works, otherwise with a QR code
// that the dashboard shows. The QR is renewed whenever it expires or is declined, until someone scans it.
export class ZaloLogin {
  private current: ZaloLoginState = { status: "starting" };

  public constructor(private readonly store: Store, private readonly credentialsKey: Buffer) {}

  public get state(): ZaloLoginState {
    return this.current;
  }

  private loginWithQr(zalo: Zalo): Promise<API> {
    return zalo.loginQR({}, (event) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        this.current = { status: "qr", image: `data:image/png;base64,${event.data.image}` };
      } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
        if (this.current.status === "qr") this.current = { ...this.current, scannedBy: event.data.display_name };
      } else if (event.type === LoginQRCallbackEventType.QRCodeExpired || event.type === LoginQRCallbackEventType.QRCodeDeclined) {
        event.actions.retry();
      }
    });
  }

  public async run(): Promise<API> {
    // selfListen: Zalo echoes the bot's own messages, which carry the id needed to take them back.
    const zalo = new Zalo({ logging: false, selfListen: true });
    const saved = await loadCredentials(this.store, this.credentialsKey);
    let api: API | undefined;
    if (saved !== undefined) {
      console.log("[AUTH] Đang thử phiên Zalo đã lưu...");
      try {
        api = await zalo.login(saved);
        console.log("[AUTH] Đăng nhập bằng phiên đã lưu thành công.");
      } catch {
        console.warn("[AUTH] Phiên đã lưu không còn hợp lệ.");
      }
    }
    if (api === undefined) console.log("[AUTH] Chưa có phiên Zalo; mở trang quản trị và quét mã QR để đăng nhập bot.");
    while (api === undefined) {
      try {
        api = await this.loginWithQr(zalo);
      } catch (error: unknown) {
        this.current = { status: "starting" };
        console.warn("[AUTH] Không tạo được mã QR, sẽ thử lại:", error instanceof Error ? error.message : String(error));
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    await saveCredentials(this.store, this.credentialsKey, api);
    console.log("[AUTH] Đã lưu phiên Zalo.");
    this.current = { status: "ready" };
    return api;
  }
}
