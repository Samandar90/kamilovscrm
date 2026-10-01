import { describe, expect, it, vi } from "vitest";
import type { IQueueRepository, QueueDayRow, QueueDoctorRow } from "../../repositories/interfaces/queueTypes";
import { buildQueueDoctors, loadQueueDay, toQueueEntry } from "./queueDay";

const row = (over: Partial<QueueDayRow>): QueueDayRow => ({
  appointmentId: 1,
  doctorId: 10,
  patientId: 100,
  patientName: "Каримова Анна Сергеевна",
  status: "arrived",
  startAt: "2026-09-30 10:00:00",
  queueNumber: 1,
  queuePrefix: "К",
  queueDate: "2026-09-30",
  issuedAt: "2026-09-30T03:00:00.000Z",
  calledAt: null,
  callCount: 0,
  updatedAt: "2026-09-30T05:00:00.000Z",
  ...over,
});

const doctor = (over: Partial<QueueDoctorRow>): QueueDoctorRow => ({
  id: 10,
  name: "Алиева Нигора",
  specialty: "Терапевт",
  room: "5",
  prefix: "К",
  ...over,
});

describe("toQueueEntry", () => {
  it("derives the queue state from the appointment status", () => {
    expect(toQueueEntry(row({}))).toEqual({
      appointmentId: 1,
      doctorId: 10,
      patientId: 100,
      patientName: "Каримова Анна Сергеевна",
      number: 1,
      code: "К-01",
      state: "waiting",
      startAt: "2026-09-30 10:00:00",
      issuedAt: "2026-09-30T03:00:00.000Z",
      calledAt: null,
      callCount: 0,
    });
    expect(toQueueEntry(row({ calledAt: "2026-09-30T05:10:00.000Z", callCount: 2 }))).toMatchObject({ state: "called", callCount: 2 });
    expect(toQueueEntry(row({ status: "in_consultation" }))?.state).toBe("serving");
    expect(toQueueEntry(row({ status: "no_show" }))?.state).toBe("missed");
    expect(toQueueEntry(row({ status: "completed" }))?.state).toBe("done");
    for (const status of ["scheduled", "confirmed", "cancelled"] as const) {
      expect(toQueueEntry(row({ status }))).toBeNull();
    }
  });

  it("formats codes without a letter and keeps serving-without-ticket codeless", () => {
    expect(toQueueEntry(row({ queuePrefix: null, queueNumber: 7 }))?.code).toBe("07");
    expect(toQueueEntry(row({ queueNumber: 123 }))?.code).toBe("К-123");
    expect(toQueueEntry(row({ status: "in_consultation", queueNumber: null, queuePrefix: null, queueDate: null }))).toMatchObject({
      state: "serving",
      number: null,
      code: null,
    });
  });
});

describe("buildQueueDoctors", () => {
  const doctors = [
    doctor({}),
    doctor({ id: 11, name: "Юсупов Азиз", room: "12", prefix: null }),
    doctor({ id: 12, name: "Ким Елена", room: null, prefix: null }),
    doctor({ id: 13, name: "Лаборатория", room: "Лаборатория", prefix: null }),
    doctor({ id: 14, name: "Бекова Сабина", room: "3", prefix: null }),
  ];

  it("groups entries per doctor with serving, waiting, missed and done counts", () => {
    const rows = [
      row({ appointmentId: 1, queueNumber: 3 }),
      row({ appointmentId: 2, queueNumber: 1, calledAt: "2026-09-30T05:10:00.000Z", callCount: 1 }),
      row({ appointmentId: 3, queueNumber: 2, status: "no_show" }),
      row({ appointmentId: 4, queueNumber: 5, status: "completed" }),
      row({ appointmentId: 5, queueNumber: 6, status: "completed" }),
      row({ appointmentId: 6, queueNumber: 4, status: "in_consultation", updatedAt: "2026-09-30T05:30:00.000Z" }),
      row({ appointmentId: 7, queueNumber: null, queuePrefix: null, queueDate: null, status: "in_consultation", updatedAt: "2026-09-30T05:20:00.000Z" }),
      row({ appointmentId: 8, queueNumber: 7, status: "cancelled" }),
      row({ appointmentId: 9, doctorId: 11, queueNumber: 1, queuePrefix: null }),
    ];
    const [first, second] = buildQueueDoctors(rows, doctors, []);
    expect(first).toMatchObject({ doctorId: 10, doctorName: "Алиева Нигора", specialty: "Терапевт", room: "5", prefix: "К", doneCount: 2 });
    expect(first.serving).toMatchObject({ appointmentId: 6, number: 4, code: "К-04", state: "serving" });
    expect(first.waiting.map((entry) => [entry.appointmentId, entry.state])).toEqual([
      [2, "called"],
      [1, "waiting"],
    ]);
    expect(first.missed.map((entry) => entry.code)).toEqual(["К-02"]);
    expect(second).toMatchObject({ doctorId: 11, serving: null, missed: [], doneCount: 0 });
    expect(second.waiting.map((entry) => entry.code)).toEqual(["01"]);
  });

  it("keeps only doctors with entries or always-included ones, ordered by cabinet", () => {
    const rows = [row({ appointmentId: 1, doctorId: 12 }), row({ appointmentId: 2, doctorId: 13 }), row({ appointmentId: 3, doctorId: 99 })];
    const days = buildQueueDoctors(rows, doctors, [11, 14, 98]);
    expect(days.map((day) => day.doctorId)).toEqual([14, 11, 13, 12]);
    expect(days.find((day) => day.doctorId === 14)).toMatchObject({ serving: null, waiting: [], missed: [], doneCount: 0 });
  });

  it("ignores rows that are not part of a queue", () => {
    expect(buildQueueDoctors([row({ status: "scheduled" }), row({ appointmentId: 2, status: "cancelled" })], doctors, [])).toEqual([]);
  });
});

describe("loadQueueDay", () => {
  const repo = (rows: QueueDayRow[]) =>
    ({
      listDayRows: vi.fn(async () => rows),
      listDoctors: vi.fn(async (_clinicId: number, ids: number[]) => ids.map((id) => doctor({ id, name: `Врач ${id}`, room: String(id) }))),
    }) as unknown as IQueueRepository & { listDayRows: ReturnType<typeof vi.fn>; listDoctors: ReturnType<typeof vi.fn> };

  it("loads doctors for the rows plus the always-included ones", async () => {
    const fake = repo([row({ appointmentId: 1, doctorId: 10 }), row({ appointmentId: 2, doctorId: 10, queueNumber: 2 })]);
    const result = await loadQueueDay(fake, 1, "2026-09-30", [10, 12], [12]);
    expect(fake.listDayRows).toHaveBeenCalledWith(1, "2026-09-30", [10, 12]);
    expect(fake.listDoctors).toHaveBeenCalledWith(1, [10, 12]);
    expect(result.rows).toHaveLength(2);
    expect(result.doctors.map((day) => [day.doctorId, day.waiting.length])).toEqual([
      [10, 2],
      [12, 0],
    ]);
  });

  it("skips the doctor lookup for an empty day", async () => {
    const fake = repo([]);
    expect(await loadQueueDay(fake, 1, "2026-09-30", null, [])).toEqual({ rows: [], doctors: [] });
    expect(fake.listDoctors).not.toHaveBeenCalled();
  });
});
