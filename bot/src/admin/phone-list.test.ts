import assert from "node:assert/strict";
import test from "node:test";
import { maskPhone, normalizePhone, parsePhoneList } from "./phone-list.js";

await test("a phone number is brought to the form 0 and nine digits", () => {
  assert.equal(normalizePhone("0912345678"), "0912345678");
  assert.equal(normalizePhone("+84 912 345 678"), "0912345678");
  assert.equal(normalizePhone("84912345678"), "0912345678");
  assert.equal(normalizePhone("0912.345.678"), "0912345678");
  assert.equal(normalizePhone("(091) 234-5678"), "0912345678");
});

await test("what is not a ten-digit number is refused", () => {
  assert.equal(normalizePhone("091234567"), undefined);
  assert.equal(normalizePhone("09123456789"), undefined);
  assert.equal(normalizePhone("912345678"), undefined);
  assert.equal(normalizePhone("0912 abc 678"), undefined);
  assert.equal(normalizePhone(""), undefined);
});

await test("a pasted list is split on lines, commas and semicolons, each number once", () => {
  assert.deepEqual(parsePhoneList("0912345678\n+84987654321, 0912 345 678;\n\nNguyễn Văn A\n123"), {
    phones: ["0912345678", "0987654321"],
    invalid: ["Nguyễn Văn A", "123"],
  });
  assert.deepEqual(parsePhoneList("  \n "), { phones: [], invalid: [] });
});

await test("the history keeps a phone number with its middle hidden", () => {
  assert.equal(maskPhone("0912345678"), "0912***678");
});
