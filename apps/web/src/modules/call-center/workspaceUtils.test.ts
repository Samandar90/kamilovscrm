import { describe, expect, it } from "vitest";
import { clinicInputToIso, formatContact, formatVisit, renderCallScript, safePhoneHref } from "./workspaceUtils";

describe("call-center presentation boundaries", () => {
  it("renders contact instants in clinic time with unambiguous numeric dates in both languages", () => {
    expect(formatContact("2026-08-27T05:30:00Z", "uz")).toBe("27.08.2026 · 10:30");
    expect(formatContact("2026-08-27T05:30:00Z", "ru")).toBe("27.08.2026 · 10:30");
  });
  it("keeps appointment wall time instead of shifting it by the browser timezone", () => {
    expect(formatVisit("2026-08-27T10:30:00.000Z")).toBe("27.08.2026 · 10:30");
  });
  it("converts a Tashkent callback into the actual UTC instant", () => {
    expect(clinicInputToIso("2026-08-28T09:30")).toBe("2026-08-28T04:30:00.000Z");
    expect(clinicInputToIso("2026-02-30T09:30")).toBeNull();
    expect(clinicInputToIso("")).toBeNull();
  });
  it("substitutes repeated known placeholders literally and preserves unknown ones", () => {
    expect(renderCallScript("{patient}, {patient}: {doctor}. {other}", { patient: "$& Ali", doctor: "Dr Karim", lastVisit: "—", nextVisit: "—" }))
      .toBe("$& Ali, $& Ali: Dr Karim. {other}");
  });
  it("does not turn arbitrary patient data into a telephone link", () => {
    expect(safePhoneHref("+998 (90) 123-45-67")).toBe("tel:+998901234567");
    expect(safePhoneHref("javascript:alert(1)")).toBeNull();
    expect(safePhoneHref(null)).toBeNull();
  });
});
