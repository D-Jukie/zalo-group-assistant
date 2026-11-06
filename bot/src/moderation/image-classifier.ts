import { access } from "node:fs/promises";
import ort from "onnxruntime-node";
import sharp from "sharp";

// The model: Falconsai/nsfw_image_detection (a ViT fine-tuned to tell "normal" from "nsfw" photos,
// Apache 2.0), as converted to ONNX and quantized to 8 bits by onnx-community. `npm run model`
// downloads it to models/nsfw.onnx; the file is not kept in the repository.
const inputSize = 224;
// Pictures waiting to be scored. Past this, a new one is skipped rather than queued: a burst of
// photos must not hold the bot back for minutes.
const maxWaiting = 20;

// How sure the model is, from 0 to 1, that a picture is sensitive.
export interface ImageClassifier {
  readonly status: ImageModelStatus;
  // undefined when the picture cannot be read or the queue is full.
  score(image: Buffer): Promise<number | undefined>;
}

// "missing": no model file, "failed": the file could not be loaded.
export type ImageModelStatus = Readonly<{ state: "ready" | "missing" | "failed"; modelPath: string; error?: string }>;

// The ViT's own preparation: 224 x 224, each channel scaled from 0..255 to -1..1, channels first.
async function toTensor(image: Buffer): Promise<ort.Tensor> {
  const pixels = await sharp(image, { animated: false, limitInputPixels: 40_000_000 })
    .removeAlpha()
    .resize(inputSize, inputSize, { fit: "fill", kernel: "linear" })
    .raw()
    .toBuffer();
  const plane = inputSize * inputSize;
  const data = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) data[channel * plane + index] = (pixels[index * 3 + channel] ?? 0) / 127.5 - 1;
  }
  return new ort.Tensor("float32", data, [1, 3, inputSize, inputSize]);
}

function nsfwProbability(logits: ArrayLike<number>): number {
  const normal = Number(logits[0]), nsfw = Number(logits[1]);
  const top = Math.max(normal, nsfw);
  const a = Math.exp(normal - top), b = Math.exp(nsfw - top);
  return b / (a + b);
}

export class NsfwImageModel implements ImageClassifier {
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  private constructor(public readonly status: ImageModelStatus, private readonly session: ort.InferenceSession | undefined) {}

  // Never throws: without a usable model the bot runs on and the dashboard says why.
  public static async load(modelPath: string, threads = 4): Promise<NsfwImageModel> {
    try {
      await access(modelPath);
    } catch {
      return new NsfwImageModel({ state: "missing", modelPath }, undefined);
    }
    try {
      const session = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: threads, graphOptimizationLevel: "all" });
      return new NsfwImageModel({ state: "ready", modelPath }, session);
    } catch (error: unknown) {
      return new NsfwImageModel({ state: "failed", modelPath, error: error instanceof Error ? error.message : String(error) }, undefined);
    }
  }

  // One picture at a time, in the order they came.
  public score(image: Buffer): Promise<number | undefined> {
    const session = this.session;
    if (session === undefined || this.waiting >= maxWaiting) return Promise.resolve(undefined);
    this.waiting += 1;
    const run = this.queue.then(async () => {
      try {
        const output = await session.run({ [session.inputNames[0] ?? "pixel_values"]: await toTensor(image) });
        const logits = output[session.outputNames[0] ?? "logits"];
        return logits === undefined ? undefined : nsfwProbability(logits.data as Float32Array);
      } catch {
        return undefined;
      } finally {
        this.waiting -= 1;
      }
    });
    this.queue = run;
    return run;
  }
}
