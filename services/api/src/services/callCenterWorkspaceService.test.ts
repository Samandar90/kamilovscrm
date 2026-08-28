import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env", () => ({ env: { isProduction: false } }));
import { CallCenterWorkspaceService, parseWorkspaceSettings, nextRetryAt } from "./callCenterWorkspaceService";
import { DEFAULT_WORKSPACE_SETTINGS } from "../repositories/interfaces/callCenterWorkspaceTypes";
import type { ICallCenterWorkspaceRepository } from "../repositories/interfaces/ICallCenterWorkspaceRepository";

const operator = { userId: 1, clinicId: 1, username: "operator", role: "operator" as const };
const service = new CallCenterWorkspaceService({} as ICallCenterWorkspaceRepository);

describe("call center workspace validation", () => {
  it("rejects settings changes and previews from an operator", async () => {
    await expect(service.saveSettings(operator, DEFAULT_WORKSPACE_SETTINGS)).rejects.toMatchObject({ status: 403 });
    await expect(service.preview(operator, DEFAULT_WORKSPACE_SETTINGS)).rejects.toMatchObject({ status: 403 });
    await expect(service.assign(operator, { taskId: 1, operatorId: 1 })).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    { recallDays: 0 }, { followupDays: 1.5 }, { reminderDays: 366 }, { maxAttempts: 0 },
    { retryMinutes: 0 }, { recallEnabled: "true" }, { workStart: "19:00" }, { workEnd: "25:00" },
    { script: "x".repeat(5001) },
    { followupMaxDays: 2 }, { followupMaxDays: 366 }, { returnLeadDays: -1 }, { maxCallsPerDay: 0 }, { minContactIntervalMinutes: -1 },
  ])("rejects invalid configuration %j", (patch) => {
    expect(() => parseWorkspaceSettings({ ...DEFAULT_WORKSPACE_SETTINGS, ...patch })).toThrow();
  });
  it("requires explicit callback instants and rejects unknown outcomes", async () => {
    const body = { taskId: 1, outcome: "callback", requestId: "request-1" };
    await expect(service.attempt(operator, body)).rejects.toMatchObject({ status: 400 });
    await expect(service.attempt(operator, { ...body, outcome: "cancelled" })).rejects.toMatchObject({ status: 400 });
    await expect(service.attempt(operator, { ...body, callbackAt: "2099-01-01T10:00:00" })).rejects.toMatchObject({ status: 400 });
  });
  it("rolls retries after work end to next work start in clinic timezone", () => {
    expect(nextRetryAt(new Date("2026-08-27T12:30:00Z"), DEFAULT_WORKSPACE_SETTINGS, "Asia/Tashkent")).toBe("2026-08-28T04:00:00.000Z");
    expect(nextRetryAt(new Date("2026-08-27T03:00:00Z"), DEFAULT_WORKSPACE_SETTINGS, "Asia/Tashkent")).toBe("2026-08-27T05:00:00.000Z");
  });
});
