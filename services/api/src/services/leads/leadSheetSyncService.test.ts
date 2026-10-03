import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const mockEnv = vi.hoisted(() => ({
  isProduction: true, debugErrorDetails: false, dataProvider: "postgres", leadsSheetSyncEnabled: true,
}));
vi.mock("../../config/env", () => ({ env: mockEnv }));
import { LeadSheetSyncService, startLeadSheetSync, type FetchSheet } from "./leadSheetSyncService";
import type { SheetFetchResult } from "./sheetCsvClient";
import { LeadsService } from "../leadsService";
import { PostgresLeadsRepository } from "../../repositories/postgres/PostgresLeadsRepository";
import type { AuthTokenPayload } from "../../repositories/interfaces/userTypes";
import { pgError, printedLines } from "../../testing/logFixtures";

const db = new PGlite();
let leadInserts = 0;
const pool = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes("INSERT INTO leads")) leadInserts += 1;
    return db.query(sql, params);
  },
  async connect() {
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release: () => undefined };
  },
};

// Made-up sheet ids of the shape Google uses; the real sheet is never named in the code.
const SHEET_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const SHEET_B = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV";
const SHEET_FOREIGN = "1QwErTyUiOpAsDfGhJkLzXcVbNm0123456789-_QwErT";
// Sources seeded for every test. 1: clinic 1, sync on. 2: clinic 1, tab 5, sync off. 3: clinic 2, sync on. 4: clinic 1, no sheet.
const SOURCE_A = 1;
const SOURCE_B = 2;
const FOREIGN_SOURCE = 3;
const SOURCE_WITHOUT_SHEET = 4;

/** Three rows with a usable phone and one without. */
const SHEET_CSV = [
  "Имя,Телефон,Город",
  "Алишер Тестов,+998 90 123-45-67,Ташкент",
  "Дилноза Каримова,998935550001,Самарканд",
  "Рустам Юсупов,93 555 00 02,",
  "Гость Безномера,,Бухара",
].join("\r\n");
const FOREIGN_CSV = "Телефон,Имя\n+998 90 123-45-67,Чужой Лид\n998977770000,Второй Чужой";
/** What must never reach the log: phones, names and other cells of the fixtures, the sheet ids. */
const PRIVATE = [
  "998901234567", "901234567", "123-45-67", "998935550001", "935550002", "555 00 02", "998977770000",
  "Алишер", "Тестов", "Дилноза", "Каримова", "Рустам", "Юсупов", "Безномера", "Чужой Лид", "Второй",
  "Ташкент", "Самарканд", "Бухара", SHEET_A, SHEET_B, SHEET_FOREIGN,
];

const admin: AuthTokenPayload = { userId: 1, clinicId: 1, username: "admin", role: "superadmin" };
const foreignAdmin: AuthTokenPayload = { userId: 20, clinicId: 2, username: "foreignAdmin", role: "superadmin" };

/** What the stubbed read answers for a sheet tab; an Error is thrown. A tab that is not listed is "not found". */
const sheets = new Map<string, SheetFetchResult | Error>();
const tab = (spreadsheetId: string, gid = 0) => `${spreadsheetId}#${gid}`;
const csv = (text: string): SheetFetchResult => ({ status: "ok", text });
const events: string[] = [];
const fetchSheet = vi.fn<FetchSheet>(async (spreadsheetId, gid) => {
  events.push(`fetch ${spreadsheetId}`);
  const answer = sheets.get(tab(spreadsheetId, gid)) ?? { status: "not_found" };
  if (answer instanceof Error) throw answer;
  return answer;
});

let repository: PostgresLeadsRepository;
let service: LeadSheetSyncService;

const leadRows = async () =>
  (await db.query<{ clinic_id: number; source_id: number; phone: string; full_name: string | null; extra: unknown; status: string }>(
    "SELECT clinic_id, source_id, phone, full_name, extra, status FROM leads ORDER BY id"
  )).rows;
const syncState = async (sourceId: number) =>
  (await db.query<{ last_sync_at: Date | null; last_sync_status: string | null; last_sync_rows: number | null; last_sync_skipped: number | null }>(
    "SELECT last_sync_at, last_sync_status, last_sync_rows, last_sync_skipped FROM lead_sources WHERE id = $1",
    [sourceId]
  )).rows[0];
