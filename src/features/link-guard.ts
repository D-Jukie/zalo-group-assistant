import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import { findGroupLink } from "../moderation/group-link.js";
import { decodeBlockedLinkFromQr } from "../moderation/qr.js";

export class LinkGuardFeature implements BotFeature {
  public readonly name = "link-guard";

  public constructor(private readonly blockedLinks: BlockedLinks) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    if (!context.group.botEnabled || context.senderIsAdmin) return;
    const content = context.message.data.content;
    const isPhoto = context.message.data.msgType === "chat.photo";
    const link = this.findBlockedLink(content)
      ?? (isPhoto ? await decodeBlockedLinkFromQr(content, (text) => this.findBlockedLink(text) !== undefined) : undefined);
    if (link !== undefined) await context.reportViolation("link", link);
  }

  // Zalo group invites are always blocked; the admin's own list is checked after them.
  private findBlockedLink(content: unknown): string | undefined {
    return findGroupLink(content) ?? this.blockedLinks.find(content);
  }
}
