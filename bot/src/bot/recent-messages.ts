import { now } from "../utils.js";

// Remembers message IDs for a short while so a message Zalo delivers twice is only handled once.
export class RecentMessages {
  private readonly seenAt = new Map<string, number>();
  private lastPrunedAt = 0;

  public constructor(private readonly ttlMs = 30_000) {}

  // Returns true when the message was already seen; otherwise records it.
  public isDuplicate(groupId: string, messageId: string): boolean {
    if (messageId.length === 0) return false;
    const currentTime = now();
    this.prune(currentTime);
    const key = `${groupId}:${messageId}`;
    const seenAt = this.seenAt.get(key);
    if (seenAt !== undefined && seenAt >= currentTime - this.ttlMs) return true;
    this.seenAt.set(key, currentTime);
    return false;
  }

  // Every message passes through here, so old entries are swept at most once a second.
  private prune(currentTime: number): void {
    if (currentTime - this.lastPrunedAt < 1_000) return;
    this.lastPrunedAt = currentTime;
    const cutoff = currentTime - this.ttlMs;
    for (const [key, seenAt] of this.seenAt) {
      if (seenAt < cutoff) this.seenAt.delete(key);
    }
  }
}
