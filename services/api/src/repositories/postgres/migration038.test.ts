import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const FILE = "038_leads.sql";
const db = new PGlite();
const migration = (file: string) => readFileSync(resolve(__dirname, "../../../migrations", file), "utf8");
/** Applies a file the way scripts/db-migrate.cjs does: inside one transaction. */
const apply = async (file: string) => {
  const sql = migration(file);
  await db.exec("BEGIN");
  try {
    await db.exec(sql);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
};
/** Resolves to the Postgres error (code + constraint) or null when the statement succeeds. */
const failure = async (sql: string, params?: unknown[]) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
};
// Made-up sheet id of the shape Google uses (44 characters); the real sheet is never named in the code.
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const source = (clinicId: number, name: string) =>
  db.query<{ id: number }>("INSERT INTO lead_sources (clinic_id, name) VALUES ($1, $2) RETURNING id", [clinicId, name])
    .then((result) => Number(result.rows[0].id));
/** Inserts a lead; `column` and its SQL literal add one more field to the row. */
const lead = (clinicId: number, sourceId: number, phone: string, column?: string, literal?: string) =>
  failure(
    `INSERT INTO leads (clinic_id, source_id, external_key, phone${column ? `, ${column}` : ""})
     VALUES ($1, $2, $3, $4${column ? `, ${literal}` : ""})`,
    [clinicId, sourceId, `p:${phone}`, phone]
  );
let ownSource = 0;
let foreignSource = 0;

beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text);
    CREATE TABLE users(id bigint primary key, clinic_id bigint);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Чужая');
    INSERT INTO users(id, clinic_id) VALUES (1, 1), (2, 2);
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримова Анна');`);
  await apply(FILE);
  // The runner applies each file once, but a failed deploy may retry it: 038 must be safe to run again.
  await apply(FILE);
  ownSource = await source(1, "Instagram");
  foreignSource = await source(2, "Чужой источник");
}, 30000);
afterAll(() => db.close());

