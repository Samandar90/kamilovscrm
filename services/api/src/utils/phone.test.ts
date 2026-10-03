import { describe, expect, it } from "vitest";
import { canonicalizePhone } from "./phone";

describe("canonicalizePhone", () => {
  it.each<[unknown, string]>([
    ["+998 90 123-45-67", "998901234567"],
    ["998901234567", "998901234567"],
    [998901234567, "998901234567"], // a numeric cell
    ["901234567", "998901234567"], // 9 digits: the national number
    [901234567, "998901234567"],
    ["(90) 123 45 67", "998901234567"],
    ["p:+998901234567", "998901234567"], // the label ad lead forms put before the phone
    ["'+998901234567", "998901234567"], // the apostrophe that keeps a cell as text
    ["00998901234567", "998901234567"], // international prefix 00
    [" +998 90 123 45 67 ", "998901234567"], // non-breaking space at the edge
    ["+998 90 123 45 67", "998901234567"], // non-breaking spaces inside
    ["+7 912 345-67-89", "79123456789"], // a foreign number is kept as is
    ["998 99 812 34 56", "998998123456"], // operator code 99
    ["998123456", "998998123456"], // 9 digits that start with 998 are still a national number
  ])("accepts %j → %s", (input, expected) => {
    expect(canonicalizePhone(input)).toBe(expected);
  });

  it.each<[unknown, string]>([
    ["9.98901E+11", "exponent notation"],
    [9.98901234567e22, "a number that is not a safe integer"],
    [901234567.5, "a fraction"],
    [-998901234567, "a negative number"],
    [Number.NaN, "NaN"],
    ["998 90 123 45", "a truncated Uzbek number"],
    ["9989012345678", "an Uzbek number with an extra digit"],
    ["998111234567", "12 digits, operator code 11 is not allowed"],
    ["123", "too short"],
    ["1234567890123456", "16 digits"],
    ["abc", "letters"],
    ["", "empty"],
    ["   ", "spaces only"],
    ["+", "a lone plus"],
    [null, "null"],
    [undefined, "undefined"],
    [{}, "an object"],
    [["998901234567"], "an array"],
    [true, "a boolean"],
    ["111234567", "9 digits, operator code 11 is not allowed"],
    ["+998 90 123 45 67 доб. 12", "an extension in words"],
    ["998901234567+", "a plus that is not leading"],
    ["abc:+998901234567", "a label longer than two letters"],
  ])("rejects %j (%s)", (input) => {
    expect(canonicalizePhone(input)).toBeNull();
  });

  it("gives one value for the same number written in different ways", () => {
    const written = ["+998 90 123-45-67", "998901234567", "90 123 45 67", 998901234567, "00 998 (90) 123.45.67"];
    expect(new Set(written.map(canonicalizePhone))).toEqual(new Set(["998901234567"]));
  });

  it("keeps foreign numbers of 10 to 15 digits", () => {
    expect(canonicalizePhone("1234567890")).toBe("1234567890");
    expect(canonicalizePhone("+123456789012345")).toBe("123456789012345");
    expect(canonicalizePhone("123456789")).toBeNull();
  });
});
