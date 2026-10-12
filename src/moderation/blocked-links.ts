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

// The shared list is stored under the bare name; a group's own list under "<name>:<groupId>".
function scopeName(groupId: string | undefined): string {
  return groupId === undefined ? listName : `${listName}:${groupId}`;
}

// The admin-managed lists of extra websites whose links are blocked: one shared by every group,
// plus an optional list of its own for each group. A group is checked against both.
export class BlockedLinks {
  private constructor(private readonly store: Store, private readonly rules: Map<string, CompiledRule[]>) {}

  public static async load(store: Store): Promise<BlockedLinks> {
    const lists = await store.getListsByPrefix(listName);
    return new BlockedLinks(store, new Map(Array.from(lists, ([name, values]) => [name, values.map(compileRule)])));
  }

  // The shared list, or one group's own list when a group is given.
  public list(groupId?: string): string[] {
    return (this.rules.get(scopeName(groupId)) ?? []).map((rule) => rule.value);
  }

  public async add(input: string, groupId?: string): Promise<boolean> {
    const value = normalizeBlockedLink(input);
    if (value === undefined) return false;
    const current = this.list(groupId);
    if (current.includes(value)) return true;
    if (current.length >= maxRules) throw new Error(`Danh sách chỉ chứa tối đa ${maxRules} link`);
    await this.replace(groupId, [...current, value].sort());
    return true;
  }

  public async remove(value: string, groupId?: string): Promise<void> {
    await this.replace(groupId, this.list(groupId).filter((item) => item !== value));
  }

  // Looks for a link blocked by the shared list or, when a group is given, by that group's list.
  public find(content: unknown, groupId?: string): string | undefined {
    const rules = [...this.rules.get(listName) ?? [], ...(groupId === undefined ? [] : this.rules.get(scopeName(groupId)) ?? [])];
    if (rules.length === 0) return undefined;
    return findInContent(content, (text) => {
      const normalized = normalizeLinkText(text).toLowerCase();
      for (const rule of rules) {
        const match = rule.pattern.exec(normalized);
        if (match !== null) return match[0];
      }
      return undefined;
    });
  }

  private async replace(groupId: string | undefined, values: string[]): Promise<void> {
    await this.store.setList(scopeName(groupId), values);
    this.rules.set(scopeName(groupId), values.map(compileRule));
  }
}