describe("migration 038 leads", () => {
  it("is idempotent: running it twice creates each named constraint and the index once", async () => {
    const constraints = await db.query<{ conname: string; contype: string; table: string }>(
      `SELECT conname, contype, conrelid::regclass::text AS table FROM pg_constraint
       WHERE conname IN ('lead_sources_clinic_id_id_key', 'lead_sources_sync_needs_sheet', 'leads_source_fkey', 'leads_clinic_source_key')
       ORDER BY conname`
    );
    expect(constraints.rows).toEqual([
      { conname: "lead_sources_clinic_id_id_key", contype: "u", table: "lead_sources" },
      { conname: "lead_sources_sync_needs_sheet", contype: "c", table: "lead_sources" },
      { conname: "leads_clinic_source_key", contype: "u", table: "leads" },
      { conname: "leads_source_fkey", contype: "f", table: "leads" },
    ]);
    const indexes = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_leads_clinic_recent'");
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX idx_leads_clinic_recent ON public.leads USING btree (clinic_id, id DESC)",
    ]);
    // SET LOCAL ends with the migration's transaction.
    expect((await db.query<{ lock_timeout: string }>("SHOW lock_timeout")).rows[0].lock_timeout).toBe("0");
  });

  it("creates a source and a lead with the defaults of an untouched row", async () => {
    const created = await db.query(
      `SELECT marketer_user_id, spreadsheet_id, sheet_gid, column_map, sync_enabled, last_sync_at, last_sync_status,
              last_sync_rows, last_sync_skipped FROM lead_sources WHERE id = $1`,
      [ownSource]
    );
    expect(created.rows[0]).toEqual({
      marketer_user_id: null, spreadsheet_id: null, sheet_gid: 0, column_map: null, sync_enabled: false,
      last_sync_at: null, last_sync_status: null, last_sync_rows: null, last_sync_skipped: null,
    });
    expect(await lead(1, ownSource, "998901112233")).toBeNull();
    const row = await db.query(
      "SELECT full_name, extra, status, note, patient_id, staff_updated_at, staff_updated_by FROM leads WHERE phone = '998901112233'"
    );
    expect(row.rows[0]).toEqual({
      full_name: null, extra: {}, status: "new", note: null, patient_id: null, staff_updated_at: null, staff_updated_by: null,
    });
  });

  it("rejects a lead whose clinic and source belong to different clinics", async () => {
    expect(await lead(1, foreignSource, "998902223344")).toMatchObject({ code: "23503", constraint: "leads_source_fkey" });
    expect(await lead(2, ownSource, "998902223344")).toMatchObject({ code: "23503", constraint: "leads_source_fkey" });
    expect(await lead(1, 999, "998902223344")).toMatchObject({ code: "23503", constraint: "leads_source_fkey" });
    expect(await lead(2, foreignSource, "998902223344")).toBeNull();
  });

  it("rejects the same external key twice in one source and allows it in another source and clinic", async () => {
    expect(await lead(1, ownSource, "998903334455")).toBeNull();
    expect(await lead(1, ownSource, "998903334455")).toMatchObject({ code: "23505", constraint: "leads_clinic_source_key" });
    expect(await lead(2, foreignSource, "998903334455")).toBeNull();
    const secondSource = await source(1, "Facebook");
    expect(await lead(1, secondSource, "998903334455")).toBeNull();
  });

  it("does not let sync be switched on without a sheet", async () => {
    expect(await failure("UPDATE lead_sources SET sync_enabled = TRUE WHERE id = $1", [ownSource]))
      .toMatchObject({ code: "23514", constraint: "lead_sources_sync_needs_sheet" });
    expect(await failure("INSERT INTO lead_sources (clinic_id, name, sync_enabled) VALUES (1, 'Без таблицы', TRUE)"))
      .toMatchObject({ code: "23514", constraint: "lead_sources_sync_needs_sheet" });
    expect(await failure("UPDATE lead_sources SET spreadsheet_id = $2, sheet_gid = 7, sync_enabled = TRUE WHERE id = $1", [ownSource, SHEET_ID]))
      .toBeNull();
    expect(await failure("UPDATE lead_sources SET spreadsheet_id = NULL WHERE id = $1", [ownSource]))
      .toMatchObject({ code: "23514", constraint: "lead_sources_sync_needs_sheet" });
  });

  it("checks the source fields", async () => {
    expect(await failure("INSERT INTO lead_sources (clinic_id, name) VALUES (1, '   ')")).toMatchObject({ code: "23514", constraint: "lead_sources_name_check" });
    expect(await failure("INSERT INTO lead_sources (clinic_id, name) VALUES (1, $1)", ["x".repeat(101)])).toMatchObject({ code: "23514" });
    expect(await failure("INSERT INTO lead_sources (clinic_id, name) VALUES (3, 'Нет клиники')")).toMatchObject({ code: "23503" });
    expect(await failure("INSERT INTO lead_sources (clinic_id, name, spreadsheet_id) VALUES (1, 'Ссылка', 'https://docs.google.com/x')"))
      .toMatchObject({ code: "23514", constraint: "lead_sources_spreadsheet_id_check" });
    expect(await failure("INSERT INTO lead_sources (clinic_id, name, sheet_gid) VALUES (1, 'Лист', -1)"))
      .toMatchObject({ code: "23514", constraint: "lead_sources_sheet_gid_check" });
    expect(await failure(`INSERT INTO lead_sources (clinic_id, name, column_map) VALUES (1, 'Колонки', '["Телефон"]'::jsonb)`))
      .toMatchObject({ code: "23514", constraint: "lead_sources_column_map_check" });
    expect(await failure("UPDATE lead_sources SET last_sync_status = 'No access!' WHERE id = $1", [ownSource]))
      .toMatchObject({ code: "23514", constraint: "lead_sources_last_sync_status_check" });
    expect(await failure(
      `UPDATE lead_sources SET last_sync_status = 'columns_not_found', column_map = '{"phone": "Телефон", "name": null}'::jsonb WHERE id = $1`,
      [ownSource]
    )).toBeNull();
  });

  it("checks the lead fields", async () => {
    expect(await lead(1, ownSource, "+998904445566")).toMatchObject({ code: "23514", constraint: "leads_phone_check" });
    expect(await lead(1, ownSource, "901234567")).toMatchObject({ code: "23514", constraint: "leads_phone_check" });
    expect(await lead(1, ownSource, "998904445566", "status", "'visited'")).toMatchObject({ code: "23514", constraint: "leads_status_check" });
    expect(await lead(1, ownSource, "998904445566", "full_name", "''")).toMatchObject({ code: "23514", constraint: "leads_full_name_check" });
    expect(await lead(1, ownSource, "998904445566", "extra", "'[]'::jsonb")).toMatchObject({ code: "23514", constraint: "leads_extra_check" });
    expect(await lead(1, ownSource, "998904445566", "patient_id", "999")).toMatchObject({ code: "23503" });
    expect(await failure("UPDATE leads SET note = $1 WHERE phone = '998901112233'", ["x".repeat(2001)]))
      .toMatchObject({ code: "23514", constraint: "leads_note_check" });
    expect(await failure(
      "UPDATE leads SET note = $1, status = 'booked', patient_id = 100, staff_updated_at = now(), staff_updated_by = 1 WHERE phone = '998901112233'",
      ["x".repeat(2000)]
    )).toBeNull();
  });
});
