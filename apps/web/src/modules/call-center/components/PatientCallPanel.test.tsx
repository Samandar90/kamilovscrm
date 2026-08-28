import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientCallPanel } from "./PatientCallPanel";
import { HttpError } from "../../../api/http";
import { workspaceApi, type WorkspacePatient, type WorkspaceSettings } from "../api/workspaceApi";

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate, i18n: { language: "ru" } }) }));
vi.mock("../../../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../api/workspaceApi", () => ({ workspaceApi: { claim: vi.fn(), release: vi.fn(), attempt: vi.fn(), assign: vi.fn(), history: vi.fn() } }));

const patient: WorkspacePatient = {
  patientId: 1, patientName: "Test Patient", phone: "+998901234567", lastVisitAt: null, lastDoctorName: null,
  lastDoctorId: null, nextAppointmentId: null, nextVisitAt: null, nextDoctorName: null, visitsCount: 0,
  taskId: null, episodeKey: "patient:1", campaign: "base", dueAt: null, status: "new", attempts: 0,
  assignedTo: null, assignedToName: null, claimedBy: null, claimedByName: null, claimExpiresAt: null, lastOutcome: null, lastContactAt: null,
};
const settings: WorkspaceSettings = { recallEnabled: true, recallDays: 90, followupEnabled: true, followupDays: 3, reminderEnabled: true, reminderDays: 1, workStart: "09:00", workEnd: "18:00", retryMinutes: 120, maxAttempts: 3, script: "Hello {patient}" };
let view: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("window", { setInterval, clearInterval });
  vi.mocked(workspaceApi.claim).mockResolvedValue({ taskId: 10 });
  vi.mocked(workspaceApi.release).mockResolvedValue({ success: true });
  vi.mocked(workspaceApi.history).mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function render(onSaved = () => {}) {
  await act(async () => { view = create(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PatientCallPanel patient={patient} settings={settings} operators={[]} userId={1} isAdmin onClose={() => {}} onSaved={onSaved} onDirty={() => {}} /></MemoryRouter>); });
}
const start = () => view.root.findAllByType("button").find((button) => button.props.className === "cc-btn cc-btn-primary")!;
describe("patient call session recovery", () => {
  it("allows renewing a rejected lease and retains the operator note", async () => {
    await render();
    await act(async () => { await start().props.onClick(); });
    act(() => view.root.findByType("textarea").props.onChange({ target: { value: "Keep this note" } }));
    vi.mocked(workspaceApi.attempt).mockRejectedValueOnce(new HttpError("Lease expired", 409));
    await act(async () => { await view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(view.root.findAllByType("form")).toHaveLength(0);
    await act(async () => { await start().props.onClick(); });
    expect(view.root.findByType("textarea").props.value).toBe("Keep this note");
    expect(view.root.findByType("fieldset").props.disabled).toBe(false);
  });
  it("does not navigate the newer selection when an unmounted save completes", async () => {
    let finish!: (value: any) => void;
    let saved = 0;
    vi.mocked(workspaceApi.attempt).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(() => { saved++; });
    await act(async () => { await start().props.onClick(); });
    act(() => { view.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    act(() => view.unmount());
    await act(async () => finish({ id: 1 }));
    expect(saved).toBe(0);
  });
});
