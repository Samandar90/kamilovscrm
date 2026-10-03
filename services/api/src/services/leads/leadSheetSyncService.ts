import { createHash } from "node:crypto";
import { env } from "../../config/env";
import { ApiError } from "../../middleware/errorHandler";
import type {
  ILeadsRepository,
  LeadSheetCheck,
  LeadSyncResult,
  LeadSyncStatus,
  LeadSyncTarget,
} from "../../repositories/interfaces/leadTypes";
import type { AuthTokenPayload } from "../../repositories/interfaces/userTypes";
import { parseCsv } from "../../utils/csv";
import { errorForLog } from "../../utils/logRedaction";
import type { LeadsService } from "../leadsService";
import { fetchSheetCsv, type SheetFetchResult } from "./sheetCsvClient";
import { mapSheetRows, type SheetMapping } from "./sheetMapping";

/** Reads one tab of a sheet. The default is the CSV export of Google; tests pass a stub. */
export type FetchSheet = (spreadsheetId: string, gid: number) => Promise<SheetFetchResult>;

/** What one cycle did: counts and result codes only. */
export type LeadSyncCycleSummary = {
  /** Sources with sync on. */
  sources: number;
  /** Leads added by the cycle. */
  added: number;
  /** Sources whose sheet is the same as at the last read. */
  unchanged: number;
  /** Sources whose read threw. */
  errors: number;
  /** Result code → number of sources. */
  statuses: Partial<Record<LeadSyncStatus, number>>;
};

/** A sheet with more data rows is not imported. */
const MAX_DATA_ROWS = 5000;

// Fixed texts, the same as in leadsService: no link and no sheet id in them.
const SOURCE_NOT_FOUND = "Источник не найден";
const SHEET_NOT_SET = "Сначала укажите ссылку на таблицу";

/**
 * A body with more lines is not turned into rows at all. The sheet is in the contractor's hands, and 5 MB of
 * one-character lines would be millions of arrays (about 1 GB). The room above MAX_DATA_ROWS is for a title,
 * the header and blank lines.
 */
const MAX_SHEET_LINES = 20_000;

const NO_COUNTS = { rows: 0, added: 0, duplicates: 0, skipped: 0 };

/** The rows of the body, or null when it has more than MAX_SHEET_LINES lines: the pass stops there. */
const tableOf = (text: string): string[][] | null => {
  const table = parseCsv(text, MAX_SHEET_LINES);
  return table.length > MAX_SHEET_LINES ? null : table;
};

/** `too_large` by data rows is decided here: the mapping does not know the limit. */
const statusOf = (mapping: SheetMapping): LeadSyncStatus =>
  mapping.status === "ok" && mapping.dataRows > MAX_DATA_ROWS ? "too_large" : mapping.status;

/** One value for "this body of this tab read with these columns": other columns make the same body another read. */
const readHash = (source: LeadSyncTarget, text: string): string =>
  createHash("sha256")
    .update(JSON.stringify([source.spreadsheetId, source.gid, source.columnMap]))
    .update("\n")
    .update(text)
    .digest("hex");

type LastRead = { hash: string; status: LeadSyncStatus; rows: number | null; skipped: number | null };

/**
 * Reads the sheets of lead sources: `check` and `syncNow` for the superadmin, `runCycle` for the schedule.
 * The clinic always comes with the source row. Leads are only added (LeadsService.ingestLeadRows); a failed
 * read is stored as its code and never as "an empty sheet". Nothing here logs a cell, a name or a sheet id.
 */
export class LeadSheetSyncService {
  /** The last completed read of each source, in the memory of this process. */
  private readonly lastReads = new Map<number, LastRead>();
  private cycleRunning = false;

  constructor(
    private readonly leads: Pick<ILeadsRepository, "findSource" | "listSyncEnabledSources" | "recordSync">,
    private readonly leadsService: Pick<LeadsService, "ingestLeadRows">,
    private readonly fetchSheet: FetchSheet = fetchSheetCsv
  ) {}

  /** Reads the sheet and writes nothing: the headers, the columns found and how many rows have a usable phone. */
  async check(auth: AuthTokenPayload, sourceId: number): Promise<LeadSheetCheck> {
    const source = await this.requireSheetSource(auth.clinicId, sourceId);
    const fetched = await this.fetchSheet(source.spreadsheetId, source.gid);
    const table = fetched.status === "ok" ? tableOf(fetched.text) : null;
    if (table === null) {
      const status = fetched.status === "ok" ? "too_large" : fetched.status;
      return { status, headers: [], detected: { phone: null, name: null }, rows: 0, valid: 0, skipped: 0 };
    }
    const mapping = mapSheetRows(table, source.columnMap);
    return {
      status: statusOf(mapping),
      headers: mapping.headers,
      detected: mapping.detected,
      rows: mapping.dataRows,
      valid: mapping.rows.length,
      skipped: mapping.skipped,
    };
  }

  /** Reads the sheet now, whether or not the scheduled reading is on. */
  async syncNow(auth: AuthTokenPayload, sourceId: number): Promise<LeadSyncResult> {
    const source = await this.requireSheetSource(auth.clinicId, sourceId);
    return (await this.readSource(source, false)).result;
  }

