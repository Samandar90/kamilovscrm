import { describe, expect, it } from "vitest";
import { formatClock, formatDay, msUntilDailyReload } from "./tvTime";

const at = (iso: string) => Date.parse(iso);

describe("TV clock", () => {
  it("shows the clinic wall clock, not the device clock", () => {
    expect(formatClock(at("2026-09-30T06:00:00Z"), "Asia/Tashkent")).toBe("11:00");
    expect(formatClock(at("2026-09-30T19:05:59Z"), "Asia/Tashkent")).toBe("00:05");
    expect(formatDay(at("2026-09-30T19:05:59Z"), "Asia/Tashkent")).toBe("01.10.2026");
  });

  it("falls back to the device zone for an unknown zone name instead of throwing", () => {
    expect(formatClock(at("2026-09-30T06:00:00Z"), "Not/AZone")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("msUntilDailyReload", () => {
  it("waits until the next 04:00 in the clinic zone", () => {
    // 11:00 in Tashkent → 17 hours until 04:00 tomorrow
    expect(msUntilDailyReload(at("2026-09-30T06:00:00Z"), "Asia/Tashkent")).toBe(17 * 3600 * 1000);
    // 03:30 in Tashkent → 30 minutes
    expect(msUntilDailyReload(at("2026-09-29T22:30:00Z"), "Asia/Tashkent")).toBe(30 * 60 * 1000);
  });

  it("schedules the next day right after a reload at 04:00 and never returns less than a minute", () => {
    expect(msUntilDailyReload(at("2026-09-29T23:00:00Z"), "Asia/Tashkent")).toBe(24 * 3600 * 1000);
    expect(msUntilDailyReload(at("2026-09-29T22:59:30Z"), "Asia/Tashkent")).toBe(60_000);
  });

  it("subtracts the milliseconds of the current second", () => {
    expect(msUntilDailyReload(at("2026-09-30T06:00:00.250Z"), "Asia/Tashkent")).toBe(17 * 3600 * 1000 - 250);
  });
});
