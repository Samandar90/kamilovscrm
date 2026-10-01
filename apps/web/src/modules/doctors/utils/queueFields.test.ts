import { describe, expect, it } from "vitest";
import { normalizeQueuePrefixInput, validateDoctorQueueFields } from "./queueFields";

describe("queue letter input", () => {
  it("upper-cases a typed Cyrillic or Latin letter", () => {
    expect(normalizeQueuePrefixInput("к")).toBe("К");
    expect(normalizeQueuePrefixInput("a")).toBe("A");
    expect(normalizeQueuePrefixInput("Ш")).toBe("Ш");
    expect(normalizeQueuePrefixInput("ў")).toBe("Ў");
  });

  it("keeps only the last typed letter and drops digits, spaces and punctuation", () => {
    expect(normalizeQueuePrefixInput("кб")).toBe("Б");
    // typing "У" after the stored "к" (or pasting over it) replaces the letter
    expect(normalizeQueuePrefixInput("кУ")).toBe("У");
    expect(normalizeQueuePrefixInput("к-5")).toBe("К");
    expect(normalizeQueuePrefixInput("7")).toBe("");
    expect(normalizeQueuePrefixInput(" -")).toBe("");
    expect(normalizeQueuePrefixInput("")).toBe("");
  });

  it("never turns one letter into two when upper-casing", () => {
    expect(normalizeQueuePrefixInput("ß")).toBe("ß");
  });
});

describe("doctor queue fields validation", () => {
  it("accepts empty fields, a 20-character room and a single letter", () => {
    expect(validateDoctorQueueFields("", "")).toBeNull();
    expect(validateDoctorQueueFields("   ", "")).toBeNull();
    expect(validateDoctorQueueFields("12345678901234567890", "К")).toBeNull();
    expect(validateDoctorQueueFields("  5  ", "a")).toBeNull();
    expect(validateDoctorQueueFields("Хирургия-2", " Б ")).toBeNull();
  });

  it("rejects a room longer than 20 characters after trimming", () => {
    expect(validateDoctorQueueFields("123456789012345678901", "")).toBe("roomTooLong");
    expect(validateDoctorQueueFields("  Кабинет стоматологии 2  ", "")).toBe("roomTooLong");
  });

  it("rejects a prefix that is not exactly one letter", () => {
    expect(validateDoctorQueueFields("5", "7")).toBe("queuePrefixOneLetter");
    expect(validateDoctorQueueFields("5", "КБ")).toBe("queuePrefixOneLetter");
    expect(validateDoctorQueueFields("5", "-")).toBe("queuePrefixOneLetter");
  });

  it("reports the room problem first", () => {
    expect(validateDoctorQueueFields("x".repeat(21), "77")).toBe("roomTooLong");
  });
});
