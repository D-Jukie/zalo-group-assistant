import * as jsQrModule from "jsqr";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

type QrDecoder = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => Readonly<{ data: string }> | null;
const qrDecoder: QrDecoder = (jsQrModule as unknown as { default: QrDecoder }).default;

const maxQrImageBytes = 8 * 1024 * 1024;
const qrFetchTimeoutMs = 5_000;
const imageUrlKeys = new Set([
  "url",
  "rawurl",
  "normalurl",
  "hdurl",
  "oriurl",
  "thumburl",
  "originalurl",
  "href",
  "imageurl",
  "photourl",
  "mediaurl",
  "downloadurl",
  "image",
  "photo",
  "media",
  "thumb",
  "thumbnail",
]);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function collectImageUrls(content: unknown): string[] {
  const found = new Set<string>();
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          visit(JSON.parse(trimmed) as unknown);
        } catch {
          // Ignore non-JSON strings.
        }
      }
      if (isHttpsUrl(trimmed)) {
        if (!found.has(trimmed)) {
          found.add(trimmed);
        }
      }
      return;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item: unknown) => visit(item));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[-_]/gu, "");
      if (imageUrlKeys.has(normalizedKey) && typeof child === "string" && isHttpsUrl(child)) {
        if (!found.has(child)) {
          found.add(child);
        }
      }
      visit(child);
    }
  };
  visit(content);
  return Array.from(found);
}

async function downloadImage(url: string): Promise<Buffer | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qrFetchTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok || response.body === null) return undefined;
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > maxQrImageBytes) return undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxQrImageBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
    const output = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

type RgbaImage = Readonly<{ data: Uint8Array; width: number; height: number }>;

function decodeImageToRgba(buffer: Buffer): RgbaImage | undefined {
  try {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      const image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64, maxResolutionInMP: 12 });
      return { data: image.data, width: image.width, height: image.height };
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      const image = PNG.sync.read(buffer);
      return { data: image.data, width: image.width, height: image.height };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Returns the text of the first QR code in the message's images that isBlocked accepts.
export async function decodeBlockedLinkFromQr(content: unknown, isBlocked: (text: string) => boolean): Promise<string | undefined> {
  const urls = collectImageUrls(content);
  if (urls.length === 0) return undefined;
  for (const url of urls) {
    const imageBuffer = await downloadImage(url);
    if (imageBuffer === undefined) continue;
    const image = decodeImageToRgba(imageBuffer);
    if (image === undefined) continue;
    try {
      const qr = qrDecoder(new Uint8ClampedArray(image.data), image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (qr === null) continue;
      if (isBlocked(qr.data)) return qr.data;
    } catch {
      // Ignore malformed image data and continue with the next image URL.
    }
  }
  return undefined;
}
