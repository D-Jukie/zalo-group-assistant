// The formatting tags the message editor writes into a message's text. The bot reads the same tags
// when it sends the message (src/message-format.ts); this side only needs them to show a preview.
//
//   [b]…[/b] [i]…[/i] [u]…[/u] [s]…[/s]      bold, italic, underlined, struck through
//   [big]…[/big] [small]…[/small]            the two sizes Zalo has besides the usual one
//   [red]… [orange]… [yellow]… [green]…      the four colours Zalo has
//   [all]                                    "@All", which notifies every member of the group
export const formatTags = ["b", "i", "u", "s", "big", "small", "red", "orange", "yellow", "green"] as const;
export type FormatTag = (typeof formatTags)[number];

export const allMembersTag = "[all]";

// Zalo's own four text colours.
export const tagColors: Readonly<Partial<Record<FormatTag, string>>> = { red: "#db342e", orange: "#f27806", yellow: "#f7b503", green: "#15a85f" };

const tagPattern = /\[(\/?)(b|i|u|s|big|small|red|orange|yellow|green)\]|\[all\]/giu;

type TagToken = { text: string; kind: "open" | "close"; tag: FormatTag; paired: boolean };
type Token = { text: string; kind: "text" } | { text: string; kind: "all" } | TagToken;

// A run of the message that is shown one way: its words, the tags around it, and whether it is "@All".
export type Segment = Readonly<{ text: string; tags: readonly FormatTag[]; mention: boolean }>;

function lastIndexOfTag(items: readonly Readonly<{ tag: FormatTag }>[], tag: FormatTag): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (items[index]?.tag === tag) return index;
  return -1;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let from = 0;
  for (const match of text.matchAll(tagPattern)) {
    if (match.index > from) tokens.push({ kind: "text", text: text.slice(from, match.index) });
    const name = match[2]?.toLowerCase() as FormatTag | undefined;
    if (name === undefined) tokens.push({ kind: "all", text: match[0] });
    else tokens.push({ kind: match[1] === "/" ? "close" : "open", tag: name, text: match[0], paired: false });
    from = match.index + match[0].length;
  }
  if (from < text.length) tokens.push({ kind: "text", text: text.slice(from) });
  // A closing tag goes with the nearest opening one of its kind still waiting. Tags left without a
  // partner are not formatting: they stay in the message as the text they are.
  const waiting: TagToken[] = [];
  for (const token of tokens) {
    if (token.kind === "open") {
      waiting.push(token);
    } else if (token.kind === "close") {
      const index = lastIndexOfTag(waiting, token.tag);
      const open = waiting[index];
      if (open === undefined) continue;
      waiting.splice(index, 1);
      open.paired = true;
      token.paired = true;
    }
  }
  return tokens;
}

// The message as the group will see it, cut into runs that each look one way.
export function formatSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const active: { tag: FormatTag }[] = [];
  const tags = (): FormatTag[] => Array.from(new Set(active.map((item) => item.tag)));
  for (const token of tokenize(text)) {
    if (token.kind === "all") segments.push({ text: "@All", tags: tags(), mention: true });
    else if (token.kind === "text" || !token.paired) segments.push({ text: token.text, tags: tags(), mention: false });
    else if (token.kind === "open") active.push({ tag: token.tag });
    else active.splice(lastIndexOfTag(active, token.tag), 1);
  }
  return segments;
}

// Whether the text has any formatting at all, which is when a preview is worth showing.
export function hasFormatting(text: string): boolean {
  return formatSegments(text).some((segment) => segment.mention || segment.tags.length > 0);
}

// The message without its tags.
export function plainText(text: string): string {
  return formatSegments(text).map((segment) => segment.text).join("");
}
