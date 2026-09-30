import { describe, expect, it } from "vitest";
import {
  DISPLAY_CODE_ALPHABET,
  formatDisplayCode,
  generateDisplayCode,
  hashDisplayCode,
  normalizeDisplayCode,
} from "./displayCode";

describe("DISPLAY_CODE_ALPHABET", () => {
  it("has 31 unique characters and no look-alikes", () => {
    expect(DISPLAY_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(DISPLAY_CODE_ALPHABET).size).toBe(31);
    for (const excluded of ["0", "1", "I", "L", "O"]) {
      expect(DISPLAY_CODE_ALPHABET).not.toContain(excluded);
    }
  });
});

describe("generateDisplayCode", () => {
  it("returns 10 characters from the alphabet only", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateDisplayCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    }
  });

  it("does not repeat over 200 samples", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateDisplayCode()));
    expect(codes.size).toBe(200);
  });

  it("round-trips through format and normalize", () => {
    const code = generateDisplayCode();
    expect(normalizeDisplayCode(formatDisplayCode(code))).toBe(code);
  });
});

describe("formatDisplayCode", () => {
  it("splits the canonical code 5 + 5 with a dash", () => {
    expect(formatDisplayCode("K7M2Q9XR4P")).toBe("K7M2Q-9XR4P");
  });
});

describe("normalizeDisplayCode", () => {
  it.each([
    ["K7M2Q9XR4P", "K7M2Q9XR4P"],
    ["K7M2Q-9XR4P", "K7M2Q9XR4P"], // dash from the formatted code
    ["k7m2q-9xr4p", "K7M2Q9XR4P"], // lower-case typed on a TV remote
    ["  K7M2Q 9XR4P  ", "K7M2Q9XR4P"], // spaces
    ["k7m2q_9xr4p\n", "K7M2Q9XR4P"], // any other separator is stripped too
  ])("accepts %j → %s", (input, expected) => {
    expect(normalizeDisplayCode(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["K7M2Q-9XR4", "9 characters"],
    ["K7M2Q-9XR4PP", "11 characters"],
    ["K7M2Q-9XR40", "excluded 0"],
    ["K7M2Q-9XR41", "excluded 1"],
    ["K7M2Q-9XR4I", "excluded I"],
    ["K7M2Q-9XR4L", "excluded L"],
    ["K7M2Q-9XR4O", "excluded O"],
    ["К7М2Q-9ХR4Р", "Cyrillic look-alikes are stripped, leaving 6 characters"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizeDisplayCode(input)).toBeNull();
  });
});

describe("hashDisplayCode", () => {
  it("is the sha256 hex of the canonical code and is stable", () => {
    expect(hashDisplayCode("K7M2Q9XR4P")).toBe("c0f0e382b4bf7b79193b8cc9c22a202247ffc424b81d8122e920ac1651b58833");
    expect(hashDisplayCode("K7M2Q9XR4P")).toBe(hashDisplayCode("K7M2Q9XR4P"));
    expect(hashDisplayCode("K7M2Q9XR4P")).not.toBe(hashDisplayCode("K7M2Q9XR4Q"));
    expect(hashDisplayCode(generateDisplayCode())).toMatch(/^[0-9a-f]{64}$/);
  });
});
