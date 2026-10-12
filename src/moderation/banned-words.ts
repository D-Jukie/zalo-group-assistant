import type { Store } from "../storage/store.js";
import { escapeRegExp } from "../utils.js";

const listName = "banned-words";
const maxWords = 500;
const maxWordLength = 50;

export type BannedWordMatcher = (text: string) => string | undefined;

export function normalizeBannedWord(input: string): string | undefined {
  const value = input.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
  return value.length < 2 || value.length > maxWordLength ? undefined : value;
}

// Words only match as whole words: "dcm" is caught in "ôi dcm!" but not inside "hjhdcm".
// Diacritics are significant, so an unaccented entry never matches an accented everyday word.
function compile(words: readonly string[]): RegExp | undefined {
  if (words.length === 0) return undefined;
  const alternatives = [...words]
    .sort((left, right) => right.length - left.length)
    .map((word) => escapeRegExp(word).replace(/ /gu, "\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "u");
}

// A whole token that is a real-looking link: it starts with http(s):// or www. and has a dotted host name.
// Anything looser ("a.vn/word", "www.word") is still checked, so a fake link cannot hide a banned word.
const linkTokenPattern = /^(?:https?:\/\/|www\.)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/?#:]\S*)?$/u;
// A word spelled out letter by letter: three or more letters with any separator ("d-c-m"),
// or two letters with a dot or asterisk ("v.l"). Two letters with a hyphen are left alone ("size m-l").
const spelledOutPattern = /(?<![\p{L}\p{N}])(?:\p{L}(?:[.\-_*~]\p{L}){2,}|\p{L}[.*]\p{L})(?![\p{L}\p{N}])/gu;

// The spellings worth checking: as typed, with spelled-out words joined, and with stretched letters
// shortened to one or two ("dmmmmm"). Links are dropped first, since a path segment is not a word;
// each token is tested once so a very long message stays cheap.
function textVariants(text: string): string[] {
  const base = text.normalize("NFC").toLowerCase().replace(/\p{Cf}/gu, "")
    .replace(/\S+/gu, (token) => linkTokenPattern.test(token) ? " " : token);
  const joined = base.replace(spelledOutPattern, (word) => word.replace(/[.\-_*~]/gu, ""));
  const variants = new Set<string>();
  for (const variant of [base, joined]) {
    variants.add(variant);
    variants.add(variant.replace(/(.)\1{2,}/gu, "$1"));
    variants.add(variant.replace(/(.)\1{2,}/gu, "$1$1"));
  }
  return Array.from(variants);
}

// Returns a function that reports the first banned word found in a text, if any.
export function createBannedWordMatcher(words: readonly string[]): BannedWordMatcher {
  const pattern = compile(words);
  return (text) => {
    if (pattern === undefined) return undefined;
    for (const variant of textVariants(text)) {
      const match = pattern.exec(variant);
      if (match !== null) return match[0];
    }
    return undefined;
  };
}

// The shared list is stored under the bare name; a group's own list under "<name>:<groupId>".
function scopeName(groupId: string | undefined): string {
  return groupId === undefined ? listName : `${listName}:${groupId}`;
}

type WordList = Readonly<{ words: readonly string[]; matcher: BannedWordMatcher }>;

function toWordList(words: readonly string[]): WordList {
  return { words, matcher: createBannedWordMatcher(words) };
}

// The admin-managed banned words and phrases: one list shared by every group, plus an optional list
// of its own for each group. A group's messages are checked against both.
export class BannedWords {
  // Changes run one at a time so two admin requests cannot overwrite each other.
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(private readonly store: Store, private readonly lists: Map<string, WordList>) {}

  public static async load(store: Store): Promise<BannedWords> {
    const lists = await store.getListsByPrefix(listName);
    return new BannedWords(store, new Map(Array.from(lists, ([name, words]) => [name, toWordList(words)])));
  }

  // The shared list, or one group's own list when a group is given.
  public list(groupId?: string): readonly string[] {
    return this.lists.get(scopeName(groupId))?.words ?? [];
  }

  public async add(input: string, groupId?: string): Promise<boolean> {
    const word = normalizeBannedWord(input);
    if (word === undefined) return false;
    await this.change(groupId, (words) => words.includes(word) ? words : [...words, word]);
    return true;
  }

  public async remove(word: string, groupId?: string): Promise<void> {
    await this.change(groupId, (words) => words.filter((item) => item !== word));
  }

  // Looks for a word banned by the shared list or, when a group is given, by that group's list.
  public find(text: string, groupId?: string): string | undefined {
    return this.lists.get(listName)?.matcher(text)
      ?? (groupId === undefined ? undefined : this.lists.get(scopeName(groupId))?.matcher(text));
  }

  private async change(groupId: string | undefined, update: (words: readonly string[]) => readonly string[]): Promise<void> {
    const run = this.pending.then(async () => {
      const words = [...update(this.list(groupId))].sort();
      if (words.length > maxWords) throw new Error(`Danh sách chỉ chứa tối đa ${maxWords} từ`);
      await this.store.setList(scopeName(groupId), words);
      this.lists.set(scopeName(groupId), toWordList(words));
    });
    this.pending = run.catch(() => undefined);
    await run;
  }
}
