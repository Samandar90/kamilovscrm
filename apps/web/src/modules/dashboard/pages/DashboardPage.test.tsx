import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: { role: "superadmin" } }) }));
// The real api/http needs VITE_API_URL and initialises i18next; nothing here may reach the network.
vi.mock("../../../api/http", () => ({ requestJson: vi.fn(async () => []) }));
vi.mock("../api/dashboardApi", () => ({ dashboardApi: {} }));
vi.mock("../hooks/useDashboardData", () => ({ useDashboardData: () => data.current }));
vi.mock("../../appointments/features/quick-create/AppointmentQuickCreateModal", () => ({ AppointmentQuickCreateModal: () => null }));
vi.mock("../components/DashboardCard", () => ({ DashboardCard: () => null }));
vi.mock("../components/DashboardEmptyState", () => ({ DashboardEmptyState: () => null }));
vi.mock("../components/DashboardQuickActions", () => ({ DashboardQuickActions: () => null }));
vi.mock("../components/DashboardMorningBriefingSection", () => ({ DashboardMorningBriefingSection: () => null }));
vi.mock("../components/DashboardTodaySummary", () => ({
  DashboardTodaySummary: ({ appointmentsCount, completionRate }: { appointmentsCount: number; completionRate: number }) => (
    <div id="today-summary" data-appointments={appointmentsCount} data-completion={completionRate} />
  ),
}));
vi.mock("../components/DashboardSetupBanner", () => ({
  DashboardSetupBanner: ({ steps }: { steps: Array<{ done?: boolean }> }) => (
    <div id="setup-banner" data-done={steps.map((step) => Boolean(step.done)).join(",")} />
  ),
}));
import { DashboardPage } from "./DashboardPage";

const loaded = (overrides: Record<string, unknown>) => ({
  loading: false,
  partialError: null,
  appointments: [],
  hasAppointments: false,
  payments: [],
  invoices: [],
  patients: [],
  doctors: [],
  services: [],
  activeShift: null,
  reload: vi.fn(),
  ...overrides,
});
let view: ReactTestRenderer;
const open = async (state: Record<string, unknown>) => {
  data.current = state;
  await act(async () => {
    view = create(<DashboardPage />);
  });
};
const banners = () => view.root.findAllByProps({ id: "setup-banner" }).map((node) => node.props["data-done"]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 9, 30));
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dashboard setup banner", () => {
  it("guides a clinic that has no appointments, invoices or payments yet", async () => {
    await open(loaded({ patients: [{ id: 1, fullName: "Пациент" }] }));
    expect(banners()).toEqual(["true,false,false"]);
  });

  it("does not come back on a day without appointments when the clinic has appointments on other days", async () => {
    await open(loaded({ appointments: [], hasAppointments: true }));
    expect(banners()).toEqual([]);
  });

  it("stays hidden once the clinic has an invoice or an active payment", async () => {
    await open(loaded({ invoices: [{ id: 1, status: "issued", total: 100, paidAmount: 0 }] }));
    expect(banners()).toEqual([]);
    act(() => view.unmount());
    await open(loaded({ payments: [{ id: 1, amount: 100, method: "cash", createdAt: "2026-10-01T05:00:00.000Z", deletedAt: null }] }));
    expect(banners()).toEqual([]);
  });
});

describe("dashboard today statistics", () => {
  it("counts the loaded appointments of today and their completion", async () => {
    const visit = (id: number, status: string) => ({ id, patientId: 1, doctorId: 2, serviceId: 3, status, startAt: "2026-10-03 10:00:00" });
    await open(loaded({ hasAppointments: true, appointments: [visit(1, "completed"), visit(2, "scheduled"), visit(3, "arrived"), visit(4, "completed")] }));
    expect(view.root.findByProps({ id: "today-summary" }).props).toMatchObject({ "data-appointments": 4, "data-completion": 50 });
  });
});
