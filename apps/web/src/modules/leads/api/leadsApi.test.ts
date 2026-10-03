import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn(async () => ({})) }));
vi.mock("../../../api/http", () => ({ requestJson }));

import { leadsApi } from "./leadsApi";
import type { LeadSourceInput, LeadSourcePatch } from "./leadsTypes";

beforeEach(() => requestJson.mockClear());

describe("leads API", () => {
  it("maps every call to its /api/leads endpoint, method and body", async () => {
    const input: LeadSourceInput = { name: "Instagram", marketerUserId: 7, sheetUrl: "https://docs.google.com/spreadsheets/d/test-sheet/edit" };
    const patch: LeadSourcePatch = { columnMap: { phone: "Телефон", name: null }, syncEnabled: true };

    await leadsApi.update(5, { status: "in_progress", expectedStatus: "new" });
    await leadsApi.update(5, { note: null });
    await leadsApi.patientMatches(5);
    await leadsApi.setPatient(5, 31);
    await leadsApi.setPatient(5, null);
    await leadsApi.sources();
    await leadsApi.sourcesManage();
    await leadsApi.createSource(input);
    await leadsApi.updateSource(2, patch);
    await leadsApi.checkSource(2);
    await leadsApi.syncSource(2);

    expect(requestJson.mock.calls).toEqual([
      ["/api/leads/5", { method: "PATCH", body: { status: "in_progress", expectedStatus: "new" } }],
      ["/api/leads/5", { method: "PATCH", body: { note: null } }],
      ["/api/leads/5/patient-matches"],
      ["/api/leads/5/patient", { method: "PUT", body: { patientId: 31 } }],
      ["/api/leads/5/patient", { method: "PUT", body: { patientId: null } }],
      ["/api/leads/sources"],
      ["/api/leads/sources/manage"],
      ["/api/leads/sources", { method: "POST", body: input }],
      ["/api/leads/sources/2", { method: "PATCH", body: patch }],
      ["/api/leads/sources/2/check", { method: "POST" }],
      ["/api/leads/sources/2/sync", { method: "POST" }],
    ]);
  });

  it("builds the list query from the filters that are set", async () => {
    await leadsApi.list();
    await leadsApi.list({});
    await leadsApi.list({ stage: null, sourceId: null, beforeId: null, limit: null });
    await leadsApi.list({ stage: "visited" });
    await leadsApi.list({ sourceId: 3, beforeId: 120 });
    await leadsApi.list({ stage: "no_answer", sourceId: 3, beforeId: 120, limit: 200 });

    expect(requestJson.mock.calls).toEqual([
      ["/api/leads"],
      ["/api/leads"],
      ["/api/leads"],
      ["/api/leads?stage=visited"],
      ["/api/leads?sourceId=3&beforeId=120"],
      ["/api/leads?stage=no_answer&sourceId=3&beforeId=120&limit=200"],
    ]);
  });

  it("builds the contractor's list query the same way", async () => {
    await leadsApi.mine();
    await leadsApi.mine({ beforeId: null });
    await leadsApi.mine({ beforeId: 44 });
    await leadsApi.mine({ beforeId: 44, limit: 100 });

    expect(requestJson.mock.calls).toEqual([
      ["/api/leads/mine"],
      ["/api/leads/mine"],
      ["/api/leads/mine?beforeId=44"],
      ["/api/leads/mine?beforeId=44&limit=100"],
    ]);
  });
});
