import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import type { GroupMessageContext, ReportOptions } from "../bot/feature.js";
import { NsfwImageModel, type ImageClassifier, type ImageModelStatus } from "../moderation/image-classifier.js";
import { defaultImageGuardSettings, type ImageGuardSettings } from "../types.js";
import { ImageGuardFeature } from "./image-guard.js";

type Report = Readonly<{ rule: string; detail: string; options: ReportOptions | undefined }>;

// The feature over a model that gives a fixed score and a download that records what it fetched.
function setup(options: { score?: number; state?: ImageModelStatus["state"]; download?: boolean; enabled?: boolean; settings?: Partial<ImageGuardSettings> } = {}) {
  const fetched: string[] = [];
  const reports: Report[] = [];
  const classifier: ImageClassifier = {
    status: { state: options.state ?? "ready", modelPath: "" },
    score: () => Promise.resolve(options.score ?? 0),
  };
  const feature = new ImageGuardFeature(classifier, (url) => {
    fetched.push(url);
    return Promise.resolve(options.download === false ? undefined : Buffer.from("picture"));
  });
  const group = { imageGuardEnabled: options.enabled ?? true, imageSettings: { ...defaultImageGuardSettings, ...options.settings } };
  const send = (msgType: string, content: unknown = { href: "https://photo.zdn.vn/a.jpg", thumb: "https://photo.zdn.vn/a-thumb.jpg" }, senderIsAdmin = false) => feature.onGroupMessage({
    message: { data: { msgType, content } },
    group,
    senderIsAdmin,
    reportViolation: (rule: string, detail: string, reportOptions?: ReportOptions) => { reports.push({ rule, detail, options: reportOptions }); return Promise.resolve(); },
  } as unknown as GroupMessageContext);
  return { send, fetched, reports };
}

await test("records a photo the model scores at the threshold or above, and only records it by default", async () => {
  const { send, fetched, reports } = setup({ score: 0.97 });
  await send("chat.photo");
  assert.deepEqual(fetched, ["https://photo.zdn.vn/a.jpg"]);
  assert.deepEqual(reports, [{ rule: "image", detail: "điểm 97%", options: { deleteMessage: false } }]);
});

await test("asks for the photo to be deleted when the group says so", async () => {
  const { send, reports } = setup({ score: 0.9, settings: { deleteMessage: true } });
  await send("chat.photo");
  assert.deepEqual(reports.map((report) => report.options), [{ deleteMessage: true }]);
});

await test("lets a photo below the group's threshold through", async () => {
  const { send, reports } = setup({ score: 0.84, settings: { threshold: 85 } });
  await send("chat.photo");
  assert.deepEqual(reports, []);
  const stricter = setup({ score: 0.84, settings: { threshold: 80 } });
  await stricter.send("chat.photo");
  assert.equal(stricter.reports.length, 1);
});

await test("checks only photos from members, in groups that switched it on, while the model is there", async () => {
  for (const scenario of [
    { setup: { score: 1 }, msgType: "webchat" },
    { setup: { score: 1 }, msgType: "chat.sticker" },
    { setup: { score: 1, enabled: false }, msgType: "chat.photo" },
    { setup: { score: 1, state: "missing" as const }, msgType: "chat.photo" },
  ]) {
    const { send, fetched, reports } = setup(scenario.setup);
    await send(scenario.msgType);
    assert.deepEqual(fetched, [], scenario.msgType);
    assert.deepEqual(reports, []);
  }
  const admin = setup({ score: 1 });
  await admin.send("chat.photo", undefined, true);
  assert.deepEqual(admin.reports, []);
});

await test("does nothing when the photo cannot be fetched or has no address", async () => {
  const unreachable = setup({ score: 1, download: false });
  await unreachable.send("chat.photo");
  assert.deepEqual(unreachable.reports, []);
  const noAddress = setup({ score: 1 });
  await noAddress.send("chat.photo", { title: "", description: "" });
  assert.deepEqual(noAddress.fetched, []);
});

await test("the model reports a missing file instead of failing", async () => {
  const model = await NsfwImageModel.load("models/does-not-exist.onnx");
  assert.equal(model.status.state, "missing");
  assert.equal(await model.score(Buffer.from("x")), undefined);
});

// The real model, when "npm run model" has fetched it: a plain picture is not sensitive.
const modelPath = "models/nsfw.onnx";
const haveModel = await access(modelPath).then(() => true, () => false);
await test("the real model scores a plain picture as not sensitive, and an unreadable one as nothing", { skip: haveModel ? false : "no model file" }, async () => {
  const model = await NsfwImageModel.load(modelPath, 2);
  assert.equal(model.status.state, "ready");
  const plain = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();
  const score = await model.score(plain);
  assert.ok(score !== undefined && score < 0.5, `score ${score}`);
  assert.equal(await model.score(Buffer.from("not a picture")), undefined);
});
