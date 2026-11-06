import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import type { ImageClassifier } from "../moderation/image-classifier.js";
import { downloadImage, photoUrl } from "../moderation/qr.js";

// Checks every photo a member sends with the image model. A photo the model scores at or above the
// group's threshold is a violation: recorded, and deleted too when the group's settings say so.
// Only photos are checked; stickers, GIFs, videos and files are not.
export class ImageGuardFeature implements BotFeature {
  public readonly name = "image-guard";

  public constructor(
    private readonly classifier: ImageClassifier,
    private readonly download: (url: string) => Promise<Buffer | undefined> = downloadImage,
  ) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    if (!context.group.imageGuardEnabled || context.senderIsAdmin) return;
    if (context.message.data.msgType !== "chat.photo" || this.classifier.status.state !== "ready") return;
    const url = photoUrl(context.message.data.content);
    if (url === undefined) return;
    const image = await this.download(url);
    if (image === undefined) return;
    const score = await this.classifier.score(image);
    if (score === undefined) return;
    const percent = Math.round(score * 100);
    const settings = context.group.imageSettings;
    if (percent < settings.threshold) return;
    await context.reportViolation("image", `điểm ${percent}%`, { deleteMessage: settings.deleteMessage });
  }
}
