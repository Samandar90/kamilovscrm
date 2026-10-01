import { describe, expect, it } from "vitest";
import { buildDisplayState } from "./displayState";
import type { QueueDayRow, QueueDisplay, QueueDoctorDay, QueueEntry } from "../../repositories/interfaces/queueTypes";

const display: QueueDisplay = {
  id: 7, name: "Холл 1", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

const entry = (over: Partial<QueueEntry> & Pick<QueueEntry, "appointmentId" | "state">): QueueEntry => ({
  doctorId: 10, patientId: 100, patientName: "Каримов Алишер Бахтиёрович", number: 1, code: "К-01",
  startAt: "2026-09-30 10:00:00", issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0, ...over,
});

const doctor = (over: Partial<QueueDoctorDay> & Pick<QueueDoctorDay, "doctorId">): QueueDoctorDay => ({
  doctorName: "Алиева Нигора", specialty: "Терапевт", room: "5", prefix: "К",
  serving: null, waiting: [], missed: [], doneCount: 0, ...over,
});

const row = (over: Partial<QueueDayRow> & Pick<QueueDayRow, "appointmentId">): QueueDayRow => ({
  doctorId: 10, patientId: 100, patientName: "Каримов Алишер Бахтиёрович", status: "arrived",
  startAt: "2026-09-30 10:00:00", queueNumber: 1, queuePrefix: "К", queueDate: "2026-09-30",
  issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0, updatedAt: "2026-09-30T04:00:00.000Z", ...over,
});

const build = (doctors: QueueDoctorDay[], rows: QueueDayRow[] = [], showNames = true) =>
  buildDisplayState({
    serverTime: "2026-09-30T06:00:00.000Z", timeZone: "Asia/Tashkent", clinicName: "Клиника Камилова",
    display: { ...display, showNames }, doctors, rows,
  });

const called = (appointmentId: number, number: number, calledAt: string, patientName: string) =>
  entry({ appointmentId, number, code: `К-0${number}`, state: "called", calledAt, callCount: 1, patientName });
const waiting = (appointmentId: number, number: number, patientName = "Юсупова Дилноза") =>
  entry({ appointmentId, number, code: number < 10 ? `К-0${number}` : `К-${number}`, state: "waiting", patientName });

describe("buildDisplayState", () => {
  it("copies the header fields and only the public part of the display", () => {
    const state = build([]);
    expect(state).toEqual({
      serverTime: "2026-09-30T06:00:00.000Z", timeZone: "Asia/Tashkent", clinicName: "Клиника Камилова",
      display: { name: "Холл 1", language: "uz_ru", voiceEnabled: true, showNames: true },
      cabinets: [], recentCalls: [],
    });
  });

  it("shows the patient being served as current, even when someone else is already called", () => {
    const serving = entry({ appointmentId: 1, number: 1, code: "К-01", state: "serving", calledAt: "2026-09-30T05:00:00.000Z", callCount: 1 });
    const state = build([doctor({ doctorId: 10, serving, waiting: [called(2, 2, "2026-09-30T05:50:00.000Z", "Юсупова Дилноза")] })]);
    expect(state.cabinets[0].current).toEqual({ code: "К-01", name: "Алишер К.", state: "serving" });
  });

  it("keeps a serving patient without a ticket as current with a null code", () => {
    const serving = entry({ appointmentId: 1, number: null, code: null, state: "serving", issuedAt: null });
    expect(build([doctor({ doctorId: 10, serving })]).cabinets[0].current).toEqual({ code: null, name: "Алишер К.", state: "serving" });
  });

  it("falls back to the most recently called patient, then to null", () => {
    const early = called(2, 2, "2026-09-30T05:30:00.000Z", "Юсупова Дилноза");
    const late = called(3, 3, "2026-09-30T05:55:00.000Z", "Ахмедов Бобур");
    const state = build([
      doctor({ doctorId: 10, waiting: [early, late, waiting(4, 4)] }),
      doctor({ doctorId: 11, room: "6", waiting: [waiting(5, 1)] }),
    ]);
    expect(state.cabinets[0].current).toEqual({ code: "К-03", name: "Бобур А.", state: "called" });
    expect(state.cabinets[1].current).toBeNull();
  });

  it("lists the first five waiting patients by number, counts all of them and skips called ones", () => {
    const list = [9, 3, 8, 4, 7, 5, 6].map((n) => waiting(100 + n, n));
    const state = build([doctor({ doctorId: 10, waiting: [called(2, 2, "2026-09-30T05:50:00.000Z", "Ахмедов Бобур"), ...list] })]);
    expect(state.cabinets[0].waiting.map((w) => w.code)).toEqual(["К-03", "К-04", "К-05", "К-06", "К-07"]);
    expect(state.cabinets[0].waiting[0]).toEqual({ code: "К-03", name: "Дилноза Ю." });
    expect(state.cabinets[0].waitingCount).toBe(7);
  });

  it("hides every name when showNames is off", () => {
    const serving = entry({ appointmentId: 1, state: "serving" });
    const state = build(
      [doctor({ doctorId: 10, serving, waiting: [waiting(4, 4)] })],
      [row({ appointmentId: 1, status: "in_consultation", calledAt: "2026-09-30T05:00:00.000Z", callCount: 1 })],
      false
    );
    expect(state.display.showNames).toBe(false);
    expect(state.cabinets[0].current?.name).toBeNull();
    expect(state.cabinets[0].waiting[0].name).toBeNull();
    expect(state.recentCalls[0].name).toBeNull();
    expect(JSON.stringify(state)).not.toContain("Алишер");
  });

  it("orders cabinets by room: numbers ascending, then text rooms, then no room", () => {
    const state = build([
      doctor({ doctorId: 1, doctorName: "Ахмедов", room: null }),
      doctor({ doctorId: 2, doctorName: "Бобоев", room: "12" }),
      doctor({ doctorId: 3, doctorName: "Гуляев", room: "Лаб" }),
      doctor({ doctorId: 4, doctorName: "Валиев", room: "3" }),
    ]);
    expect(state.cabinets.map((c) => c.doctorId)).toEqual([4, 2, 3, 1]);
    expect(state.cabinets[0]).toEqual({
      doctorId: 4, doctorName: "Валиев", specialty: "Терапевт", room: "3", current: null, waiting: [], waitingCount: 0,
    });
  });

  it("builds recent calls newest first with a key per call, max 20, without cancelled or unnumbered rows", () => {
    const rows: QueueDayRow[] = [];
    for (let i = 0; i < 22; i += 1) {
      rows.push(row({
        appointmentId: 500 + i, queueNumber: i + 1, status: i % 2 ? "arrived" : "completed",
        calledAt: new Date(Date.parse("2026-09-30T04:00:00.000Z") + i * 60_000).toISOString(), callCount: 1,
      }));
    }
    rows.push(row({ appointmentId: 900, queueNumber: 30, status: "cancelled", calledAt: "2026-09-30T05:59:00.000Z", callCount: 1 }));
    rows.push(row({ appointmentId: 901, queueNumber: null, status: "in_consultation", calledAt: "2026-09-30T05:58:00.000Z", callCount: 1 }));
    rows.push(row({ appointmentId: 902, queueNumber: 31, status: "arrived", calledAt: null }));
    rows.push(row({ appointmentId: 903, doctorId: 99, queueNumber: 3, queuePrefix: null, calledAt: "2026-09-30T05:57:00.000Z", callCount: 2 }));

    const state = build([doctor({ doctorId: 10 })], rows);
    expect(state.recentCalls).toHaveLength(20);
    expect(state.recentCalls[0]).toEqual({
      key: "2026-09-30:99:3:2", code: "03", number: 3, name: "Алишер К.", room: null, doctorName: "", calledAt: "2026-09-30T05:57:00.000Z",
    });
    expect(state.recentCalls[1]).toEqual({
      key: "2026-09-30:10:22:1", code: "К-22", number: 22, name: "Алишер К.", room: "5", doctorName: "Алиева Нигора", calledAt: "2026-09-30T04:21:00.000Z",
    });
    expect(state.recentCalls.map((c) => c.key)).not.toContain("2026-09-30:10:30:1");
    // The unnumbered row has no ticket, so it cannot have a key: check it by its call time instead.
    expect(state.recentCalls.map((c) => c.calledAt)).not.toContain("2026-09-30T05:58:00.000Z");
    expect(state.recentCalls[19].key).toBe("2026-09-30:10:4:1");
  });

  it("a re-issued ticket of the same appointment gets a new key", () => {
    // «Вернуть в очередь» or a doctor change gives the same appointment a new number and resets callCount to 0.
    const first = build([doctor({ doctorId: 10 })], [row({ appointmentId: 103, queueNumber: 3, calledAt: "2026-09-30T05:00:00.000Z", callCount: 1 })]);
    const again = build([doctor({ doctorId: 10 })], [row({ appointmentId: 103, queueNumber: 7, calledAt: "2026-09-30T05:50:00.000Z", callCount: 1 })]);
    expect(first.recentCalls[0].key).toBe("2026-09-30:10:3:1");
    expect(again.recentCalls[0].key).toBe("2026-09-30:10:7:1");
    expect(again.recentCalls[0].key).not.toBe(first.recentCalls[0].key);
  });
});
