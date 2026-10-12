import { createHash } from "node:crypto";
import type { SpamSettings } from "../types.js";

// Text shorter than this is too common to count as repeated spam ("ok", "haha", "dạ vâng").
const minRepeatLength = 10;
// The longest window a setting may use, and so the longest a quiet member is remembered.
export const maxSpamWindowSeconds = 60 * 60;
const sweepEvery = 500;
// Photos picked together arrive as separate messages. Those marked by Zalo as one album are one
// message however long the upload takes (up to a minute); unmarked photos count as one when they
// follow each other this closely.
const unmarkedAlbumGapMs = 3_000;
const markedAlbumSpanMs = 60_000;

// Only what the enabled checks still need is kept: send times inside the burst window, and a
// fingerprint (never the text itself) of each message inside the repeat window.
type MemberHistory = {
  times: number[];
  copies: { fingerprint: string; at: number }[];
  album: { key: string; at: number } | undefined;
  lastSeenAt: number;
};

export type SpamMessage = Readonly<{
  text: string;
  at: number;
  // Set for photos: Zalo's album ID when it gave one, otherwise an empty string. Left out for everything else.
  album?: string;
}>;

// A Vietnamese mobile number: 0 or +84/84, then a carrier digit and eight more, with spaces, dots
// or dashes allowed between digits ("0912 345 678", "+84.912.345.678") and no digit on either side.
const phonePattern = /(?<!\d)(?:\+?84|0)[\s.-]?[35789](?:[\s.-]?\d){8}(?!\d)/u;
// A bank account is any long number, so it only counts next to words that say it is one.
const accountPattern = /(?:stk|số tài khoản|so tai khoan|số tk|so tk)\D{0,20}\d[\d\s.-]{5,}/iu;

// Lower case with whitespace collapsed and invisible characters dropped, so near-identical copies compare equal.
function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim();
}

function fingerprint(text: string): string {
  return createHash("sha1").update(text).digest("base64");
}

export function findContactInfo(text: string): string | undefined {
  const phone = phonePattern.exec(text);
  if (phone !== null) return `số điện thoại ${phone[0].trim()}`;
  return accountPattern.test(text) ? "số tài khoản" : undefined;
}

// Watches how each member posts in each group and reports spam-like behaviour: contact details
// in a message, the same text sent over and over, or messages arriving in a burst.
export class SpamDetector {
  private readonly histories = new Map<string, MemberHistory>();
  private checks = 0;

  // Records the message and returns what makes it spam, if anything. memberKey identifies one member in one group.
  public check(memberKey: string, message: SpamMessage, settings: SpamSettings): string | undefined {
    const history = this.histories.get(memberKey) ?? { times: [], copies: [], album: undefined, lastSeenAt: message.at };
    this.histories.set(memberKey, history);
    history.lastSeenAt = message.at;
    this.sweep(message.at);

    // Several photos sent in one go are one message for the burst check.
    const previousAlbum = history.album;
    history.album = message.album === undefined ? undefined : { key: message.album, at: message.at };
    const continuesAlbum = message.album !== undefined && previousAlbum !== undefined && previousAlbum.key === message.album
      && message.at - previousAlbum.at <= (message.album === "" ? unmarkedAlbumGapMs : markedAlbumSpanMs);

    const floodSince = message.at - settings.flood.windowSeconds * 1000;
    history.times = settings.flood.enabled ? history.times.filter((at) => at > floodSince) : [];
    if (settings.flood.enabled && !continuesAlbum) history.times.push(message.at);

    const text = normalize(message.text);
    const comparable = settings.repeat.enabled && text.length >= minRepeatLength;
    const repeatSince = message.at - settings.repeat.windowSeconds * 1000;
    history.copies = settings.repeat.enabled ? history.copies.filter((entry) => entry.at > repeatSince) : [];
    const mark = comparable ? fingerprint(text) : undefined;
    if (mark !== undefined) history.copies.push({ fingerprint: mark, at: message.at });

    if (settings.contact.enabled) {
      const contact = findContactInfo(message.text);
      if (contact !== undefined) return contact;
    }
    if (mark !== undefined) {
      const copies = history.copies.filter((entry) => entry.fingerprint === mark).length;
      if (copies >= settings.repeat.count) return `lặp nội dung ${copies} lần trong ${settings.repeat.windowSeconds} giây`;
    }
    if (settings.flood.enabled && !continuesAlbum && history.times.length >= settings.flood.count) {
      return `gửi dồn dập ${history.times.length} tin trong ${settings.flood.windowSeconds} giây`;
    }
    return undefined;
  }

  // Every so often, forget members who have been quiet for longer than any window could reach.
  private sweep(at: number): void {
    this.checks += 1;
    if (this.checks % sweepEvery !== 0) return;
    const oldest = at - maxSpamWindowSeconds * 1000;
    for (const [key, history] of this.histories) {
      if (history.lastSeenAt <= oldest) this.histories.delete(key);
    }
  }
}
