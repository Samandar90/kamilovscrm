import { describe, expect, it } from "vitest";
import {
  addDays,
  clinicToday,
  compareCabinets,
  formatQueueCode,
  maskPatientName,
  planQueueChange,
  type QueueSnapshot,
  type QueueTargetState,
} from "./queueRules";

describe("clinicToday", () => {
  it.each([
    ["Asia/Tashkent", "2026-09-30T06:00:00Z", "2026-09-30"], // the fixed test clock: 11:00 in Tashkent
    ["Asia/Tashkent", "2026-09-30T18:59:59Z", "2026-09-30"], // 23:59:59 local — still today
    ["Asia/Tashkent", "2026-09-30T19:00:00Z", "2026-10-01"], // 00:00 local — the queue day turns over
    ["Asia/Tashkent", "2026-12-31T19:00:00Z", "2027-01-01"],
    ["UTC", "2026-09-30T23:59:59Z", "2026-09-30"],
    ["America/New_York", "2026-10-01T03:00:00Z", "2026-09-30"],
  ])("%s at %s → %s", (timeZone, instant, expected) => {
    expect(clinicToday(timeZone, new Date(instant))).toBe(expected);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-09-30", 0, "2026-09-30"],
    ["2026-09-30", 31, "2026-10-31"],
    ["2026-10-01", -1, "2026-09-30"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2028-02-28", 1, "2028-02-29"], // leap year
    ["2028-02-29", 1, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"], // not a leap year
    ["2028-03-01", -1, "2028-02-29"],
  ])("%s + %d days → %s", (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected);
  });
});

describe("formatQueueCode", () => {
  it.each([
    ["К", 5, "К-05"],
    ["к", 5, "К-05"], // lower-case prefix is upper-cased
    ["A", 12, "A-12"],
    ["К", 123, "К-123"], // 3-digit numbers are not truncated
    [null, 7, "07"],
    [undefined, 12, "12"],
    ["", 7, "07"], // empty prefix → digits only
    ["  ", 100, "100"],
  ] as Array<[string | null | undefined, number, string]>)("(%s, %d) → %s", (prefix, queueNumber, expected) => {
    expect(formatQueueCode(prefix, queueNumber)).toBe(expected);
  });
});

describe("maskPatientName", () => {
  it.each([
    ["Каримова Анна Сергеевна", "Анна К."], // three words: surname name patronymic
    ["Каримова Анна", "Анна К."], // two words
    ["Анна", "Анна"], // one word stays as is
    ["  Каримова   Анна  Сергеевна ", "Анна К."], // extra spaces
    ["каримова анна", "анна К."], // the initial is upper-cased, the name is kept as typed
    ["Oʻrinboyeva Gulnoza", "Gulnoza O."], // U+02BB is not the first code point
    ["Gʻaniyev Toʻlqin Akmal oʻgʻli", "Toʻlqin G."], // U+02BB inside the shown name is kept
    ["ўринбоева Гулноза", "Гулноза Ў."], // Uzbek Cyrillic letter upper-cased
    ["𐐨ohnson John", "John 𐐀."], // astral first letter: Array.from, not charAt
    ["", ""],
    ["   ", ""],
    [null, ""],
    [undefined, ""],
  ] as Array<[string | null | undefined, string]>)("%j → %j", (fullName, expected) => {
    expect(maskPatientName(fullName)).toBe(expected);
  });
});

describe("compareCabinets", () => {
  it("orders numeric rooms ascending, then named rooms, then rooms not set; ties by doctor name", () => {
    const cabinets = [
      { room: null, doctorName: "Юсупов" },
      { room: "10", doctorName: "Алиева" },
      { room: "УЗИ", doctorName: "Бобуров" },
      { room: "2", doctorName: "Юсупов" },
      { room: "Лаборатория", doctorName: "Валиев" },
      { room: null, doctorName: "Абдуллаев" },
      { room: "2", doctorName: "Алиева" },
      { room: "3а", doctorName: "Ганиев" },
      { room: "9", doctorName: "Дадаев" },
    ];
    expect([...cabinets].sort(compareCabinets).map((c) => `${c.room ?? "—"}/${c.doctorName}`)).toEqual([
      "2/Алиева",
      "2/Юсупов",
      "9/Дадаев",
      "10/Алиева", // numeric, not string order ("10" < "9" as strings)
      "3а/Ганиев", // "3а" is not a number → named group
      "Лаборатория/Валиев",
      "УЗИ/Бобуров",
      "—/Абдуллаев",
      "—/Юсупов",
    ]);
  });

  it("returns 0 for the same room and doctor, and is antisymmetric", () => {
    const a = { room: "5", doctorName: "Алиева" };
    const b = { room: "Лаборатория", doctorName: "Алиева" };
    expect(compareCabinets(a, { ...a })).toBe(0);
    expect(Math.sign(compareCabinets(a, b))).toBe(-1);
    expect(Math.sign(compareCabinets(b, a))).toBe(1);
  });
});

describe("planQueueChange", () => {
  const TODAY = "2026-09-30";
  const TOMORROW = "2026-10-01";
  const YESTERDAY = "2026-09-29";
  const at = (day: string, time = "10:00:00") => `${day} ${time}`;
  const snap = (patch: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
    status: "scheduled", doctorId: 10, startAt: at(TODAY), queueNumber: null, queueDate: null, ...patch,
  });
  const target = (patch: Partial<QueueTargetState> = {}): QueueTargetState => ({
    status: "arrived", doctorId: 10, startAt: at(TODAY), ...patch,
  });
  const ISSUE = { kind: "issue", day: TODAY };
  const KEEP = { kind: "keep" };
  const CLEAR = { kind: "clear" };
  const numbered = { status: "arrived" as const, queueNumber: 3, queueDate: TODAY };

  it.each([
    // New appointment (current = null)
    ["new, arrived today → issue", null, target(), ISSUE],
    ["new, arrived on another day → keep (no numbers for other days)", null, target({ startAt: at(TOMORROW) }), KEEP],
    ["new, scheduled today → keep", null, target({ status: "scheduled" }), KEEP],
    ["new, in_consultation today → keep (no number when the doctor takes the patient directly)", null, target({ status: "in_consultation" }), KEEP],
    // Arrival today
    ["scheduled → arrived today → issue", snap(), target(), ISSUE],
    ["confirmed → arrived today → issue", snap({ status: "confirmed" }), target(), ISSUE],
    ["arrived without a number (pre-feature) → arrived today → issue", snap({ status: "arrived" }), target(), ISSUE],
    ["arrived with today's number, same doctor → keep (idempotent)", snap(numbered), target(), KEEP],
    ["arrived with today's number, time moved within today → keep", snap(numbered), target({ startAt: at(TODAY, "15:30:00") }), KEEP],
    ["number dated another day, arrived today → issue (!hasToday)", snap({ ...numbered, queueDate: YESTERDAY }), target(), ISSUE],
    ["number without a date, arrived today → issue (!hasToday)", snap({ ...numbered, queueDate: null }), target(), ISSUE],
    ["numbered yesterday, moved to today and arrived → issue beats clear", snap({ ...numbered, startAt: at(YESTERDAY), queueDate: YESTERDAY }), target(), ISSUE],
    // Return to queue: no_show → arrived
    ["no_show with today's number → arrived today → issue (new number at the end)", snap({ ...numbered, status: "no_show" }), target(), ISSUE],
    ["no_show without a number → arrived today → issue", snap({ status: "no_show" }), target(), ISSUE],
    ["no_show → arrived on another day → keep (the service rejects this earlier)", snap({ status: "no_show", startAt: at(TOMORROW) }), target({ startAt: at(TOMORROW) }), KEEP],
    // Doctor change
    ["arrived with today's number, doctor changed, still arrived today → issue", snap(numbered), target({ doctorId: 11 }), ISSUE],
    ["no number, doctor changed, arrived today → issue", snap(), target({ doctorId: 11 }), ISSUE],
    ["no number, doctor changed, arrived tomorrow → keep", snap({ startAt: at(TOMORROW) }), target({ doctorId: 11, startAt: at(TOMORROW) }), KEEP],
    ["numbered, doctor changed, status becomes scheduled → clear", snap(numbered), target({ doctorId: 11, status: "scheduled" }), CLEAR],
    ["numbered, in_consultation, doctor changed → clear", snap({ ...numbered, status: "in_consultation" }), target({ doctorId: 11, status: "in_consultation" }), CLEAR],
    ["no number, doctor changed, scheduled → keep (nothing to clear)", snap(), target({ doctorId: 11, status: "scheduled" }), KEEP],
    // Date change
    ["numbered, moved to tomorrow while arrived → clear", snap(numbered), target({ startAt: at(TOMORROW) }), CLEAR],
    ["numbered, completed, moved to another day → clear", snap({ ...numbered, status: "completed" }), target({ status: "completed", startAt: at(YESTERDAY) }), CLEAR],
    ["numbered, doctor and date changed → clear", snap(numbered), target({ doctorId: 11, startAt: at(TOMORROW) }), CLEAR],
    ["no number, moved to tomorrow → keep", snap(), target({ status: "scheduled", startAt: at(TOMORROW) }), KEEP],
    ["no number, arrived, moved from tomorrow to today with another doctor → issue", snap({ status: "arrived", startAt: at(TOMORROW) }), target({ doctorId: 11 }), ISSUE],
    // Status changes of a numbered appointment on the same doctor and day keep the number
    ["numbered → in_consultation → keep", snap(numbered), target({ status: "in_consultation" }), KEEP],
    ["numbered → completed → keep", snap({ ...numbered, status: "in_consultation" }), target({ status: "completed" }), KEEP],
    ["numbered → no_show → keep (shown as missed)", snap(numbered), target({ status: "no_show" }), KEEP],
    ["numbered → cancelled → keep (numbers are never reused)", snap(numbered), target({ status: "cancelled" }), KEEP],
    ["scheduled → confirmed today → keep", snap(), target({ status: "confirmed" }), KEEP],
    ["scheduled → arrived on another day → keep (closing past visits needs no number)", snap({ startAt: at(YESTERDAY) }), target({ startAt: at(YESTERDAY) }), KEEP],
  ] as Array<[string, QueueSnapshot | null, QueueTargetState, unknown]>)("%s", (_label, current, next, expected) => {
    expect(planQueueChange(current, next, TODAY)).toEqual(expected);
  });
});
