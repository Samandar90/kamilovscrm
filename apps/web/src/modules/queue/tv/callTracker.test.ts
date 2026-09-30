import { describe, expect, it } from "vitest";
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";
import { createCallTracker } from "./callTracker";

const call = (key: string, calledAt: string, code = "К-05"): QueueDisplayCall => ({
  key, code, number: 5, name: "Алишер К.", room: "3", doctorName: "Каримов Бахтиёр", calledAt,
});

const state = (serverTime: string, recentCalls: QueueDisplayCall[]): QueueDisplayState => ({
  serverTime,
  timeZone: "Asia/Tashkent",
  clinicName: "Клиника",
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls,
});

describe("createCallTracker", () => {
  it("stays silent on the first ingest even for fresh calls", () => {
    const tracker = createCallTracker();
    expect(tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:50.000Z")]))).toEqual([]);
  });

  it("announces a new key once and never repeats it on later ingests", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:00.000Z")]));
    const fresh = call("11:1", "2026-09-30T06:00:01.000Z", "К-06");
    const next = state("2026-09-30T06:00:02.000Z", [fresh, call("10:1", "2026-09-30T05:59:00.000Z")]);
    expect(tracker.ingest(next)).toEqual([fresh]);
    expect(tracker.ingest(next)).toEqual([]);
    expect(tracker.ingest(state("2026-09-30T06:00:04.000Z", [fresh]))).toEqual([]);
  });

  it("announces a re-call of the same patient (callCount grew, so the key is new)", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:00.000Z")]));
    const again = call("10:2", "2026-09-30T06:00:30.000Z");
    expect(tracker.ingest(state("2026-09-30T06:00:31.000Z", [again, call("10:1", "2026-09-30T05:59:00.000Z")]))).toEqual([again]);
  });

  it("ignores calls older than two minutes by the server clock but still remembers them", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const stale = call("12:1", "2026-09-30T05:57:59.000Z");
    const edge = call("13:1", "2026-09-30T05:58:00.000Z");
    expect(tracker.ingest(state("2026-09-30T06:00:00.000Z", [edge, stale]))).toEqual([edge]);
    expect(tracker.ingest(state("2026-09-30T06:00:02.000Z", [edge, stale]))).toEqual([]);
  });

  it("returns several new calls oldest first", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const first = call("20:1", "2026-09-30T06:00:01.000Z", "А-01");
    const second = call("21:1", "2026-09-30T06:00:03.000Z", "Б-01");
    const third = call("22:1", "2026-09-30T06:00:05.000Z", "В-01");
    expect(tracker.ingest(state("2026-09-30T06:00:06.000Z", [third, second, first]))).toEqual([first, second, third]);
  });

  it("accepts a call stamped slightly after serverTime", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const early = call("30:1", "2026-09-30T06:00:00.200Z");
    expect(tracker.ingest(state("2026-09-30T06:00:00.100Z", [early]))).toEqual([early]);
  });

  it("uses the freshness window passed to the factory", () => {
    const tracker = createCallTracker(10_000);
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    expect(tracker.ingest(state("2026-09-30T06:00:20.000Z", [call("40:1", "2026-09-30T06:00:05.000Z")]))).toEqual([]);
  });
});
