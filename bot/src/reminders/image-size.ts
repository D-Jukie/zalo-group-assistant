import type { MessageImage } from "../types.js";

type ImageInfo = Pick<MessageImage, "extension" | "width" | "height">;

function readPng(data: Buffer): ImageInfo | undefined {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return { extension: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// The size sits in the first "start of frame" segment, after however many other segments the file opens with.
function readJpeg(data: Buffer): ImageInfo | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { extension: "jpg", width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return undefined;
}

function readWebp(data: Buffer): ImageInfo | undefined {
  if (data.length < 30 || data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WEBP") return undefined;
  const format = data.toString("latin1", 12, 16);
  if (format === "VP8X") return { extension: "webp", width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  if (format === "VP8 ") return { extension: "webp", width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (format === "VP8L") {
    const bits = data.readUInt32LE(21);
    return { extension: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

// What kind of picture the bytes are and how large it is, judged from the file itself rather than
// its name. Undefined for anything that is not a JPEG, PNG or WebP image.
export function readImageInfo(data: Buffer): ImageInfo | undefined {
  const info = readPng(data) ?? readJpeg(data) ?? readWebp(data);
  return info !== undefined && info.width > 0 && info.height > 0 ? info : undefined;
}
