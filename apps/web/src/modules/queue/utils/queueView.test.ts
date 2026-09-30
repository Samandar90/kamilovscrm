import { describe, expect, it } from "vitest";
import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";
import { entryLabel, formatWallTime, nextWaiting, waitMinutes } from "./queueView";

const entry = (number: number | null, state: QueueEntry["state"], extra: Partial<QueueEntry> = {}): QueueEntry => ({
  appointmentId: 100 + (number ?? 0),
  doctorId: 10,
  patientId: 200 + (number ?? 0),
  patientName: `Patient ${number ?? "direct"}`,
  number,
  code: number === null ? null : `К-${String(number).padStart(2, "0")}`,
  state,
  startAt: "2026-09-30 10:00:00",
  issuedAt: "2026-09-30T05:00:00.000Z",
  calledAt: state === "called" ? "2026-09-30T05:30:00.000Z" : null,
  callCount: state === "called" ? 1 : 0,
  ...extra,
});
const day = (waiting: QueueEntry[]): QueueDoctorDay => ({
  doctorId: 10, doctorName: "Karimov Aziz", specialty: "Терапевт", room: "5", prefix: "К",
  serving: null, waiting, missed: [], doneCount: 0,
});

describe("next patient to call", () => {
  it("skips called entries and takes the first still-waiting one", () => {
    expect(nextWaiting(day([entry(4, "called"), entry(5, "waiting"), entry(6, "waiting")]))?.code).toBe("К-05");
  });
  it("is null when everyone was already called or nobody waits", () => {
    expect(nextWaiting(day([entry(4, "called")]))).toBeNull();
    expect(nextWaiting(day([]))).toBeNull();
  });
});

describe("waiting time on the server clock", () => {
  const serverTime = "2026-09-30T06:00:00.000Z";
  const serverMs = Date.parse(serverTime);

  it("counts whole minutes since the number was issued", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs)).toBe(12);
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs + 59_000)).toBe(12);
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs + 60_000)).toBe(13);
  });
  it("ignores a client clock that is an hour fast", () => {
    const skew = 3_600_000;
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, skew, serverMs + skew + 120_000)).toBe(14);
  });
  it("never goes below the snapshot time when the client clock moves backwards", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs - 600_000)).toBe(12);
  });
  it("is never negative and null without a valid issue time", () => {
    expect(waitMinutes("2026-09-30T06:05:00.000Z", serverTime, 0, serverMs)).toBe(0);
    expect(waitMinutes(null, serverTime, 0, serverMs)).toBeNull();
    expect(waitMinutes("not a date", serverTime, 0, serverMs)).toBeNull();
  });
  it("falls back to the client estimate when serverTime is unparsable", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", "", 0, serverMs)).toBe(12);
  });
});

describe("appointment wall-clock time", () => {
  it("slices HH:MM without any time-zone conversion", () => {
    expect(formatWallTime("2026-09-30 10:05:00")).toBe("10:05");
    expect(formatWallTime("2026-09-30T08:30:00")).toBe("08:30");
    expect(formatWallTime("2026-09-30 00:00:00")).toBe("00:00");
  });
  it("shows a dash for anything else", () => {
    expect(formatWallTime("")).toBe("—");
    expect(formatWallTime("10:05")).toBe("—");
  });
});

describe("entry label", () => {
  it("uses the ticket code, or the patient's name for a visit without a number", () => {
    expect(entryLabel(entry(7, "waiting"))).toBe("К-07");
    expect(entryLabel(entry(null, "serving"))).toBe("Patient direct");
  });
});
