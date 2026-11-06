// Downloads the image model that checks photos for sensitive content: npm run model
// It is about 87 MB, so it is not kept in the repository. The file is pinned to one revision and
// checked against its SHA-256 before it is used.
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const revision = "1ceb3c7fe1e9f3f2507e6df577437f23a9149fd5";
const url = `https://huggingface.co/onnx-community/nsfw_image_detection-ONNX/resolve/${revision}/onnx/model_quantized.onnx`;
const sha256 = "d9afb1e057104e6cc8616d174f0f6a8b8b0389c839eea7d5efa4bdf1a77efd27";
const target = process.env.IMAGE_MODEL_PATH ?? "models/nsfw.onnx";

async function hashOf(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

if (await stat(target).then(() => true, () => false)) {
  if (await hashOf(target) === sha256) {
    console.log(`Mô hình đã có sẵn: ${target}`);
    process.exit(0);
  }
  console.log(`${target} không khớp mã kiểm tra, tải lại.`);
}

await mkdir(dirname(target), { recursive: true });
const partial = `${target}.download`;
console.log(`Đang tải mô hình (khoảng 87 MB) về ${target}…`);
const response = await fetch(url);
if (!response.ok || response.body === null) throw new Error(`Không tải được mô hình: HTTP ${response.status}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
const actual = await hashOf(partial);
if (actual !== sha256) {
  await rm(partial, { force: true });
  throw new Error(`Mô hình tải về không khớp mã kiểm tra (${actual})`);
}
await rename(partial, target);
console.log("Đã tải xong và kiểm tra mô hình.");
