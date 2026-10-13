import { TextStyle, type Mention, type Style } from "zca-js";

// What the dashboard's message editor writes into a message's text, and what Zalo is given for it.
// The text is kept as it was typed, tags and all, and is only turned into Zalo's form when it is sent.
//
//   [b]…[/b] [i]…[/i] [u]…[/u] [s]…[/s]      bold, italic, underlined, struck through
//   [big]…[/big] [small]…[/small]            the two sizes Zalo has besides the usual one
//   [red]… [orange]… [yellow]… [green]…      the four colours Zalo has
//   [all]                                    "@All", which notifies every member of the group
const tagStyles = {
  b: TextStyle.Bold,
  i: TextStyle.Italic,
  u: TextStyle.Underline,
  s: TextStyle.StrikeThrough,
  big: TextStyle.Big,
  small: TextStyle.Small,
  red: TextStyle.Red,
  orange: TextStyle.Orange,
  yellow: TextStyle.Yellow,
  green: TextStyle.Green,
} as const;

type TagName = keyof typeof tagStyles;

const tagPattern = /\[(\/?)(b|i|u|s|big|small|red|orange|yellow|green)\]|\[all\]/giu;
const allMembersText = "@All";
// The id Zalo takes to mean every member of the group.
const allMembersId = "-1";

type TagToken = { text: string; kind: "open" | "close"; tag: TagName; paired: boolean };
type Token = { text: string; kind: "text" } | { text: string; kind: "all" } | TagToken;

export type FormattedMessage = Readonly<{ msg: string; styles: Style[]; mentions: Mention[] }>;

function lastIndexOfTag(items: readonly Readonly<{ tag: TagName }>[], tag: TagName): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (items[index]?.tag === tag) return index;
  return -1;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let from = 0;
  for (const match of text.matchAll(tagPattern)) {
    if (match.index > from) tokens.push({ kind: "text", text: text.slice(from, match.index) });
    const name = match[2]?.toLowerCase() as TagName | undefined;
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

// Turns a message's text into what Zalo sends: the text without its tags, and where each style and
// each mention sits in it. Positions count UTF-16 units, as Zalo does.
export function formatMessage(text: string): FormattedMessage {
  let msg = "";
  const styles: Style[] = [];
  const mentions: Mention[] = [];
  const open: { tag: TagName; start: number }[] = [];
  for (const token of tokenize(text)) {
    if (token.kind === "all") {
      mentions.push({ pos: msg.length, uid: allMembersId, len: allMembersText.length });
      msg += allMembersText;
    } else if (token.kind === "text") {
      msg += token.text;
    } else if (!token.paired) {
      msg += token.text;
    } else if (token.kind === "open") {
      open.push({ tag: token.tag, start: msg.length });
    } else {
      const index = lastIndexOfTag(open, token.tag);
      const start = open[index]?.start ?? msg.length;
      open.splice(index, 1);
      if (msg.length > start) styles.push({ start, len: msg.length - start, st: tagStyles[token.tag] });
    }
  }
  return { msg, styles: styles.sort((left, right) => left.start - right.start), mentions };
}

// The message as plain words, for previews and for judging whether there is anything to send.
export function plainText(text: string): string {
  return formatMessage(text).msg;
}

// What goes to Zalo's sendMessage for a text; styles and mentions are left out when there are none.
export function messageContent(text: string): { msg: string; styles?: Style[]; mentions?: Mention[] } {
  const { msg, styles, mentions } = formatMessage(text);
  return { msg, ...(styles.length === 0 ? {} : { styles }), ...(mentions.length === 0 ? {} : { mentions }) };
}
