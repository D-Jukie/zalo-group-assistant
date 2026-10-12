import { findInContent, normalizeLinkText } from "./link-text.js";

const linkPattern = /(?:https?:\/\/)?(?:www\.)?(?:zalo\.me\/g|zaloapp\.com\/qr\/g)\/\S+/iu;

// Whitespace is dropped as well, because invite links are often broken up with spaces to dodge detection.
export function findGroupLink(content: unknown): string | undefined {
  return findInContent(content, (text) => linkPattern.exec(normalizeLinkText(text).replace(/\s/gu, ""))?.[0]);
}
