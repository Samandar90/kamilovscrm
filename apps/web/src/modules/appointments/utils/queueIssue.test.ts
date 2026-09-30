import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueEntry } from "../../queue/api/queueTypes";
import type { Appointment } from "../api/appointmentsFlowApi";

const mocks = vi.hoisted(() => ({ issue: vi.fn() }));
// The real queueApi would load api/http (VITE_API_URL, i18n); only issue() is used here.
vi.mock("../../queue/api/queueApi", () => ({ queueApi: { issue: mocks.issue } }));
import { issueQueueNumber, withIssuedQueueNumber } from "./queueIssue";

const entry = (code: string | null): QueueEntry => ({
  appointmentId: 7,
  doctorId: 2,
  patientId: 1,
  patientName: "Test patient",
  number: code ? 5 : null,
  code,
  state: "waiting",
  startAt: "2026-09-30 10:00:00",
  issuedAt: code ? "2026-09-30T05:10:00.000Z" : null,
  calledAt: null,
  callCount: 0,
});

const arrived: Appointment = {
  id: 7,
  patientId: 1,
  doctorId: 2,
  serviceId: 3,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status: "arrived",
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
  queueNumber: null,
  queueCode: null,
};

beforeEach(() => {
  mocks.issue.mockReset();
});

describe("issueQueueNumber («Выдать номер»)", () => {
  it("asks the server for today's number and returns the issued code", async () => {
    mocks.issue.mockResolvedValue({ entry: entry("К-05") });
    await expect(issueQueueNumber(7, "fallback")).resolves.toEqual({ ok: true, code: "К-05", entry: entry("К-05") });
    expect(mocks.issue).toHaveBeenCalledWith(7);
  });

  it("passes the server's refusal through (409 «Запись не на сегодня»)", async () => {
    mocks.issue.mockRejectedValue(Object.assign(new Error("Запись не на сегодня"), { status: 409 }));
    await expect(issueQueueNumber(7, "fallback")).resolves.toEqual({ ok: false, message: "Запись не на сегодня" });
  });

  it("falls back to the generic text for an unknown failure or an answer without a code", async () => {
    mocks.issue.mockRejectedValueOnce("boom").mockResolvedValueOnce({ entry: entry(null) });
    await expect(issueQueueNumber(7, "Не удалось выдать номер")).resolves.toEqual({ ok: false, message: "Не удалось выдать номер" });
    await expect(issueQueueNumber(7, "Не удалось выдать номер")).resolves.toEqual({ ok: false, message: "Не удалось выдать номер" });
  });
});

describe("withIssuedQueueNumber", () => {
  it("puts the issued number on the row shown in the list and in the details modal", () => {
    expect(withIssuedQueueNumber(arrived, entry("К-05"))).toEqual({
      ...arrived,
      queueNumber: 5,
      queueCode: "К-05",
      queueIssuedAt: "2026-09-30T05:10:00.000Z",
    });
    expect(arrived.queueCode).toBeNull(); // the input row is not mutated
  });
});
