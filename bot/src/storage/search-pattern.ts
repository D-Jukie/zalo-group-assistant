import { escapeRegExp } from "../utils.js";

// Every form a Vietnamese vowel (and d) can take, by the plain letter that is typed for it.
const variants: Readonly<Record<string, string>> = {
  a: "aàáạảãâầấậẩẫăằắặẳẵ",
  e: "eèéẹẻẽêềếệểễ",
  i: "iìíịỉĩ",
  o: "oòóọỏõôồốộổỗơờớợởỡ",
  u: "uùúụủũưừứựửữ",
  y: "yỳýỵỷỹ",
  d: "dđ",
};

// A regular expression source that finds `text` anywhere, whatever the letter case, and with a
// plain letter standing for all its accented forms: "nguyen" finds "Nguyễn". A letter typed with
// its accent only finds that accent, so "nguyễn" does not find "Nguyên".
export function searchPattern(text: string): string {
  return Array.from(text.normalize("NFC")).map((character) => {
    const forms = variants[character.toLowerCase()];
    if (forms !== undefined) return `[${forms}${forms.toUpperCase()}]`;
    const lower = character.toLowerCase();
    const upper = character.toUpperCase();
    // Both cases are spelled out, so the match does not depend on how the database folds case.
    return lower === upper ? escapeRegExp(character) : `[${escapeRegExp(lower)}${escapeRegExp(upper)}]`;
  }).join("");
}
