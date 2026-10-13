import type { BotFeature, GroupMessageContext } from "../bot/feature.js";
import type { BlockedLinks } from "../moderation/blocked-links.js";
import { findGroupLink } from "../moderation/group-link.js";
import { decodeBlockedLinkFromQr } from "../moderation/qr.js";

export class LinkGuardFeature implements BotFeature {
  public readonly name = "link-guard";

  public constructor(private readonly blockedLinks: BlockedLinks) {}

  public async onGroupMessage(context: GroupMessageContext): Promise<void> {
    if (!context.group.linkGuardEnabled || context.senderIsAdmin) return;
    const content = context.message.data.content;
    const isPhoto = context.message.data.msgType === "chat.photo";
    const groupId = context.groupId;
    const link = this.findBlockedLink(content, groupId)
      ?? (isPhoto ? await decodeBlockedLinkFromQr(content, (text) => this.findBlockedLink(text, groupId) !== undefined) : undefined);
    if (link !== undefined) await context.reportViolation("link", link);
  }

  // Zalo group invites are always blocked; the shared list and the group's own list are checked after them.
  private findBlockedLink(content: unknown, groupId: string): string | undefined {
    return findGroupLink(content) ?? this.blockedLinks.find(content, groupId);
  }
}
