// How many phone numbers one request to add members may carry. Adding many accounts at once is what
// Zalo takes for spam, so a long list goes in several rounds.
export const maxPhonesPerAdd = 30;

export type PhoneList = Readonly<{ phones: readonly string[]; invalid: readonly string[] }>;

// A Vietnamese mobile number in the form Zalo is asked with: "0" and nine more digits.
// Accepts "+84 912 345 678", "84912345678", "0912.345.678" and the like; undefined for anything else.
export function normalizePhone(input: string): string | undefined {
  const digits = input.replace(/[\s.\-()]/gu, "").replace(/^\+/u, "");
  if (!/^[0-9]+$/u.test(digits)) return undefined;
  const local = digits.startsWith("84") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  return /^0[0-9]{9}$/u.test(local) ? local : undefined;
}

// Reads a pasted list of phone numbers, one per line or separated by commas or semicolons.
// Each number is kept once; what is not a phone number is given back as it was typed.
export function parsePhoneList(text: string): PhoneList {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[\n,;]+/u)) {
    const entry = piece.trim();
    if (entry === "") continue;
    const phone = normalizePhone(entry);
    if (phone === undefined) {
      if (!invalid.includes(entry)) invalid.push(entry);
    } else if (!phones.includes(phone)) {
      phones.push(phone);
    }
  }
  return { phones, invalid };
}

// A phone number as the history keeps it: enough to tell which one it was, not the whole number.
export function maskPhone(phone: string): string {
  return phone.length < 7 ? phone : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}
