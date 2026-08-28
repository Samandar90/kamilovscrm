import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";
import { workspaceApi, type WorkspaceSettings } from "../api/workspaceApi";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../api/workspaceApi", () => ({ workspaceApi: { saveSettings: vi.fn(), preview: vi.fn() } }));
const settings: WorkspaceSettings = { recallEnabled: true, recallDays: 90, followupEnabled: true, followupDays: 3, followupMaxDays: 14, returnLeadDays: 7, maxCallsPerDay: 3, minContactIntervalMinutes: 120, reminderEnabled: true, reminderDays: 1, workStart: "09:00", workEnd: "18:00", retryMinutes: 120, maxAttempts: 3, script: "Hello {patient}" };
let view: ReactTestRenderer;
afterEach(() => { if (view) act(() => view.unmount()); vi.resetAllMocks(); });
const field = (key: string) => view.root.findAllByType("label").find((label) => label.findAllByType("span").some((span) => span.children.includes(`callWorkspace.${key}`)))!.findByType("input");
const render = () => act(() => { view = create(<WorkspaceSettingsPanel settings={settings} onSaved={() => {}} onDirty={() => {}} />); });
describe("daily workflow settings", () => {
  it("saves bounded followups, recommendation lead time and clinic-wide contact limits", async () => {
    render();
    expect(field("followupMaxDays").props.min).toBe(3);
    act(() => {
      field("followupMaxDays").props.onChange({ target: { value: "10" } });
      field("returnLeadDays").props.onChange({ target: { value: "5" } });
      field("maxCallsPerDay").props.onChange({ target: { value: "2" } });
      field("minContactIntervalMinutes").props.onChange({ target: { value: "180" } });
    });
    vi.mocked(workspaceApi.saveSettings).mockImplementation(async (value) => value);
    await act(async () => view.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(workspaceApi.saveSettings).toHaveBeenCalledWith({ ...settings, followupMaxDays: 10, returnLeadDays: 5, maxCallsPerDay: 2, minContactIntervalMinutes: 180 });
  });
  it("rejects an upper followup age below the lower age for both save and preview", async () => {
    render();
    act(() => field("followupMaxDays").props.onChange({ target: { value: "2" } }));
    await act(async () => view.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    await act(async () => view.root.findAllByType("button").find((button) => button.children.includes("callWorkspace.preview"))!.props.onClick());
    expect(workspaceApi.saveSettings).not.toHaveBeenCalled();
    expect(workspaceApi.preview).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain("callWorkspace.invalidFollowupRange");
  });
});
