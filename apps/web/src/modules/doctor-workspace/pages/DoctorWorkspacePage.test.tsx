import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), complete: vi.fn(), navigate: vi.fn(), user: null as null | { role: string; doctorId: number } }));
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ appointmentId: "10" }), useNavigate: () => mocks.navigate }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
vi.mock("../../../hooks/useClinic", () => ({ useClinic: () => ({ clinic: { logoUrl: "", primaryColor: "#059669" } }) }));
// The real api/http needs VITE_API_URL and initialises i18next; the page only needs its error class.
vi.mock("../../../api/http", () => ({ HttpError: class HttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
} }));
vi.mock("../components/UziProtocolPanel", () => ({ UziProtocolPanel: () => null }));
vi.mock("../../questionnaires/components/PatientQuestionnairesPanel", () => ({ PatientQuestionnairesPanel: () => null }));
vi.mock("../../appointments/components/AppointmentServicesModal", () => ({ AppointmentServicesModal: () => <div id="services-modal" /> }));
vi.mock("../../billing/api/cashDeskApi", () => ({ cashDeskApi: { getClinicMeta: async () => ({ clinicName: "Test clinic" }) } }));
vi.mock("../../appointments/api/appointmentsFlowApi", () => ({ appointmentsFlowApi: {
  getAppointment: mocks.get,
  listPatients: async () => [{ id: 1, fullName: "Test patient" }],
  updateAppointment: mocks.update, completeAppointment: mocks.complete,
} }));
import { HttpError } from "../../../api/http";
import { DoctorWorkspacePage } from "./DoctorWorkspacePage";

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.get.mockResolvedValue({
    id: 10, patientId: 1, doctorId: 2, serviceId: 3, status: "in_consultation", billingStatus: "draft",
    diagnosis: "Diagnosis", treatment: "Treatment", notes: "", startAt: "2099-08-27 10:00:00", recommendedReturnDate: "2099-09-10",
    services: [{ serviceId: 3, name: "Visit", price: 100 }, { serviceId: 4, name: "Ultrasound", price: 200 }],
  });
  mocks.update.mockImplementation(async (_token, id, body) => ({ id, ...body }));
  mocks.complete.mockResolvedValue({ id: 10 });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals(); });
const button = (key: string) => view.root.findAllByType("button").find(b => b.props.children === key);
const paragraphs = () => view.root.findAllByType("p").map(p => p.props.children);

describe("loading the visit", () => {
  it("asks for the one appointment by its id, not for the clinic's whole list", async () => {
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    expect(mocks.get.mock.calls).toEqual([["isolated-test", 10]]);
    expect(view.root.findByType("h1").props.children).toBe("Test patient");
  });
  it("says the appointment was not found when the API has none with this id", async () => {
    mocks.get.mockRejectedValue(new HttpError("Appointment not found", 404));
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    expect(paragraphs()).toContain("doctorWorkspace.errors.appointmentNotFound");
    expect(view.root.findByProps({ id: "recommended-return-date" }).props.disabled).toBe(true);
  });
  it("shows the server's own message for any other failure", async () => {
    mocks.get.mockRejectedValue(new HttpError("Сервер недоступен", 500));
    await act(async () => { view = create(<DoctorWorkspacePage />); });
    expect(paragraphs()).toContain("Сервер недоступен");
  });
});

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
