import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ update: vi.fn(), complete: vi.fn(), navigate: vi.fn(), user: null as null | { role: string; doctorId: number } }));
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ appointmentId: "10" }), useNavigate: () => mocks.navigate }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
vi.mock("../../../hooks/useClinic", () => ({ useClinic: () => ({ clinic: { logoUrl: "", primaryColor: "#059669" } }) }));
vi.mock("../components/UziProtocolPanel", () => ({ UziProtocolPanel: () => null }));
vi.mock("../../questionnaires/components/PatientQuestionnairesPanel", () => ({ PatientQuestionnairesPanel: () => null }));
vi.mock("../../appointments/components/AppointmentServicesModal", () => ({ AppointmentServicesModal: () => <div id="services-modal" /> }));
vi.mock("../../billing/api/cashDeskApi", () => ({ cashDeskApi: { getClinicMeta: async () => ({ clinicName: "Test clinic" }) } }));
vi.mock("../../appointments/api/appointmentsFlowApi", () => ({ appointmentsFlowApi: {
  listAppointments: async () => [{
    id: 10, patientId: 1, doctorId: 2, serviceId: 3, status: "in_consultation", billingStatus: "draft",
    diagnosis: "Diagnosis", treatment: "Treatment", notes: "", startAt: "2099-08-27 10:00:00", recommendedReturnDate: "2099-09-10",
    services: [{ serviceId: 3, name: "Visit", price: 100 }, { serviceId: 4, name: "Ultrasound", price: 200 }],
  }],
  listPatients: async () => [{ id: 1, fullName: "Test patient" }],
  updateAppointment: mocks.update, completeAppointment: mocks.complete,
} }));
import { DoctorWorkspacePage } from "./DoctorWorkspacePage";

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.update.mockImplementation(async (_token, id, body) => ({ id, ...body }));
  mocks.complete.mockResolvedValue({ id: 10 });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals(); });
const button = (key: string) => view.root.findAllByType("button").find(b => b.props.children === key);

describe("doctor recommended return date form", () => {
  it("loads the saved date and sends an explicit null when the doctor clears it", async () => {
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    const field = view.root.findByProps({ id: "recommended-return-date" });
    expect(field.props.value).toBe("2099-09-10");
    act(() => field.props.onChange({ target: { value: "" } }));
    await act(async () => { await button("common.actions.save")!.props.onClick(); });
    expect(mocks.update.mock.calls[0][2].recommendedReturnDate).toBeNull();
  });
  it("includes the selected return date when completing a visit", async () => {
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    act(() => view.root.findByProps({ id: "recommended-return-date" }).props.onChange({ target: { value: "2099-10-01" } }));
    await act(async () => { await button("doctorWorkspace.actions.completeVisit")!.props.onClick(); });
    expect(mocks.complete.mock.calls[0][2]).toMatchObject({ recommendedReturnDate: "2099-10-01", diagnosis: "Diagnosis", treatment: "Treatment" });
  });
});

describe("visit services in the workspace", () => {
  it("lists every service of the visit and lets the visit's doctor change them", async () => {
    mocks.user = { role: "doctor", doctorId: 2 };
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    const items = view.root.findAllByType("li").map(item => item.props.children);
    expect(items).toEqual(["Visit", "Ultrasound"]);
    expect(view.root.findByType("h1").parent!.findAllByType("p")[0].props.children).toBe("Visit, Ultrasound");
    act(() => button("serviceLines.editAction")!.props.onClick());
    expect(view.root.findAllByProps({ id: "services-modal" })).toHaveLength(1);
  });
  it("hides the change action from another doctor", async () => {
    mocks.user = { role: "doctor", doctorId: 99 };
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    expect(button("serviceLines.editAction")).toBeUndefined();
  });
});
