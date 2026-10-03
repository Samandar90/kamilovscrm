import { describe, expect, it } from "vitest";
import { addDaysYmd, dateToYmd } from "./appointmentFormUtils";

describe("calendar day helpers", () => {
  it("formats the local calendar day of a date, whatever the time of day", () => {
    expect(dateToYmd(new Date(2026, 0, 5, 0, 0, 0))).toBe("2026-01-05");
    expect(dateToYmd(new Date(2026, 9, 3, 23, 59, 59, 999))).toBe("2026-10-03");
  });

  it("shifts a day forward and back across month and year ends", () => {
    expect(addDaysYmd("2026-10-03", 7)).toBe("2026-10-10");
    expect(addDaysYmd("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDaysYmd("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysYmd("2028-03-01", -1)).toBe("2028-02-29");
  });
});