  /**
   * One scheduled pass: every source with sync on, one after another, each with the clinic of its own row.
   * A source that throws is logged and does not stop the next one. Returns null when a cycle is already running.
   */
  async runCycle(): Promise<LeadSyncCycleSummary | null> {
    if (this.cycleRunning) return null;
    this.cycleRunning = true;
    try {
      const sources = await this.leads.listSyncEnabledSources();
      const summary: LeadSyncCycleSummary = { sources: sources.length, added: 0, unchanged: 0, errors: 0, statuses: {} };
      for (const source of sources) {
        try {
          const { result, unchanged } = await this.readSource(source, true);
          summary.added += result.added;
          if (unchanged) summary.unchanged += 1;
          summary.statuses[result.status] = (summary.statuses[result.status] ?? 0) + 1;
        } catch (err) {
          summary.errors += 1;
          // eslint-disable-next-line no-console
          console.warn("[LEADS] sheet sync: source failed", { sourceId: source.id, error: errorForLog(err) });
        }
      }
      const statuses = Object.entries(summary.statuses).map(([status, count]) => ` ${status}=${count}`).join("");
      // eslint-disable-next-line no-console
      console.log(
        `[LEADS] sheet sync: sources=${summary.sources} added=${summary.added} unchanged=${summary.unchanged} errors=${summary.errors}${statuses}`
      );
      return summary;
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * Fetch, parse, insert, record. With `skipUnchanged` a body that is the same as at the last completed read of
   * the source is not parsed again: only the time of the read is recorded, with the result of that read.
   */
  private async readSource(
    source: LeadSyncTarget,
    skipUnchanged: boolean
  ): Promise<{ result: LeadSyncResult; unchanged: boolean }> {
    const fetched = await this.fetchSheet(source.spreadsheetId, source.gid);
    if (fetched.status !== "ok") {
      await this.leads.recordSync(source.clinicId, source.id, fetched.status, null, null);
      return { result: { status: fetched.status, ...NO_COUNTS }, unchanged: false };
    }

    const hash = readHash(source, fetched.text);
    const last = this.lastReads.get(source.id);
    if (skipUnchanged && last?.hash === hash) {
      await this.leads.recordSync(source.clinicId, source.id, last.status, last.rows, last.skipped);
      return { result: { ...NO_COUNTS, status: last.status, rows: last.rows ?? 0, skipped: last.skipped ?? 0 }, unchanged: true };
    }

    const table = tableOf(fetched.text);
    if (table === null) {
      // Not counted, like a body over the size limit. Remembered: the same body is not gone through next time.
      await this.leads.recordSync(source.clinicId, source.id, "too_large", null, null);
      this.lastReads.set(source.id, { hash, status: "too_large", rows: null, skipped: null });
      return { result: { status: "too_large", ...NO_COUNTS }, unchanged: false };
    }

    const mapping = mapSheetRows(table, source.columnMap);
    const status = statusOf(mapping);
    // A sheet whose columns were not found was not counted: it has no counts, unlike a sheet with 0 rows.
    const counted = status !== "columns_not_found";
    const rows = counted ? mapping.dataRows : null;
    const skipped = counted ? mapping.skipped : null;
    let added = 0;
    let duplicates = 0;
    if (status === "ok") {
      ({ added, duplicates } = await this.leadsService.ingestLeadRows(source.clinicId, source.id, mapping.rows));
    }
    await this.leads.recordSync(source.clinicId, source.id, status, rows, skipped);
    // Remembered only now: a read that threw above is done in full again next time.
    this.lastReads.set(source.id, { hash, status, rows, skipped });
    return { result: { status, rows: rows ?? 0, added, duplicates, skipped: skipped ?? 0 }, unchanged: false };
  }

  /** The source of this clinic with its sheet: 404 for another clinic's or an unknown one, 422 when no sheet is set. */
  private async requireSheetSource(clinicId: number, sourceId: number): Promise<LeadSyncTarget> {
    const source = await this.leads.findSource(clinicId, sourceId);
    if (!source) {
      throw new ApiError(404, SOURCE_NOT_FOUND);
    }
    if (source.spreadsheetId == null) {
      throw new ApiError(422, SHEET_NOT_SET);
    }
    return { clinicId: source.clinicId, id: source.id, spreadsheetId: source.spreadsheetId, gid: source.gid, columnMap: source.columnMap };
  }
}

const FIRST_RUN_MS = 60_000;
const CYCLE_MS = 5 * 60 * 1000;

/** Starts the scheduled reading (called from server.ts once the server listens). Overlapping cycles are refused by runCycle. */
export const startLeadSheetSync = (service: Pick<LeadSheetSyncService, "runCycle">): void => {
  if (!env.leadsSheetSyncEnabled || env.dataProvider !== "postgres") {
    // eslint-disable-next-line no-console
    console.log("[LEADS] sheet sync disabled (LEADS_SHEET_SYNC_ENABLED/postgres required)");
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[LEADS] sheet sync started (every 5 min)");
  const tick = () => {
    service.runCycle().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[LEADS] sheet sync cycle error:", errorForLog(err));
    });
  };
  // The interval starts with the first cycle: 1:00, 6:00, 11:00 after the start.
  setTimeout(() => {
    tick();
    setInterval(tick, CYCLE_MS);
  }, FIRST_RUN_MS);
};
