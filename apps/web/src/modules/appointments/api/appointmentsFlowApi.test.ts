import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn(async () => []) }));
vi.mock("../../../api/http", () => ({ requestJson }));

import { appointmentsFlowApi, appointmentsListPath } from "./appointmentsFlowApi";

beforeEach(() => requestJson.mockClear());

const queryOf = (path: string) => Object.fromEntries(new URL(path, "http://api.test").searchParams);

describe("appointments list request", () => {
  it("asks for whole days: from the first second of `from` to the last second of `to`", () => {
    const path = appointmentsListPath({ from: "2026-10-03", to: "2026-10-10" });
    expect(path.startsWith("/api/appointments?")).toBe(true);
    expect(queryOf(path)).toEqual({ startFrom: "2026-10-03 00:00:00", startTo: "2026-10-10 23:59:59" });
  });

  it("adds the doctor, the row limit and the billing status only when they are given", () => {
    expect(queryOf(appointmentsListPath({ from: "2026-10-05", to: "2026-10-05", doctorId: 4 }))).toEqual({
      startFrom: "2026-10-05 00:00:00",
      startTo: "2026-10-05 23:59:59",
      doctorId: "4",
    });
    expect(queryOf(appointmentsListPath({ limit: 1 }))).toEqual({ limit: "1" });
    expect(queryOf(appointmentsListPath({ billingStatus: "ready_for_payment" }))).toEqual({ billing_status: "ready_for_payment" });
  });

  it("keeps the plain address when nothing is filtered", () => {
    expect(appointmentsListPath()).toBe("/api/appointments");
    expect(appointmentsListPath({})).toBe("/api/appointments");
  });

  it("sends the filters with the caller's token", async () => {
    await appointmentsFlowApi.listAppointments("token", { from: "2026-10-03", to: "2026-10-03" });
    expect(requestJson.mock.calls).toEqual([
      [appointmentsListPath({ from: "2026-10-03", to: "2026-10-03" }), { token: "token" }],
    ]);
  });
});

describe("single appointment request", () => {
  it("reads one appointment by its id", async () => {
    await appointmentsFlowApi.getAppointment("token", 10);
    expect(requestJson.mock.calls).toEqual([["/api/appointments/10", { token: "token" }]]);
  });
});
