import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), complete: vi.fn(), navigate: vi.fn() }));
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ appointmentId: "10" }), useNavigate: () => mocks.navigate }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test" }) }));
vi.mock("../../../hooks/useClinic", () => ({ useClinic: () => ({ clinic: { logoUrl: "", primaryColor: "#059669" } }) }));
vi.mock("../components/UziProtocolPanel", () => ({ UziProtocolPanel: () => null }));
vi.mock("../../billing/api/cashDeskApi", () => ({ cashDeskApi: { getClinicMeta: async () => ({ clinicName: "Test clinic" }) } }));
vi.mock("../../appointments/api/appointmentsFlowApi", () => ({ appointmentsFlowApi: {
  listAppointments: async () => [{ id: 10, patientId: 1, doctorId: 2, serviceId: 3, diagnosis: "Diagnosis", treatment: "Treatment", notes: "", startAt: "2099-08-27 10:00:00", recommendedReturnDate: "2099-09-10" }],
  listPatients: async () => [{ id: 1, fullName: "Test patient" }],
  listAppointmentAssignedServices: async () => [],
  listServices: async () => [{ id: 3, name: "Visit" }],
  updateAppointment: mocks.update, completeAppointment: mocks.complete,
} }));
import { DoctorWorkspacePage } from "./DoctorWorkspacePage";

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.update.mockImplementation(async (_token, id, body) => ({ id, ...body }));
  mocks.complete.mockResolvedValue({ id: 10 });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals(); });
const button = (key: string) => view.root.findAllByType("button").find(b => b.props.children === key)!;

describe("doctor recommended return date form", () => {
  it("loads the saved date and sends an explicit null when the doctor clears it", async () => {
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    const field = view.root.findByProps({ id: "recommended-return-date" });
    expect(field.props.value).toBe("2099-09-10");
    act(() => field.props.onChange({ target: { value: "" } }));
    await act(async () => { await button("common.actions.save").props.onClick(); });
    expect(mocks.update.mock.calls[0][2].recommendedReturnDate).toBeNull();
  });
  it("includes the selected return date when completing a visit", async () => {
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    act(() => view.root.findByProps({ id: "recommended-return-date" }).props.onChange({ target: { value: "2099-10-01" } }));
    await act(async () => { await button("doctorWorkspace.actions.completeVisit").props.onClick(); });
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ recommendedReturnDate: "2099-10-01", diagnosis: "Diagnosis", treatment: "Treatment" });
  });
});
