import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Request, Response } from "express";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-migration-035-tests-only" } }));
import { errorHandler } from "../../middleware/errorHandler";

const db = new PGlite();
const migration = (file: string) => readFileSync(resolve(__dirname, "../../../migrations", file), "utf8");
const COUNTER_UPSERT = `INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number) VALUES ($1, $2, $3::date, 1)
  ON CONFLICT (doctor_id, queue_date) DO UPDATE SET last_number = queue_counters.last_number + 1 RETURNING last_number`;
const nextNumber = async (doctorId: number, day: string) =>
  Number((await db.query<{ last_number: number }>(COUNTER_UPSERT, [1, doctorId, day])).rows[0].last_number);
/** Resolves to the Postgres error (code + constraint) or null when the statement succeeds. */
const failure = async (sql: string, params?: unknown[]) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
};
let preExisting: { queue_number: number | null; queue_prefix: string | null; queue_call_count: number } | undefined;

beforeAll(async () => {
  await db.exec(`SET TIME ZONE '${Intl.DateTimeFormat().resolvedOptions().timeZone}'`);
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text, subscription_status text, subscription_ends_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text, specialty text default '', percent numeric default 0,
      phone text, birth_date date, active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
      price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text default 'draft',
      cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
      created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Чужая');
    INSERT INTO users(id, clinic_id) VALUES (1, 1);
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримова Анна');
    INSERT INTO doctors(id, clinic_id, full_name) VALUES (10, 1, 'Др. Алиева'), (11, 1, 'Др. Юсупов');
    INSERT INTO appointments(clinic_id, patient_id, doctor_id, start_at, end_at, status)
      VALUES (1, 100, 10, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived');`);
  await db.exec(migration("033_call_center_daily_workflow.sql"));
  await db.exec(migration("035_electronic_queue.sql"));
  // The runner applies each file once, but a failed deploy may retry it: 035 must be safe to run again.
  await db.exec(migration("035_electronic_queue.sql"));
  preExisting = (await db.query<{ queue_number: number | null; queue_prefix: string | null; queue_call_count: number }>(
    "SELECT queue_number, queue_prefix, queue_call_count FROM appointments WHERE id = 1"
  )).rows[0];
}, 30000);
afterAll(() => db.close());

describe("migration 035 electronic queue", () => {
  it("is additive: an appointment that existed before gets empty queue fields and a zero call count", () => {
    expect(preExisting).toEqual({ queue_number: null, queue_prefix: null, queue_call_count: 0 });
  });

  it("is idempotent: running it twice creates each constraint and index once", async () => {
    const constraints = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname LIKE 'doctors_room_check%' OR conname LIKE 'doctors_queue_prefix_check%'
         OR conname LIKE 'appointments_queue_number_check%' ORDER BY conname`
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "appointments_queue_number_check",
      "doctors_queue_prefix_check",
      "doctors_room_check",
    ]);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('ux_appointments_queue_ticket', 'idx_appointments_queue_day',
         'idx_appointments_in_consultation_day', 'idx_queue_displays_clinic') ORDER BY indexname`
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "idx_appointments_in_consultation_day",
      "idx_appointments_queue_day",
      "idx_queue_displays_clinic",
      "ux_appointments_queue_ticket",
    ]);
    // The two queue-day indexes serve the two OR branches of Task 4's listDayRows; their partial predicates must match it.
    const dayIndexes = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname IN ('idx_appointments_queue_day', 'idx_appointments_in_consultation_day') ORDER BY indexname"
    );
    expect(dayIndexes.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX idx_appointments_in_consultation_day ON public.appointments USING btree (clinic_id, start_at) WHERE ((status = 'in_consultation'::text) AND (deleted_at IS NULL))",
      "CREATE INDEX idx_appointments_queue_day ON public.appointments USING btree (clinic_id, queue_date, doctor_id) WHERE ((queue_number IS NOT NULL) AND (deleted_at IS NULL))",
    ]);
  });

  it("checks doctor room and queue letter", async () => {
    expect(await failure("UPDATE doctors SET room = '   ' WHERE id = 10")).toMatchObject({ code: "23514", constraint: "doctors_room_check" });
    expect(await failure("UPDATE doctors SET room = $1 WHERE id = 10", ["x".repeat(21)])).toMatchObject({ code: "23514" });
    expect(await failure("UPDATE doctors SET room = $1 WHERE id = 10", ["2".repeat(20)])).toBeNull();
    expect(await failure("UPDATE doctors SET queue_prefix = 'AB' WHERE id = 10")).toMatchObject({ code: "23514", constraint: "doctors_queue_prefix_check" });
    expect(await failure("UPDATE doctors SET queue_prefix = 'К', room = '12' WHERE id = 10")).toBeNull(); // Cyrillic letter: char_length 1
    expect(await failure("UPDATE doctors SET queue_prefix = NULL, room = NULL WHERE id = 11")).toBeNull();
  });

  it("checks appointment queue numbers and display settings", async () => {
    expect(await failure("UPDATE appointments SET queue_number = 0 WHERE id = 1")).toMatchObject({ code: "23514", constraint: "appointments_queue_number_check" });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash, language) VALUES (1, 'Холл', 'hash-en', 'en')"))
      .toMatchObject({ code: "23514", constraint: "queue_displays_language_check" });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash) VALUES (1, '   ', 'hash-blank')"))
      .toMatchObject({ code: "23514", constraint: "queue_displays_name_check" });
  });

  it("creates displays with defaults and a unique token hash", async () => {
    const created = await db.query<{ doctor_ids: number[] | null; show_names: boolean; language: string; voice_enabled: boolean; revoked_at: Date | null }>(
      "INSERT INTO queue_displays(clinic_id, name, token_hash, created_by) VALUES (1, 'Холл', 'hash-1', 1) RETURNING doctor_ids, show_names, language, voice_enabled, revoked_at"
    );
    expect(created.rows[0]).toEqual({ doctor_ids: null, show_names: true, language: "uz_ru", voice_enabled: true, revoked_at: null });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash) VALUES (1, 'Холл 2', 'hash-1')")).toMatchObject({ code: "23505" });
    const withDoctors = await db.query<{ doctor_ids: number[] }>(
      "INSERT INTO queue_displays(clinic_id, name, token_hash, doctor_ids) VALUES (1, 'Второй этаж', 'hash-2', $1::bigint[]) RETURNING doctor_ids",
      [[10, 11]]
    );
    expect(withDoctors.rows[0].doctor_ids.map(Number)).toEqual([10, 11]);
  });

  it("rejects a second appointment with the same doctor, day and number", async () => {
    const insert = (doctorId: number, queueNumber: number | null, day: string) =>
      failure("INSERT INTO appointments(clinic_id, patient_id, doctor_id, status, queue_number, queue_date) VALUES (1, 100, $1, 'arrived', $2, $3::date)", [doctorId, queueNumber, day]);
    expect(await insert(10, 1, "2026-09-30")).toBeNull();
    const duplicate = await insert(10, 1, "2026-09-30");
    expect(duplicate).toMatchObject({ code: "23505", constraint: "ux_appointments_queue_ticket" });
    expect(await insert(11, 1, "2026-09-30")).toBeNull(); // another doctor
    expect(await insert(10, 1, "2026-10-01")).toBeNull(); // another day
    expect(await insert(10, null, "2026-09-30")).toBeNull(); // rows without a number never collide
    expect(await insert(10, null, "2026-09-30")).toBeNull();

    // errorHandler turns the index violation into a readable 409 instead of the generic duplicate message.
    let status = 0;
    let body: unknown;
    const res = { status(code: number) { status = code; return this; }, json(payload: unknown) { body = payload; return this; } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    errorHandler(duplicate, {} as Request, res as unknown as Response, () => undefined);
    consoleError.mockRestore();
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Номер очереди уже занят, повторите действие" });
  });

  it("allocates counter numbers 1, 2, 3 per doctor and day independently", async () => {
    expect(await nextNumber(10, "2026-09-30")).toBe(1);
    expect(await nextNumber(10, "2026-09-30")).toBe(2);
    expect(await nextNumber(11, "2026-09-30")).toBe(1); // doctors are independent
    expect(await nextNumber(10, "2026-10-01")).toBe(1); // a new day starts at 1
    expect(await nextNumber(10, "2026-09-30")).toBe(3);
    expect(await failure(COUNTER_UPSERT, [1, 999, "2026-09-30"])).toMatchObject({ code: "23503" }); // unknown doctor
  });
});
