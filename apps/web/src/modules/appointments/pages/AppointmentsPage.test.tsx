import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment } from "../api/appointmentsFlowApi";

const api = vi.hoisted(() => ({
  listAppointments: vi.fn(),
  listPatients: vi.fn(),
  listDoctors: vi.fn(),
  listServices: vi.fn(),
  listInvoices: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: { role: "reception" } }) }));
// The real api/http needs VITE_API_URL and initialises i18next; nothing here may reach the network.
vi.mock("../../../api/http", () => ({ requestJson: vi.fn() }));
vi.mock("../api/appointmentsFlowApi", () => ({ appointmentsFlowApi: api }));
vi.mock("../hooks/useDebouncedAppointmentSlotAvailability", () => ({ useDebouncedAppointmentSlotAvailability: () => "idle" }));
vi.mock("../components/AppointmentCard", () => ({
  AppointmentCard: ({ appointment }: { appointment: Appointment }) => <li id={`card-${appointment.id}`} />,
}));
vi.mock("../components/AppointmentActionPanel", () => ({
  AppointmentActionPanel: ({ filterSummary, isLoading }: { filterSummary: { total: number }; isLoading: boolean }) => (
    <aside id="summary" data-total={filterSummary.total} data-loading={isLoading} />
  ),
}));
vi.mock("../components/AppointmentMobileCard", () => ({ AppointmentMobileCard: () => null }));
vi.mock("../components/AppointmentCreateModal", () => ({ AppointmentCreateModal: () => null }));
vi.mock("../components/AppointmentServicesModal", () => ({ AppointmentServicesModal: () => null }));
vi.mock("../components/CreatePatientModal", () => ({ CreatePatientModal: () => null }));
vi.mock("../features/quick-create/AppointmentQuickCreateModal", () => ({ AppointmentQuickCreateModal: () => null }));
vi.mock("../../../shared/ui", () => ({
  AppContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EmptyState: ({ title, action }: { title: string; action?: React.ReactNode }) => <div id="empty" data-title={title}>{action}</div>,
  PageLoader: () => <div id="loader" />,
  PageHeader: () => null,
  MoneyInput: () => null,
  StatusBadge: () => null,
}));
import { AppointmentsPage } from "./AppointmentsPage";

const visit = (id: number, startAt: string) =>
  ({ id, patientId: 1, doctorId: 2, serviceId: 3, price: null, status: "scheduled", billingStatus: "draft", startAt, endAt: startAt }) as Appointment;
const WEEK = { from: "2026-10-03", to: "2026-10-10" };
const FAR_DAY = { from: "2026-10-20", to: "2026-10-20" };
const weekRows = [visit(1, "2026-10-03 10:00:00"), visit(2, "2026-10-04 11:00:00"), visit(3, "2026-10-09 09:00:00")];
const farRows = [visit(9, "2026-10-20 12:00:00")];

let view: ReactTestRenderer;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const open = async () => {
  await act(async () => {
    view = create(<AppointmentsPage />);
    await settle();
  });
};
const press = async (label: string) => {
  const button = view.root.findAllByType("button").find((item) => item.props.children === label);
  await act(async () => {
    button!.props.onClick();
    await settle();
  });
};
const pickDate = async (value: string) => {
  await act(async () => {
    view.root.findByProps({ type: "date" }).props.onChange({ target: { value } });
    await settle();
  });
};
const cards = () =>
  view.root.findAll((node) => node.type === "li" && String(node.props.id).startsWith("card-")).map((node) => Number(node.props.id.slice(5)));
const emptyTitles = () => view.root.findAllByProps({ id: "empty" }).map((node) => node.props["data-title"]);
const loaders = () => view.root.findAllByProps({ id: "loader" }).length;
const summary = () => view.root.findByProps({ id: "summary" }).props;
const requestedRanges = () => api.listAppointments.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 9, 30));
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  for (const call of Object.values(api)) call.mockReset().mockResolvedValue([]);
  api.listAppointments.mockImplementation(async (_token: string, range: { from: string }) =>
    range.from === FAR_DAY.from ? farRows : weekRows
  );
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("appointments page periods", () => {
  it("loads today and the next 7 days once and switches Today, Tomorrow and Week without a request", async () => {
    await open();
    expect(requestedRanges()).toEqual([WEEK]);
    expect(cards()).toEqual([1]);
    await press("appointments.tomorrow");
    expect(cards()).toEqual([2]);
    await press("appointments.week");
    expect(cards()).toEqual([1, 2, 3]);
    await press("appointments.today");
    expect(cards()).toEqual([1]);
    expect(requestedRanges()).toEqual([WEEK]);
  });

  it("asks for a calendar day outside the week on its own, without reloading the other lists", async () => {
    await open();
    await pickDate(FAR_DAY.from);
    expect(requestedRanges()).toEqual([WEEK, FAR_DAY]);
    expect(cards()).toEqual([9]);
    expect(summary()).toMatchObject({ "data-total": 1, "data-loading": false });
    for (const call of [api.listPatients, api.listDoctors, api.listServices]) expect(call).toHaveBeenCalledTimes(1);
    await press("appointments.today");
    expect(requestedRanges()).toEqual([WEEK, FAR_DAY, WEEK]);
    expect(cards()).toEqual([1]);
  });

  it("shows the loader, not an empty day, while another period is on its way", async () => {
    await open();
    let deliver!: (rows: Appointment[]) => void;
    api.listAppointments.mockImplementationOnce(() => new Promise<Appointment[]>((resolve) => { deliver = resolve; }));
    await pickDate(FAR_DAY.from);
    expect(loaders()).toBe(1);
    expect(emptyTitles()).toEqual([]);
    expect(summary()["data-loading"]).toBe(true);
    await act(async () => {
      deliver(farRows);
      await settle();
    });
    expect(loaders()).toBe(0);
    expect(cards()).toEqual([9]);
  });

  it("says that a period failed to load and offers a retry instead of showing it as empty", async () => {
    await open();
    api.listAppointments.mockRejectedValueOnce(new Error("network"));
    await pickDate(FAR_DAY.from);
    expect(emptyTitles()).toEqual(["appointments.errors.loadingError"]);
    expect(summary()["data-loading"]).toBe(true);
    await press("errors.tryAgain");
    expect(requestedRanges()).toEqual([WEEK, FAR_DAY, FAR_DAY]);
    expect(emptyTitles()).toEqual([]);
    expect(cards()).toEqual([9]);
  });

  it("tries a failed period again when a period button is pressed", async () => {
    await open();
    await pickDate(FAR_DAY.from);
    api.listAppointments.mockRejectedValueOnce(new Error("network"));
    await press("appointments.today");
    expect(emptyTitles()).toEqual(["appointments.errors.loadingError"]);
    await press("appointments.tomorrow");
    expect(requestedRanges()).toEqual([WEEK, FAR_DAY, WEEK, WEEK]);
    expect(emptyTitles()).toEqual([]);
    expect(cards()).toEqual([2]);
  });
});
