/** Stored status of a lead. `new` is set only by the sheet reader; staff never return a lead to it. */
export const LEAD_STATUSES = ["new", "in_progress", "no_answer", "booked", "declined", "invalid"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** What the UI shows: `booked` / `visited` are derived from the linked patient's appointments made after the lead. */
export const LEAD_STAGES = [...LEAD_STATUSES, "visited"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Result codes of a sheet read; stored in lead_sources.last_sync_status. */
export type LeadSyncStatus =
  | "ok"
  | "empty"
  | "no_access"
  | "not_found"
  | "columns_not_found"
  | "too_large"
  | "timeout"
  | "http_error";

/** Headers chosen by the superadmin; stored in lead_sources.column_map. `name: null` — the sheet has no name column. */
export type LeadColumnMap = { phone: string; name: string | null };

// ---------- HTTP contract (JSON, camelCase); mirrored by apps/web/src/modules/leads/api/leadsTypes.ts ----------

export type Lead = {
  id: number;
  createdAt: string;                 // ISO instant the CRM received the lead
  fullName: string | null;
  phone: string;                     // digits only, 10-15; the web shows it with "+"
  extra: Record<string, string>;     // the other sheet columns: header → cell text; staff only
  status: LeadStatus;                // stored
  stage: LeadStage;                  // derived
  note: string | null;
  sourceId: number;
  sourceName: string;
  patientId: number | null;
  patientName: string | null;
  staffUpdatedAt: string | null;
  staffUpdatedByName: string | null;
};
export type LeadsPage = { items: Lead[]; nextBeforeId: number | null };

export type LeadSourceBrief = { id: number; name: string };
export type LeadSource = {
  id: number;
  name: string;
  marketerUserId: number | null;
  marketerName: string | null;
  sheetUrl: string | null;           // buildSheetUrl(spreadsheetId, gid)
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
  rows: number;      // data rows read
  valid: number;     // rows with a usable phone
  skipped: number;   // rows without one
};
export type LeadSyncResult = { status: LeadSyncStatus; rows: number; added: number; duplicates: number; skipped: number };

export type LeadPatientMatch = { id: number; fullName: string; phone: string | null };

/** The contractor's view of a lead: nothing staff wrote, no other sheet columns, no patient. */
export type MyLead = { id: number; receivedAt: string; fullName: string | null; phone: string; sourceName: string; stage: LeadStage };
export type MyLeadsPage = { items: MyLead[]; nextBeforeId: number | null };

// ---------- Repository ----------

export type LeadSheetRef = { spreadsheetId: string; gid: number };

/** A source as stored: the sheet as id and tab number instead of a link. Never sent over HTTP as is. */
export type LeadSourceRecord = Omit<LeadSource, "sheetUrl"> & { clinicId: number; spreadsheetId: string | null; gid: number };

/** A source the scheduled reader has to read. */
export type LeadSyncTarget = { clinicId: number; id: number; spreadsheetId: string; gid: number; columnMap: LeadColumnMap | null };

export type LeadsListFilters = { stage: LeadStage | null; sourceId: number | null; beforeId: number | null; limit: number };
export type MyLeadsFilters = { beforeId: number | null; limit: number };

/** One sheet row ready for the insert. `phone` matches ^[0-9]{10,15}$, `fullName` is 1-200 characters or null. */
export type LeadInsertRow = { externalKey: string; fullName: string | null; phone: string; extra: Record<string, string> };

export type LeadStaffChanges = { status?: LeadStatus; note?: string | null };
export type LeadSourceCreate = { name: string; marketerUserId: number | null; sheet: LeadSheetRef | null };
/** `sheet: null` clears the sheet; a field that is absent is not touched. */
export type LeadSourceChanges = {
  name?: string;
  marketerUserId?: number | null;
  sheet?: LeadSheetRef | null;
  columnMap?: LeadColumnMap | null;
  syncEnabled?: boolean;
};

/**
 * Every statement filters by `clinicId`, passed explicitly (the scheduled reader has no request and no clinic context).
 * The only cross-clinic statement is `listSyncEnabledSources`.
 */
export interface ILeadsRepository {
  /** Newest first, at most `limit` rows; `stage` filters by the derived stage. */
  listLeads(clinicId: number, filters: LeadsListFilters): Promise<Lead[]>;
  getLead(clinicId: number, id: number): Promise<Lead | null>;
  /** Inserts the rows the source does not have yet (ON CONFLICT DO NOTHING); returns how many were added. A source of another clinic adds 0. */
  insertLeads(clinicId: number, sourceId: number, rows: LeadInsertRow[]): Promise<number>;
  /** One UPDATE; `expectedStatus` makes it conditional. "conflict" — the lead exists but its status is no longer the expected one. */
  updateLead(
    clinicId: number, id: number, changes: LeadStaffChanges, expectedStatus: LeadStatus | null, userId: number
  ): Promise<"ok" | "not_found" | "conflict">;
  /** Links a patient of the same clinic (not deleted), moving a `new` lead to `in_progress`; `null` unlinks. */
  setLeadPatient(clinicId: number, id: number, patientId: number | null, userId: number): Promise<"ok" | "not_found" | "patient_not_found">;
  /** Up to 5 patients of the clinic whose phone ends with the same 9 digits, newest first. */
  findPatientMatches(clinicId: number, phone: string): Promise<LeadPatientMatch[]>;
  /** Leads of the sources bound to this marketer, newest first, at most `limit` rows. */
  listMarketerLeads(clinicId: number, marketerUserId: number, filters: MyLeadsFilters): Promise<MyLead[]>;

  listSourcesBrief(clinicId: number): Promise<LeadSourceBrief[]>;
  listSources(clinicId: number): Promise<LeadSourceRecord[]>;                       // ordered by id
  findSource(clinicId: number, id: number): Promise<LeadSourceRecord | null>;
  createSource(clinicId: number, input: LeadSourceCreate, createdBy: number | null): Promise<LeadSourceRecord>;
  /** Changing the sheet resets column_map (unless a new one is sent) and last_sync_*; clearing it also switches sync off. Bumps updated_at. */
  updateSource(clinicId: number, id: number, changes: LeadSourceChanges): Promise<LeadSourceRecord | null>;
  /** Same clinic, role marketer, active, not deleted. */
  isBindableMarketer(clinicId: number, userId: number): Promise<boolean>;
  listMarketers(clinicId: number): Promise<LeadMarketerOption[]>;

  /** NOT clinic scoped: every source with sync on, each with its own clinic. Ordered by clinic_id, id. */
  listSyncEnabledSources(): Promise<LeadSyncTarget[]>;
  /** Sets last_sync_at = now() and the result of the read; `null` counts are stored as NULL (a failed read has none). */
  recordSync(clinicId: number, sourceId: number, status: LeadSyncStatus, rows: number | null, skipped: number | null): Promise<void>;
}
