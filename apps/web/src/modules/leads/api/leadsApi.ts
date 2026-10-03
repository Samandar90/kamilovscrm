import { requestJson } from "../../../api/http";
import type {
  Lead,
  LeadPatch,
  LeadPatientMatch,
  LeadSheetCheck,
  LeadSource,
  LeadSourceBrief,
  LeadSourceInput,
  LeadSourcePatch,
  LeadSourcesManage,
  LeadSyncResult,
  LeadsListParams,
  LeadsPage,
  MyLeadsListParams,
  MyLeadsPage,
} from "./leadsTypes";

/**
 * Leads endpoints (/api/leads). Like queueApi, the token is taken from storage by requestJson. Failures are
 * HttpError (src/api/http.ts) with the server's Russian `error` text and `status`. A sheet that cannot be read is
 * not a failure: `checkSource` and `syncSource` answer normally with a `status` code.
 */
const base = "/api/leads";

/** Query string in a fixed order; a filter that is not set is left out. */
const withQuery = (path: string, params: Array<[string, string | number | null | undefined]>): string => {
  const query = new URLSearchParams();
  for (const [name, value] of params) {
    if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
};

export const leadsApi = {
  list: (params: LeadsListParams = {}) =>
    requestJson<LeadsPage>(
      withQuery(base, [
        ["stage", params.stage],
        ["sourceId", params.sourceId],
        ["beforeId", params.beforeId],
        ["limit", params.limit],
      ])
    ),
  update: (id: number, patch: LeadPatch) => requestJson<Lead>(`${base}/${id}`, { method: "PATCH", body: patch }),
  patientMatches: (id: number) => requestJson<{ items: LeadPatientMatch[] }>(`${base}/${id}/patient-matches`),
  setPatient: (id: number, patientId: number | null) =>
    requestJson<Lead>(`${base}/${id}/patient`, { method: "PUT", body: { patientId } }),
  sources: () => requestJson<{ items: LeadSourceBrief[] }>(`${base}/sources`),
  sourcesManage: () => requestJson<LeadSourcesManage>(`${base}/sources/manage`),
  createSource: (input: LeadSourceInput) => requestJson<LeadSource>(`${base}/sources`, { method: "POST", body: input }),
  updateSource: (id: number, patch: LeadSourcePatch) =>
    requestJson<LeadSource>(`${base}/sources/${id}`, { method: "PATCH", body: patch }),
  checkSource: (id: number) => requestJson<LeadSheetCheck>(`${base}/sources/${id}/check`, { method: "POST" }),
  syncSource: (id: number) => requestJson<LeadSyncResult>(`${base}/sources/${id}/sync`, { method: "POST" }),
  /** The contractor's own leads: the only leads endpoint the marketer role may call. */
  mine: (params: MyLeadsListParams = {}) =>
    requestJson<MyLeadsPage>(
      withQuery(`${base}/mine`, [
        ["beforeId", params.beforeId],
        ["limit", params.limit],
      ])
    ),
};
