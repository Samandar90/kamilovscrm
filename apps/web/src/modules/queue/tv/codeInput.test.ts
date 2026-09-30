import { describe, expect, it } from "vitest";
import { formatCodeForDisplay, normalizeCodeInput } from "./codeInput";

describe("normalizeCodeInput", () => {
  it("upper-cases, drops the dash, spaces and other characters, and caps at 10", () => {
    expect(normalizeCodeInput("k7m2q-9xr4p")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput(" K7M2Q 9XR4P ")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput("K7M2Q-9XR4P-EXTRA")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput("кОд-12")).toBe("12");
    expect(normalizeCodeInput("")).toBe("");
  });
});

describe("formatCodeForDisplay", () => {
  it("inserts the dash after five characters", () => {
    expect(formatCodeForDisplay("K7M2Q9XR4P")).toBe("K7M2Q-9XR4P");
    expect(formatCodeForDisplay("K7M2Q9")).toBe("K7M2Q-9");
    expect(formatCodeForDisplay("K7M2Q")).toBe("K7M2Q");
    expect(formatCodeForDisplay("")).toBe("");
  });

  it("round-trips through normalizeCodeInput", () => {
    expect(normalizeCodeInput(formatCodeForDisplay("K7M2Q9XR4P"))).toBe("K7M2Q9XR4P");
  });
});
