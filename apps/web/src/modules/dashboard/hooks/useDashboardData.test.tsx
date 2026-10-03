import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listAppointments: vi.fn(),
  listPayments: vi.fn(),
  listInvoices: vi.fn(),
  listPatients: vi.fn(),
  listDoctors: vi.fn(),
  listServices: vi.fn(),
  activeShift: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../api/dashboardApi", () => ({ dashboardApi: api }));
import { useDashboardData } from "./useDashboardData";

const TODAY = { from: "2026-10-03", to: "2026-10-03" };
let state: ReturnType<typeof useDashboardData>;
let view: ReactTestRenderer;
const Probe = () => {
  state = useDashboardData("superadmin");
  return null;
};
/** Mounts the hook and lets every request of the load, including a follow-up one, settle. */
const load = async () => {
  await act(async () => {
    view = create(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 9, 30));
  for (const call of Object.values(api)) call.mockReset().mockResolvedValue([]);
  api.activeShift.mockResolvedValue(null);
});
afterEach(() => {
  act(() => view.unmount());
  vi.useRealTimers();
});

describe("dashboard appointments", () => {
  it("asks only for today's appointments, not for the clinic's whole history", async () => {
    api.listAppointments.mockResolvedValue([{ id: 1, startAt: "2026-10-03 10:00:00" }]);
    await load();
    expect(api.listAppointments.mock.calls).toEqual([[TODAY]]);
    expect(state.loading).toBe(false);
    expect(state.appointments).toEqual([{ id: 1, startAt: "2026-10-03 10:00:00" }]);
    expect(state.hasAppointments).toBe(true);
  });

  it("asks for one more row when today is empty and nothing was billed: a quiet day is not a new clinic", async () => {
    api.listAppointments.mockImplementation(async (filters: { limit?: number }) => (filters.limit ? [{ id: 9 }] : []));
    await load();
    expect(api.listAppointments.mock.calls).toEqual([[TODAY], [{ limit: 1 }]]);
    expect(state.appointments).toEqual([]);
    expect(state.hasAppointments).toBe(true);
  });

  it("reports no appointments for a clinic that has none at all", async () => {
    await load();
    expect(api.listAppointments.mock.calls).toEqual([[TODAY], [{ limit: 1 }]]);
    expect(state.hasAppointments).toBe(false);
    expect(state.partialError).toBeNull();
  });

  it.each([
    ["an invoice", () => api.listInvoices.mockResolvedValue([{ id: 1 }])],
    ["a payment", () => api.listPayments.mockResolvedValue([{ id: 1, deletedAt: null }])],
  ])("does not ask again when the clinic already has %s", async (_what, arrange) => {
    arrange();
    await load();
    expect(api.listAppointments.mock.calls).toEqual([[TODAY]]);
  });

  it("counts a voided payment as nothing billed", async () => {
    api.listPayments.mockResolvedValue([{ id: 1, deletedAt: "2026-10-01T05:00:00.000Z" }]);
    await load();
    expect(api.listAppointments.mock.calls).toEqual([[TODAY], [{ limit: 1 }]]);
  });

  it("reports a partial failure when the extra row cannot be read", async () => {
    api.listAppointments.mockImplementation(async (filters: { limit?: number }) => {
      if (filters.limit) throw new Error("network");
      return [];
    });
    await load();
    expect(state.partialError).toBe("dashboard.partialLoadError");
    expect(state.hasAppointments).toBe(false);
  });
});
