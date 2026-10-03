import { describe, expect, it, vi } from "vitest";
// parseNumericInput imports errorHandler, which reads config/env (JWT_SECRET from .env).
vi.mock("../../config/env", () => ({ env: { isProduction: false } }));
import { parseNumericInput } from "./parseNumericInput";

describe("parseNumericInput", () => {
  it("parses plain numbers", () => {
    expect(parseNumericInput(1_500_000)).toBe(1_500_000);
    expect(parseNumericInput(1500000.5)).toBe(1500000.5);
  });

  it("parses formatted strings", () => {
    expect(parseNumericInput("1500000")).toBe(1500000);
    expect(parseNumericInput("1 500 000")).toBe(1_500_000);
    expect(parseNumericInput("1 500 000 сум")).toBe(1_500_000);
    expect(parseNumericInput("1,500,000")).toBe(1_500_000);
    expect(parseNumericInput("1500000,50")).toBe(1500000.5);
    expect(parseNumericInput("1500000.50")).toBe(1500000.5);
  });

  it("returns null for empty and invalid", () => {
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput(undefined)).toBeNull();
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput(Number.NaN)).toBeNull();
  });
});
