import type { Store } from "../storage/store.js";
import { escapeRegExp } from "../utils.js";
import { findInContent, normalizeLinkText } from "./link-text.js";

const listName = "blocked-links";
const maxRules = 200;
const maxRuleLength = 200;

type CompiledRule = Readonly<{ value: string; pattern: RegExp }>;

// Turns admin input such as "https://www.Shopee.vn/" or "facebook.com/groups" into "shopee.vn" / "facebook.com/groups".
export function normalizeBlockedLink(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > maxRuleLength || /\s/u.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//u.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./u, "");
  if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/u.test(host)) return undefined;
  return host + url.pathname.replace(/\/+$/u, "");
}

function compileRule(value: string): CompiledRule {
  const slash = value.indexOf("/");
  const host = slash < 0 ? value : value.slice(0, slash);
  const path = slash < 0 ? "" : value.slice(slash);
  // The host also matches its subdomains, but not a longer name that merely ends or starts with it.
  const hostPattern = `(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*${escapeRegExp(host)}(?![a-z0-9-]|\\.[a-z0-9])`;
  const pathPattern = path.length === 0 ? "" : `${escapeRegExp(path)}(?![a-z0-9_-])`;
  return { value, pattern: new RegExp(`${hostPattern}${pathPattern}\\S*`, "u") };
}

// The admin-managed list of extra websites whose links are removed, shared by the admin page and the link guard.
export class BlockedLinks {
  private rules: CompiledRule[];

  private constructor(private readonly store: Store, values: readonly string[]) {
    this.rules = values.map(compileRule);
  }

  public static async load(store: Store): Promise<BlockedLinks> {
    return new BlockedLinks(store, await store.getList(listName));
  }

  public list(): string[] {
    return this.rules.map((rule) => rule.value);
  }

  public async add(input: string): Promise<string | undefined> {
    const value = normalizeBlockedLink(input);
    if (value === undefined) return undefined;
    if (this.rules.some((rule) => rule.value === value)) return value;
    if (this.rules.length >= maxRules) throw new Error(`Danh sách chỉ chứa tối đa ${maxRules} link`);
    await this.replace([...this.list(), value].sort());
    return value;
  }

  public async remove(value: string): Promise<void> {
    await this.replace(this.list().filter((item) => item !== value));
  }

  public find(content: unknown): string | undefined {
    if (this.rules.length === 0) return undefined;
    return findInContent(content, (text) => {
      const normalized = normalizeLinkText(text).toLowerCase();
      for (const rule of this.rules) {
        const match = rule.pattern.exec(normalized);
        if (match !== null) return match[0];
      }
      return undefined;
    });
  }

  private async replace(values: string[]): Promise<void> {
    await this.store.setList(listName, values);
    this.rules = values.map(compileRule);
  }
}
