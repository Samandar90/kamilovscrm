/** Mirrors services/api/src/repositories/interfaces/leadTypes.ts (JSON over HTTP, camelCase). */

/** Stored status. `new` is set only by the sheet reader. */
export type LeadStatus = "new" | "in_progress" | "no_answer" | "booked" | "declined" | "invalid";
/** What the UI shows: `booked` / `visited` are derived from the linked patient's appointments made after the lead. */
export type LeadStage = LeadStatus | "visited";
export type LeadSyncStatus =
  | "ok"
  | "empty"
  | "no_access"
  | "not_found"
  | "columns_not_found"
  | "too_large"
  | "timeout"
  | "http_error";
export type LeadColumnMap = { phone: string; name: string | null };

export type Lead = {
  id: number;
  /** ISO time the CRM received the lead. */
  createdAt: string;
  fullName: string | null;
  /** Digits only, 10–15; shown with a leading "+". */
  phone: string;
  /** The other sheet columns: header → cell text. Staff only. */
  extra: Record<string, string>;
  status: LeadStatus;
  stage: LeadStage;
  note: string | null;
  sourceId: number;
  sourceName: string;
  patientId: number | null;
  patientName: string | null;
  staffUpdatedAt: string | null;
  staffUpdatedByName: string | null;
};
export type LeadsPage = { items: Lead[]; nextBeforeId: number | null };
export type LeadsListParams = {
  stage?: LeadStage | null;
  sourceId?: number | null;
  beforeId?: number | null;
  limit?: number | null;
};
/** PATCH /api/leads/:id — at least one of `status`, `note`. `expectedStatus` gives 409 if a colleague was faster. */
export type LeadPatch = {
  status?: Exclude<LeadStatus, "new">;
  expectedStatus?: LeadStatus;
  note?: string | null;
};

export type LeadSourceBrief = { id: number; name: string };
export type LeadSource = {
  id: number;
  name: string;
  marketerUserId: number | null;
  marketerName: string | null;
  sheetUrl: string | null;
  columnMap: LeadColumnMap | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: LeadSyncStatus | null;
  lastSyncRows: number | null;
  lastSyncSkipped: number | null;
  leadsCount: number;
  createdAt: string;
  updatedAt: string;
};
export type LeadMarketerOption = { id: number; fullName: string; username: string };
export type LeadSourcesManage = { items: LeadSource[]; marketers: LeadMarketerOption[] };
export type LeadSourceInput = { name: string; marketerUserId: number | null; sheetUrl: string | null };
export type LeadSourcePatch = Partial<LeadSourceInput> & { columnMap?: LeadColumnMap | null; syncEnabled?: boolean };

export type LeadSheetCheck = {
  status: LeadSyncStatus;
  headers: string[];
  detected: { phone: string | null; name: string | null };
  /** Data rows read. */
  rows: number;
  /** Rows with a usable phone. */
  valid: number;
  /** Rows without one. */
  skipped: number;
};
export type LeadSyncResult = { status: LeadSyncStatus; rows: number; added: number; duplicates: number; skipped: number };

export type LeadPatientMatch = { id: number; fullName: string; phone: string | null };

export type MyLead = {
  id: number;
  receivedAt: string;
  fullName: string | null;
  phone: string;
  sourceName: string;
  stage: LeadStage;
};
export type MyLeadsPage = { items: MyLead[]; nextBeforeId: number | null };
export type MyLeadsListParams = { beforeId?: number | null; limit?: number | null };