const NEVER_READ = { last_sync_at: null, last_sync_status: null, last_sync_rows: null, last_sync_skipped: null };
const setColumnMap = (sourceId: number, map: { phone: string; name: string | null }) =>
  db.query("UPDATE lead_sources SET column_map = $2::jsonb WHERE id = $1", [sourceId, JSON.stringify(map)]);
/** Header and `count` rows, each with its own valid phone. */
const csvOfRows = (count: number) =>
  ["Телефон,Имя", ...Array.from({ length: count }, (_, index) => `99893${1000000 + index},Лид ${index + 1}`)].join("\n");
const checkConstraintError = () =>
  pgError({
    message: 'new row for relation "leads" violates check constraint "leads_phone_check"',
    code: "23514",
    detail: "Failing row contains (1, 2, 3, p:998977770000, Чужой Лид, 998977770000, {}, new).",
    table: "leads",
    constraint: "leads_phone_check",
  });

beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, username text not null, full_name text, role text not null,
      is_active boolean default true, deleted_at timestamptz);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/038_leads.sql"), "utf8"));
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE leads, lead_sources, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics VALUES (1, 'Клиника Камилова'), (2, 'Вторая клиника');
    INSERT INTO users (id, clinic_id, username, full_name, role) VALUES
      (1, 1, 'admin', 'Владелец', 'superadmin'), (7, 1, 'marketerA', 'Таргетолог А', 'marketer'),
      (20, 2, 'foreignAdmin', 'Админ второй клиники', 'superadmin'), (21, 2, 'foreignMarketer', 'Чужой таргетолог', 'marketer');
    INSERT INTO lead_sources (clinic_id, name, marketer_user_id, spreadsheet_id, sheet_gid, sync_enabled) VALUES
      (1, 'Instagram', 7, '${SHEET_A}', 0, TRUE),
      (1, 'Facebook', NULL, '${SHEET_B}', 5, FALSE),
      (2, 'Чужой источник', 21, '${SHEET_FOREIGN}', 0, TRUE),
      (1, 'Без таблицы', NULL, NULL, 0, FALSE);`);
  leadInserts = 0;
  events.length = 0;
  sheets.clear();
  fetchSheet.mockClear();
  repository = new PostgresLeadsRepository(pool);
  service = new LeadSheetSyncService(repository, new LeadsService(repository), fetchSheet);
  // The cycle writes its summary line; the tests that read the log spy on their own.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("check", () => {
  it("returns the headers, the detected columns and the counts, and writes nothing", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    const recordSync = vi.spyOn(repository, "recordSync");

    expect(await service.check(admin, SOURCE_A)).toEqual({
      status: "ok", headers: ["Имя", "Телефон", "Город"], detected: { phone: "Телефон", name: "Имя" }, rows: 4, valid: 3, skipped: 1,
    });
    expect(fetchSheet.mock.calls).toEqual([[SHEET_A, 0]]);
    expect(recordSync).not.toHaveBeenCalled();
    expect(leadInserts).toBe(0);
    expect(await leadRows()).toEqual([]);
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);
  });

  it("reads the tab of the source with the columns chosen for it, also when sync is off", async () => {
    sheets.set(tab(SHEET_B, 5), csv("Клиент,Контакт,Телефон\nАлишер Тестов,998901234567,нет\nДилноза Каримова,,998935550001"));
    await setColumnMap(SOURCE_B, { phone: "Контакт", name: "Клиент" });

    expect(await service.check(admin, SOURCE_B)).toEqual({
      status: "ok", headers: ["Клиент", "Контакт", "Телефон"], detected: { phone: "Контакт", name: "Клиент" }, rows: 2, valid: 1, skipped: 1,
    });
    expect(fetchSheet.mock.calls).toEqual([[SHEET_B, 5]]);
  });

  it("answers with the code of a failed read, of an empty sheet and of a missing column", async () => {
    const nothing = { headers: [], detected: { phone: null, name: null }, rows: 0, valid: 0, skipped: 0 };
    for (const status of ["no_access", "not_found", "too_large", "timeout", "http_error"] as const) {
      sheets.set(tab(SHEET_A), { status });
      expect(await service.check(admin, SOURCE_A), status).toEqual({ status, ...nothing });
    }
    sheets.set(tab(SHEET_A), csv(""));
    expect(await service.check(admin, SOURCE_A)).toEqual({ status: "empty", ...nothing });

    // The headers are still returned: the superadmin picks the columns from them.
    sheets.set(tab(SHEET_A), csv("Клиент,Контакт\nАлишер Тестов,998901234567"));
    expect(await service.check(admin, SOURCE_A)).toEqual({ ...nothing, status: "columns_not_found", headers: ["Клиент", "Контакт"] });
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);
    expect(await leadRows()).toEqual([]);
  });
});

describe("a source that cannot be read", () => {
  it("is 404 in another clinic and 422 without a sheet; nothing is fetched", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    for (const run of [service.check.bind(service), service.syncNow.bind(service)]) {
      await expect(run(foreignAdmin, SOURCE_A)).rejects.toMatchObject({ status: 404, message: "Источник не найден" });
      await expect(run(admin, FOREIGN_SOURCE)).rejects.toMatchObject({ status: 404, message: "Источник не найден" });
      await expect(run(admin, 999)).rejects.toMatchObject({ status: 404 });
      await expect(run(admin, SOURCE_WITHOUT_SHEET)).rejects.toMatchObject({ status: 422, message: "Сначала укажите ссылку на таблицу" });
    }
    expect(fetchSheet).not.toHaveBeenCalled();
    expect(await leadRows()).toEqual([]);
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);
    expect(await syncState(FOREIGN_SOURCE)).toEqual(NEVER_READ);
  });
});

describe("syncNow", () => {
  it("adds the rows with a phone, counts the row without one and records the read; a second read adds nothing", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));

    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "ok", rows: 4, added: 3, duplicates: 0, skipped: 1 });
    expect(await leadRows()).toEqual([
      { clinic_id: 1, source_id: SOURCE_A, phone: "998901234567", full_name: "Алишер Тестов", extra: { Город: "Ташкент" }, status: "new" },
      { clinic_id: 1, source_id: SOURCE_A, phone: "998935550001", full_name: "Дилноза Каримова", extra: { Город: "Самарканд" }, status: "new" },
      { clinic_id: 1, source_id: SOURCE_A, phone: "998935550002", full_name: "Рустам Юсупов", extra: {}, status: "new" },
    ]);
    expect(await syncState(SOURCE_A)).toEqual({ last_sync_at: expect.any(Date), last_sync_status: "ok", last_sync_rows: 4, last_sync_skipped: 1 });

    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "ok", rows: 4, added: 0, duplicates: 3, skipped: 1 });
    expect(await leadRows()).toHaveLength(3);
    // Only the source that was asked for is read and written.
    expect(fetchSheet.mock.calls).toEqual([[SHEET_A, 0], [SHEET_A, 0]]);
    expect(await syncState(FOREIGN_SOURCE)).toEqual(NEVER_READ);
  });

  it("reads a source whose scheduled reading is off", async () => {
    sheets.set(tab(SHEET_B, 5), csv("Телефон\n998971112233"));
    expect(await service.syncNow(admin, SOURCE_B)).toEqual({ status: "ok", rows: 1, added: 1, duplicates: 0, skipped: 0 });
    expect(await leadRows()).toEqual([{ clinic_id: 1, source_id: SOURCE_B, phone: "998971112233", full_name: null, extra: {}, status: "new" }]);
  });

  it("stores 'empty' for an empty sheet and inserts nothing", async () => {
    sheets.set(tab(SHEET_A), csv(""));
    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "empty", rows: 0, added: 0, duplicates: 0, skipped: 0 });
    expect(leadInserts).toBe(0);
    expect(await leadRows()).toEqual([]);
    expect(await syncState(SOURCE_A)).toEqual({ last_sync_at: expect.any(Date), last_sync_status: "empty", last_sync_rows: 0, last_sync_skipped: 0 });
  });

  it.each(["no_access", "not_found", "too_large", "timeout", "http_error"] as const)(
    "stores '%s' of a failed read and leaves the leads of the source as they are",
    async (status) => {
      sheets.set(tab(SHEET_A), csv(SHEET_CSV));
      await service.syncNow(admin, SOURCE_A);
      await db.exec("UPDATE leads SET status = 'booked', note = 'Перезвонить' WHERE id = 1");
      const before = await db.query("SELECT * FROM leads ORDER BY id");
      leadInserts = 0;

      sheets.set(tab(SHEET_A), { status });
      expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status, rows: 0, added: 0, duplicates: 0, skipped: 0 });
      expect(leadInserts).toBe(0);
      expect((await db.query("SELECT * FROM leads ORDER BY id")).rows).toEqual(before.rows);
      // A failed read has no counts: it is not "a sheet with 0 rows".
      expect(await syncState(SOURCE_A)).toEqual({ last_sync_at: expect.any(Date), last_sync_status: status, last_sync_rows: null, last_sync_skipped: null });
    }
  );

  it("stores 'columns_not_found' and inserts nothing when a chosen header is gone", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    await setColumnMap(SOURCE_A, { phone: "Номер клиента", name: null });
    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "columns_not_found", rows: 0, added: 0, duplicates: 0, skipped: 0 });
    // The phone column is there, the chosen name column is not: still nothing is taken.
    await setColumnMap(SOURCE_A, { phone: "Телефон", name: "ФИО клиента" });
    expect(await service.syncNow(admin, SOURCE_A)).toMatchObject({ status: "columns_not_found", added: 0 });

    expect(leadInserts).toBe(0);
    expect(await leadRows()).toEqual([]);
    expect(await syncState(SOURCE_A)).toEqual({ last_sync_at: expect.any(Date), last_sync_status: "columns_not_found", last_sync_rows: null, last_sync_skipped: null });
  });

  it("stores 'too_large' and inserts nothing for more than 5000 data rows; 5000 are read", async () => {
    sheets.set(tab(SHEET_A), csv(csvOfRows(5001)));
    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "too_large", rows: 5001, added: 0, duplicates: 0, skipped: 0 });
    expect(leadInserts).toBe(0);
    expect(await leadRows()).toEqual([]);
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "too_large", last_sync_rows: 5001, last_sync_skipped: 0 });
    expect(await service.check(admin, SOURCE_A)).toMatchObject({ status: "too_large", rows: 5001 });

    sheets.set(tab(SHEET_A), csv(csvOfRows(5000)));
    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "ok", rows: 5000, added: 5000, duplicates: 0, skipped: 0 });
    expect(leadInserts).toBe(10);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM leads WHERE clinic_id = 1 AND source_id = 1")).rows[0].count).toBe(5000);
  }, 30000);
});

describe("a sheet of very many lines", () => {
  /** A header, three leads and then one-character lines: `lines` lines in all. */
  const csvOfLines = (lines: number) => `${SHEET_CSV.split("\r\n").slice(0, 4).join("\r\n")}\r\n${"1\r\n".repeat(lines - 4)}`;
  const nothing = { headers: [], detected: { phone: null, name: null }, rows: 0, valid: 0, skipped: 0 };

  it("is 'too_large' without being turned into rows: nothing is counted and nothing is inserted", async () => {
    sheets.set(tab(SHEET_A), csv(csvOfLines(600_000)));
    const ingest = vi.spyOn(LeadsService.prototype, "ingestLeadRows");

    // Not the count of the lines: the pass stopped long before the end of the body.
    expect(await service.check(admin, SOURCE_A)).toEqual({ status: "too_large", ...nothing });
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);

    expect(await service.syncNow(admin, SOURCE_A)).toEqual({ status: "too_large", rows: 0, added: 0, duplicates: 0, skipped: 0 });
    expect(ingest).not.toHaveBeenCalled();
    expect(leadInserts).toBe(0);
    expect(await leadRows()).toEqual([]);
    // Like a body over 5 MB: a read that was not counted has no counts.
    expect(await syncState(SOURCE_A)).toEqual({ last_sync_at: expect.any(Date), last_sync_status: "too_large", last_sync_rows: null, last_sync_skipped: null });
  });

  it("is read up to 20 000 lines and refused from the next one", async () => {
    // 20 000 lines are still gone through and counted: over 5000 data rows, so not imported.
    sheets.set(tab(SHEET_A), csv(csvOfLines(20_000)));
    expect(await service.check(admin, SOURCE_A)).toMatchObject({ status: "too_large", rows: 19_999, valid: 3, skipped: 19_996 });
    // Empty lines are lines too.
    sheets.set(tab(SHEET_A), csv(`${SHEET_CSV}\r\n${"\r\n".repeat(19_995)}`));
    expect(await service.check(admin, SOURCE_A)).toMatchObject({ status: "ok", rows: 4, valid: 3, skipped: 1 });

    sheets.set(tab(SHEET_A), csv(csvOfLines(20_001)));
    expect(await service.check(admin, SOURCE_A)).toEqual({ status: "too_large", ...nothing });
    sheets.set(tab(SHEET_A), csv(`${SHEET_CSV}\r\n${"\r\n".repeat(19_996)}`));
    expect(await service.check(admin, SOURCE_A)).toEqual({ status: "too_large", ...nothing });
  });

  it("is refused by the schedule too, and the same body is not gone through again", async () => {
    sheets.set(tab(SHEET_A), csv(csvOfLines(600_000)));
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    const ingest = vi.spyOn(LeadsService.prototype, "ingestLeadRows");

    // The next source is still read.
    expect(await service.runCycle()).toEqual({ sources: 2, added: 2, unchanged: 0, errors: 0, statuses: { too_large: 1, ok: 1 } });
    expect(await service.runCycle()).toEqual({ sources: 2, added: 0, unchanged: 2, errors: 0, statuses: { too_large: 1, ok: 1 } });

    expect(ingest.mock.calls.map(([clinicId, sourceId]) => [clinicId, sourceId])).toEqual([[2, FOREIGN_SOURCE]]);
    expect((await leadRows()).map((row) => row.clinic_id)).toEqual([2, 2]);
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "too_large", last_sync_rows: null, last_sync_skipped: null });
  });
});

describe("runCycle", () => {
  it("reads only the sources with sync on, one after another, each into its own clinic", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    sheets.set(tab(SHEET_B, 5), csv("Телефон\n998971112233"));
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    const recordSync = repository.recordSync.bind(repository);
    vi.spyOn(repository, "recordSync").mockImplementation(async (clinicId, sourceId, ...rest) => {
      events.push(`record clinic ${clinicId} source ${sourceId}`);
      return recordSync(clinicId, sourceId, ...rest);
    });
    const ingest = vi.spyOn(LeadsService.prototype, "ingestLeadRows");

    expect(await service.runCycle()).toEqual({ sources: 2, added: 5, unchanged: 0, errors: 0, statuses: { ok: 2 } });

    // The second sheet is fetched only after the first source is done.
    expect(events).toEqual([`fetch ${SHEET_A}`, "record clinic 1 source 1", `fetch ${SHEET_FOREIGN}`, "record clinic 2 source 3"]);
    expect(ingest.mock.calls.map(([clinicId, sourceId, rows]) => [clinicId, sourceId, rows.length])).toEqual([[1, SOURCE_A, 3], [2, FOREIGN_SOURCE, 2]]);
    // The same phone is one lead in each clinic; the source of clinic 2 wrote nothing into clinic 1.
    expect((await leadRows()).map((row) => [row.clinic_id, row.source_id, row.phone])).toEqual([
      [1, SOURCE_A, "998901234567"], [1, SOURCE_A, "998935550001"], [1, SOURCE_A, "998935550002"],
      [2, FOREIGN_SOURCE, "998901234567"], [2, FOREIGN_SOURCE, "998977770000"],
    ]);
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 4, last_sync_skipped: 1 });
    expect(await syncState(FOREIGN_SOURCE)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 2, last_sync_skipped: 0 });
    // Sync is off for source B: not fetched, not written.
    expect(await syncState(SOURCE_B)).toEqual(NEVER_READ);
  });

  it("goes on to the next source when one throws, and logs the failure without the values of the row", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    const failing = checkConstraintError();
    vi.spyOn(repository, "insertLeads").mockRejectedValueOnce(failing);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await service.runCycle()).toEqual({ sources: 2, added: 2, unchanged: 0, errors: 1, statuses: { ok: 1 } });

    expect((await leadRows()).map((row) => [row.clinic_id, row.source_id])).toEqual([[2, FOREIGN_SOURCE], [2, FOREIGN_SOURCE]]);
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);
    expect(await syncState(FOREIGN_SOURCE)).toMatchObject({ last_sync_status: "ok" });
    const printed = printedLines(warn).join("\n");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(printed).toContain("[LEADS]");
    expect(printed).toContain("sourceId: 1");
    expect(printed).toContain("23514");
    expect(printed).toContain("leads_phone_check");
    expect(printed).not.toContain("Failing row");
    for (const secret of PRIVATE) expect(printed, secret).not.toContain(secret);

    // The failed source is not remembered as read: the next cycle reads it in full.
    expect(await service.runCycle()).toEqual({ sources: 2, added: 3, unchanged: 1, errors: 0, statuses: { ok: 2 } });
    expect(await leadRows()).toHaveLength(5);
  });

  it("goes on when the read itself throws", async () => {
    sheets.set(tab(SHEET_A), new Error("socket hang up"));
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    expect(await service.runCycle()).toEqual({ sources: 2, added: 2, unchanged: 0, errors: 1, statuses: { ok: 1 } });
    expect(await syncState(SOURCE_A)).toEqual(NEVER_READ);
  });

  it("does not insert an unchanged sheet again and still records the time of the read", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    sheets.set(tab(SHEET_FOREIGN), csv(""));
    expect(await service.runCycle()).toEqual({ sources: 2, added: 3, unchanged: 0, errors: 0, statuses: { ok: 1, empty: 1 } });
    expect(leadInserts).toBe(1);
    await db.exec("UPDATE lead_sources SET last_sync_at = '2020-01-01T00:00:00Z'");
    leadInserts = 0;
    const ingest = vi.spyOn(LeadsService.prototype, "ingestLeadRows");

    expect(await service.runCycle()).toEqual({ sources: 2, added: 0, unchanged: 2, errors: 0, statuses: { ok: 1, empty: 1 } });

    expect(ingest).not.toHaveBeenCalled();
    expect(leadInserts).toBe(0);
    // The sheets were fetched; the result of the last read is kept with a new time.
    expect(fetchSheet).toHaveBeenCalledTimes(4);
    const own = await syncState(SOURCE_A);
    expect(own).toMatchObject({ last_sync_status: "ok", last_sync_rows: 4, last_sync_skipped: 1 });
    expect(own.last_sync_at!.getUTCFullYear()).toBeGreaterThan(2020);
    const foreign = await syncState(FOREIGN_SOURCE);
    expect(foreign).toMatchObject({ last_sync_status: "empty", last_sync_rows: 0, last_sync_skipped: 0 });
    expect(foreign.last_sync_at!.getUTCFullYear()).toBeGreaterThan(2020);

    // A new row in the sheet: it is read in full again.
    sheets.set(tab(SHEET_A), csv(`${SHEET_CSV}\r\nНовый Лид,998971112233,Наманган`));
    expect(await service.runCycle()).toEqual({ sources: 2, added: 1, unchanged: 1, errors: 0, statuses: { ok: 1, empty: 1 } });
    expect(leadInserts).toBe(1);
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 5, last_sync_skipped: 1 });
  });

  it("reads an unchanged sheet again when other columns are chosen for the source", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    await setColumnMap(SOURCE_A, { phone: "Номер клиента", name: null });
    expect(await service.runCycle()).toMatchObject({ added: 0, statuses: { columns_not_found: 1 } });
    // The same answer for the same sheet and columns, without parsing it again.
    expect(await service.runCycle()).toMatchObject({ added: 0, unchanged: 1, statuses: { columns_not_found: 1 } });
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "columns_not_found", last_sync_rows: null });

    await setColumnMap(SOURCE_A, { phone: "Телефон", name: "Имя" });
    expect(await service.runCycle()).toMatchObject({ added: 3, unchanged: 0, statuses: { ok: 1 } });
    expect(await leadRows()).toHaveLength(3);
  });

  it("remembers a manual read, and returns to its result after a read that failed", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    await service.syncNow(admin, SOURCE_A);
    leadInserts = 0;
    expect(await service.runCycle()).toMatchObject({ added: 0, unchanged: 1 });

    sheets.set(tab(SHEET_A), { status: "no_access" });
    expect(await service.runCycle()).toMatchObject({ unchanged: 0, statuses: { no_access: 1 } });
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "no_access", last_sync_rows: null });

    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    expect(await service.runCycle()).toMatchObject({ added: 0, unchanged: 1, statuses: { ok: 1 } });
    expect(await syncState(SOURCE_A)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 4, last_sync_skipped: 1 });
    expect(leadInserts).toBe(0);
    expect(await leadRows()).toHaveLength(3);
  });

  it("does not start a second cycle while one is running", async () => {
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    fetchSheet.mockImplementationOnce(async () => {
      await held;
      return csv(SHEET_CSV);
    });

    const first = service.runCycle();
    expect(await service.runCycle()).toBeNull();
    release();
    expect(await first).toMatchObject({ sources: 2, added: 3 });
    // Once it has ended, the next cycle runs.
    expect(await service.runCycle()).toMatchObject({ sources: 2, unchanged: 1 });
  });

  it("frees the cycle when the list of sources cannot be read", async () => {
    vi.spyOn(repository, "listSyncEnabledSources").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    await expect(service.runCycle()).rejects.toThrow("Connection terminated unexpectedly");
    expect(await service.runCycle()).toMatchObject({ sources: 2 });
  });

  it("logs counts and codes only: no phone, no name, no other cell, no sheet id", async () => {
    await db.exec("UPDATE lead_sources SET sync_enabled = TRUE WHERE id = 2");
    sheets.set(tab(SHEET_A), csv(SHEET_CSV));
    sheets.set(tab(SHEET_B, 5), { status: "no_access" });
    sheets.set(tab(SHEET_FOREIGN), csv(FOREIGN_CSV));
    const insertLeads = repository.insertLeads.bind(repository);
    vi.spyOn(repository, "insertLeads").mockImplementation(async (clinicId, sourceId, rows) => {
      if (sourceId === FOREIGN_SOURCE) throw checkConstraintError();
      return insertLeads(clinicId, sourceId, rows);
    });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );

    await service.runCycle();
    await service.runCycle();

    // One line per cycle.
    expect(printedLines(spies[0])).toEqual([
      "[LEADS] sheet sync: sources=3 added=3 unchanged=0 errors=1 ok=1 no_access=1",
      "[LEADS] sheet sync: sources=3 added=0 unchanged=1 errors=1 ok=1 no_access=1",
    ]);
    const printed = spies.flatMap(printedLines).join("\n");
    expect(printed).toContain("sourceId: 3");
    for (const secret of PRIVATE) expect(printed, secret).not.toContain(secret);
  });
});

describe("startLeadSheetSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    mockEnv.dataProvider = "postgres";
    mockEnv.leadsSheetSyncEnabled = true;
  });

  it("runs the first cycle 60 seconds after the start and then every 5 minutes", () => {
    const runCycle = vi.fn(async () => null);
    startLeadSheetSync({ runCycle });

    vi.advanceTimersByTime(59_999);
    expect(runCycle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runCycle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4 * 60_000);
    expect(runCycle).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(runCycle).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(runCycle).toHaveBeenCalledTimes(3);
  });

  it("is not started when the flag is off or the data are not in PostgreSQL", () => {
    const runCycle = vi.fn(async () => null);
    mockEnv.leadsSheetSyncEnabled = false;
    startLeadSheetSync({ runCycle });
    mockEnv.leadsSheetSyncEnabled = true;
    mockEnv.dataProvider = "mock";
    startLeadSheetSync({ runCycle });

    vi.advanceTimersByTime(30 * 60_000);
    expect(runCycle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs a cycle that failed without the values of the row and keeps the schedule", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runCycle = vi.fn(async () => null).mockRejectedValueOnce(checkConstraintError());
    startLeadSheetSync({ runCycle });

    await vi.advanceTimersByTimeAsync(60_000);
    const printed = printedLines(warn).join("\n");
    expect(printed).toContain("[LEADS]");
    expect(printed).toContain("23514");
    for (const secret of PRIVATE) expect(printed, secret).not.toContain(secret);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(runCycle).toHaveBeenCalledTimes(2);
  });
});
