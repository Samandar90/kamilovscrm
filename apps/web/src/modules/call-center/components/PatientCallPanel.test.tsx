import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientCallPanel } from "./PatientCallPanel";
import { HttpError } from "../../../api/http";
import { workspaceApi, type WorkspacePatient, type WorkspaceSettings } from "../api/workspaceApi";
import { CallCenterPage } from "../pages/CallCenterPage";

const { translate } = vi.hoisted(() => ({ translate: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate, i18n: { language: "ru" } }) }));
vi.mock("../../../i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("../api/workspaceApi", () => ({ workspaceApi: { claim: vi.fn(), release: vi.fn(), attempt: vi.fn(), assign: vi.fn(), history: vi.fn(), savePreferences: vi.fn(), list: vi.fn() } }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "superadmin" } }) }));

const patient: WorkspacePatient = {
  patientId: 1, patientName: "Test Patient", phone: "+998901234567", lastVisitAt: null, lastDoctorName: null,
  lastDoctorId: null, nextAppointmentId: null, nextVisitAt: null, nextDoctorName: null, visitsCount: 0,
  taskId: null, episodeKey: "patient:1", campaign: "base", dueAt: null, status: "new", attempts: 0,
  assignedTo: null, assignedToName: null, claimedBy: null, claimedByName: null, claimExpiresAt: null, lastOutcome: null, lastContactAt: null,
  contactPreferences: { doNotCall: false, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null },
  recommendedReturnDate: null, reason: "base", contactBlockReason: null,
};
const settings: WorkspaceSettings = { recallEnabled: true, recallDays: 90, followupEnabled: true, followupDays: 3, followupMaxDays: 14, returnLeadDays: 7, maxCallsPerDay: 3, minContactIntervalMinutes: 120, reminderEnabled: true, reminderDays: 1, workStart: "09:00", workEnd: "18:00", retryMinutes: 120, maxAttempts: 3, script: "Hello {patient}" };
let view: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => false) });
  vi.mocked(workspaceApi.claim).mockResolvedValue({ taskId: 10 });
  vi.mocked(workspaceApi.release).mockResolvedValue({ success: true });
  vi.mocked(workspaceApi.history).mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function render(onSaved = () => {}, overrides: Partial<React.ComponentProps<typeof PatientCallPanel>> = {}) {
  await act(async () => { view = create(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PatientCallPanel patient={patient} settings={settings} operators={[]} userId={1} isAdmin onClose={() => {}} onSaved={onSaved} onDirty={() => {}} {...overrides} /></MemoryRouter>); });
}
const button = (label: string) => view.root.findAllByType("button").find((item) => item.children.includes(`callWorkspace.${label}`))!;
const start = () => button("startCall") || button("renewLease");
const callForm = () => view.root.findByProps({ className: "cc-call-form" });
describe("patient call session recovery", () => {
  it("allows renewing a rejected lease and retains the operator note", async () => {
    await render();
    await act(async () => { await start().props.onClick(); });
    act(() => view.root.findByType("textarea").props.onChange({ target: { value: "Keep this note" } }));
    vi.mocked(workspaceApi.attempt).mockRejectedValueOnce(new HttpError("Lease expired", 409));
    await act(async () => { await callForm().props.onSubmit({ preventDefault() {} }); });
    expect(view.root.findAllByProps({ className: "cc-call-form" })).toHaveLength(0);
    await act(async () => { await start().props.onClick(); });
    expect(view.root.findByType("textarea").props.value).toBe("Keep this note");
    expect(callForm().findByType("fieldset").props.disabled).toBe(false);
  });
  it("does not navigate the newer selection when an unmounted save completes", async () => {
    let finish!: (value: any) => void;
    let saved = 0;
    vi.mocked(workspaceApi.attempt).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(() => { saved++; });
    await act(async () => { await start().props.onClick(); });
    act(() => { callForm().props.onSubmit({ preventDefault() {} }); });
    act(() => view.unmount());
    await act(async () => finish({ id: 1 }));
    expect(saved).toBe(0);
  });
  it.each(["do_not_call", "no_phone", "outside_hours", "daily_limit", "cooldown", "callback_scheduled"] as const)("shows and enforces server call block %s", async (contactBlockReason) => {
    await render(undefined, { patient: { ...patient, contactBlockReason } });
    expect(start().props.disabled).toBe(true);
    expect(JSON.stringify(view.toJSON())).toContain(`callWorkspace.contactBlocks.${contactBlockReason}`);
    expect(view.root.findAllByType("a").filter((link) => link.props.href?.startsWith("tel:"))).toHaveLength(0);
  });
  it("saves complete preferences, retains the note and blocks dialing when do-not-call is enabled", async () => {
    const onDirty = vi.fn();
    await render(undefined, { onDirty });
    await act(async () => { await start().props.onClick(); });
    act(() => view.root.findByType("textarea").props.onChange({ target: { value: "Keep this note" } }));
    const field = (label: string) => view.root.findByProps({ "aria-label": `callWorkspace.${label}` });
    act(() => {
      field("doNotCall").props.onChange({ target: { checked: true } });
      field("preferredLanguage").props.onChange({ target: { value: "uz" } });
      field("preferredCallStart").props.onChange({ target: { value: "10:00" } });
      field("preferredCallEnd").props.onChange({ target: { value: "12:00" } });
    });
    const preferences = { doNotCall: true, preferredLanguage: "uz", preferredCallStart: "10:00", preferredCallEnd: "12:00" } as const;
    vi.mocked(workspaceApi.savePreferences).mockResolvedValue(preferences);
    await act(async () => { button("savePreferences").props.onClick(); });
    expect(workspaceApi.savePreferences).toHaveBeenCalledWith(1, preferences);
    expect(view.root.findByType("textarea").props.value).toBe("Keep this note");
    expect(onDirty).toHaveBeenLastCalledWith(true);
    expect(view.root.findAllByType("a").filter((link) => link.props.href?.startsWith("tel:"))).toHaveLength(0);
  });
  it("rejects an incomplete or reversed preferred call window before saving", async () => {
    await render();
    const field = (label: string) => view.root.findByProps({ "aria-label": `callWorkspace.${label}` });
    act(() => field("preferredCallStart").props.onChange({ target: { value: "14:00" } }));
    await act(async () => { button("savePreferences").props.onClick(); });
    expect(workspaceApi.savePreferences).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain("callWorkspace.invalidPreferredHours");
    act(() => field("preferredCallEnd").props.onChange({ target: { value: "12:00" } }));
    await act(async () => { button("savePreferences").props.onClick(); });
    expect(workspaceApi.savePreferences).not.toHaveBeenCalled();
  });
  it("retries an ambiguous result unchanged and prevents Next until resolved", async () => {
    await render(undefined, { onNext: vi.fn(), hasNext: true });
    await act(async () => { await start().props.onClick(); });
    vi.mocked(workspaceApi.attempt).mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => { callForm().props.onSubmit({ preventDefault() {} }); });
    expect(button("nextPatient").props.disabled).toBe(true);
    vi.mocked(workspaceApi.attempt).mockResolvedValue({ id: 1 } as any);
    await act(async () => { callForm().props.onSubmit({ preventDefault() {} }); });
    expect(workspaceApi.attempt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(workspaceApi.attempt).mock.calls[1][0]).toEqual(vi.mocked(workspaceApi.attempt).mock.calls[0][0]);
  });
  it("does not save-and-advance past unsaved preferences", async () => {
    await render();
    await act(async () => { await start().props.onClick(); });
    act(() => view.root.findByProps({ "aria-label": "callWorkspace.preferredLanguage" }).props.onChange({ target: { value: "uz" } }));
    expect(button("saveNext").props.disabled).toBe(true);
    await act(async () => callForm().props.onSubmit({ preventDefault() {} }));
    expect(workspaceApi.attempt).not.toHaveBeenCalled();
  });
  it("releases a late acquired claim after the patient panel unmounts", async () => {
    let finish!: (value: { taskId: number }) => void;
    vi.mocked(workspaceApi.claim).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    act(() => start().props.onClick());
    act(() => view.unmount());
    await act(async () => finish({ taskId: 91 }));
    expect(workspaceApi.release).toHaveBeenCalledWith(1, 91);
  });
  it("ignores preference-save callbacks for an unmounted patient", async () => {
    let finish!: (value: WorkspacePatient["contactPreferences"]) => void;
    const onPreferencesSaved = vi.fn();
    vi.mocked(workspaceApi.savePreferences).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(undefined, { onPreferencesSaved });
    act(() => view.root.findByProps({ "aria-label": "callWorkspace.doNotCall" }).props.onChange({ target: { checked: true } }));
    act(() => button("savePreferences").props.onClick());
    act(() => view.unmount());
    await act(async () => finish({ ...patient.contactPreferences, doNotCall: true }));
    expect(onPreferencesSaved).not.toHaveBeenCalled();
  });
});

