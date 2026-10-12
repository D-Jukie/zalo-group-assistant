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

// The admin-managed list of banned words and phrases, shared by the admin page and the filter.
export class BannedWords {
  private matcher: BannedWordMatcher;
  // Changes run one at a time so two admin requests cannot overwrite each other.
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(private readonly store: Store, private words: readonly string[]) {
    this.matcher = createBannedWordMatcher(words);
  }

  public static async load(store: Store): Promise<BannedWords> {
    return new BannedWords(store, await store.getList(listName));
  }

  public list(): readonly string[] {
    return this.words;
  }

  public async add(input: string): Promise<boolean> {
    const word = normalizeBannedWord(input);
    if (word === undefined) return false;
    await this.change((words) => words.includes(word) ? words : [...words, word]);
    return true;
  }

  public async remove(word: string): Promise<void> {
    await this.change((words) => words.filter((item) => item !== word));
  }

  public find(text: string): string | undefined {
    return this.matcher(text);
  }

  private async change(update: (words: readonly string[]) => readonly string[]): Promise<void> {
    const run = this.pending.then(async () => {
      const words = [...update(this.words)].sort();
      if (words.length > maxWords) throw new Error(`Danh sách chỉ chứa tối đa ${maxWords} từ`);
      await this.store.setList(listName, words);
      this.words = words;
      this.matcher = createBannedWordMatcher(words);
    });
    this.pending = run.catch(() => undefined);
    await run;
  }
}
