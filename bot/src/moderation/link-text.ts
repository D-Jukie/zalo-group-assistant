// Undoes the common tricks used to hide a link: URL encoding, HTML entities, escaped slashes, "[.]" dots and zero-width characters.
export function normalizeLinkText(value: string): string {
  let text = value.normalize("NFKC");
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return text
    .replace(/\\\//gu, "/")
    .replace(/&#(?:x2f|47);/giu, "/")
    .replace(/&#(?:x3a|58);/giu, ":")
    .replace(/(?:\[\.\]|\(\.\)|\{\.\})/gu, ".")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "");
}

// Walks any message content (string, array or nested object) and returns the first match found in a string.
export function findInContent(content: unknown, match: (text: string) => string | undefined): string | undefined {
  const visited = new WeakSet<object>();
  const visit = (value: unknown): string | undefined => {
    if (typeof value === "string") return match(value);
    if (typeof value !== "object" || value === null || visited.has(value)) return undefined;
    visited.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const found = visit(item);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(content);
}