describe("daily workspace navigation", () => {
  const second = { ...patient, patientId: 2, patientName: "Second Patient", episodeKey: "patient:2", reason: "reminder" as const };
  const response = { items: [patient, second], total: 2, page: 1, pageSize: 30, counts: { today: 2, archive: 0, base: 2, recall: 0, followup: 0, reminder: 1, callbacks: 0 }, dailyProgress: { completed: 4, pending: 2 }, doctors: [], operators: [], settings };
  async function renderPage() {
    vi.mocked(workspaceApi.list).mockResolvedValue(response);
    await act(async () => { view = create(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CallCenterPage /></MemoryRouter>); });
  }
  it("opens today with clinic-wide daily counts and server reasons", async () => {
    await renderPage();
    expect(workspaceApi.list).toHaveBeenCalledWith(expect.objectContaining({ segment: "today" }), expect.any(AbortSignal));
    expect(JSON.stringify(view.toJSON())).toContain("callWorkspace.dailyClinicScope");
    expect(view.root.findByProps({ "data-testid": "daily-completed" }).children).toContain("4");
    expect(view.root.findByProps({ "data-testid": "daily-pending" }).children).toContain("2");
    expect(JSON.stringify(view.toJSON())).toContain("callWorkspace.reasons.reminder");
    expect(JSON.stringify(view.toJSON())).toContain("callWorkspace.segments.archive");
  });
  it("Next keeps drafts when declined and releases the old claim when confirmed without auto-calling", async () => {
    await renderPage();
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[0].props.onClick({ stopPropagation() {} }));
    await act(async () => { await start().props.onClick(); });
    act(() => view.root.findByType("textarea").props.onChange({ target: { value: "Unsaved note" } }));
    act(() => button("nextPatient").props.onClick());
    expect(view.root.findByType("textarea").props.value).toBe("Unsaved note");
    expect(workspaceApi.release).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { button("nextPatient").props.onClick(); });
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Second Patient"]);
    expect(workspaceApi.release).toHaveBeenCalledWith(1, 10);
    expect(workspaceApi.claim).toHaveBeenCalledTimes(1);
  });
  it("cannot switch selection while a save is pending", async () => {
    await renderPage();
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[0].props.onClick({ stopPropagation() {} }));
    await act(async () => { await start().props.onClick(); });
    let finish!: (value: any) => void;
    vi.mocked(workspaceApi.attempt).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    act(() => callForm().props.onSubmit({ preventDefault() {} }));
    expect(button("nextPatient").props.disabled).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[1].props.onClick({ stopPropagation() {} }));
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Test Patient"]);
    await act(async () => finish({ id: 1 }));
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Second Patient"]);
  });
  it("Next loads the following page and opens its first patient without claiming", async () => {
    await renderPage();
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({ ...response, items: [patient], pageSize: 1 });
    await act(async () => view.root.findByProps({ "aria-label": "callWorkspace.refresh" }).props.onClick());
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[0].props.onClick({ stopPropagation() {} }));
    expect(button("nextPatient").props.disabled).toBe(false);
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({ ...response, items: [second], page: 2, pageSize: 1 });
    await act(async () => button("nextPatient").props.onClick());
    expect(workspaceApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Second Patient"]);
    expect(workspaceApi.claim).not.toHaveBeenCalled();
  });
  it("save selects a fresh server row, not a removed next patient from stale data", async () => {
    await renderPage();
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[0].props.onClick({ stopPropagation() {} }));
    await act(async () => { await start().props.onClick(); });
    vi.mocked(workspaceApi.attempt).mockResolvedValue({ id: 1 } as any);
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({ ...response, items: [{ ...second, patientId: 3, patientName: "Third Patient", episodeKey: "patient:3" }] });
    await act(async () => callForm().props.onSubmit({ preventDefault() {} }));
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Third Patient"]);
  });
  it("ignores an older response after switching from today to archive", async () => {
    await renderPage();
    let finish!: (value: typeof response) => void;
    vi.mocked(workspaceApi.list).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => view.root.findByProps({ "aria-label": "callWorkspace.refresh" }).props.onClick());
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({ ...response, items: [second] });
    await act(async () => view.root.findAllByType("button").find((item) => item.findAllByType("span").some((span) => span.children.includes("callWorkspace.segments.archive")))!.props.onClick());
    await act(async () => finish(response));
    expect(view.root.findAllByProps({ className: "cc-patient-name" }).map((item) => item.children)).toEqual([["Second Patient"]]);
    expect(workspaceApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ segment: "archive" }), expect.any(AbortSignal));
  });
  it("Next protects unsaved contact preferences and blocks navigation while saving them", async () => {
    await renderPage();
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[0].props.onClick({ stopPropagation() {} }));
    act(() => view.root.findByProps({ "aria-label": "callWorkspace.preferredLanguage" }).props.onChange({ target: { value: "uz" } }));
    act(() => button("nextPatient").props.onClick());
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Test Patient"]);
    expect(view.root.findByProps({ "aria-label": "callWorkspace.preferredLanguage" }).props.value).toBe("uz");
    let finish!: (value: WorkspacePatient["contactPreferences"]) => void;
    vi.mocked(workspaceApi.savePreferences).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    act(() => button("savePreferences").props.onClick());
    expect(button("nextPatient").props.disabled).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => view.root.findAllByProps({ className: "cc-patient-name" })[1].props.onClick({ stopPropagation() {} }));
    expect(view.root.findByProps({ className: "cc-patient-identity" }).findByType("h2").children).toEqual(["Test Patient"]);
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({ ...response, items: [{ ...patient, contactPreferences: { ...patient.contactPreferences, preferredLanguage: "uz" } }, second] });
    await act(async () => finish({ ...patient.contactPreferences, preferredLanguage: "uz" }));
    expect(view.root.findByProps({ "aria-label": "callWorkspace.preferredLanguage" }).props.value).toBe("uz");
    expect(button("nextPatient").props.disabled).toBe(false);
  });
});
