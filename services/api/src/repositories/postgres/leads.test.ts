import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({
  env: {
    nodeEnv: "test", isProduction: false, allowDevBootstrap: false, jwtSecret: "isolated-leads-tests-only",
    dataProvider: "postgres", reportsTimezone: "Asia/Tashkent", corsOrigins: [],
  },
}));
vi.mock("../../config/database", () => ({
  dbPool: {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: () => pool.connect(),
  },
}));
// The "@/..." alias of tsconfig is not known to vitest; no OpenAI client is created in tests.
vi.mock("@/lib/openai", () => ({ hasOpenAI: false, openai: null }));
// No sheet is fetched in tests: the link helpers stay real, the read answers what a test puts into `sheet.answer`.
const sheet = vi.hoisted(() => ({
  answer: { status: "not_found" } as import("../../services/leads/sheetCsvClient").SheetFetchResult,
  calls: [] as Array<[string, number]>,
}));
vi.mock("../../services/leads/sheetCsvClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/leads/sheetCsvClient")>()),
  fetchSheetCsv: async (spreadsheetId: string, gid: number) => {
    sheet.calls.push([spreadsheetId, gid]);
    return sheet.answer;
  },
}));
// The real root router with the real container: the leads repository talks to PGlite through the mocked pool.
import { rootRouter } from "../../routes";
import { services } from "../../container";
import { PostgresLeadsRepository } from "./PostgresLeadsRepository";
import { errorHandler } from "../../middleware/errorHandler";
import { signAccessToken } from "../../utils/jwt";
import { buildSheetUrl } from "../../services/leads/sheetCsvClient";
import type { LeadRowInput } from "../../services/leads/sheetMapping";
import type { UserRole } from "../../auth/permissions";

const db = new PGlite();
// PGlite has one connection: serialize checkouts as a real pool would.
let gate = Promise.resolve();
async function acquire() {
  const previous = gate;
  let release!: () => void;
  gate = new Promise<void>((done) => { release = done; });
  await previous;
  return release;
}
let leadInserts = 0;
const pool = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes("INSERT INTO leads")) leadInserts += 1;
    const release = await acquire();
    try { return await db.query(sql, params); } finally { release(); }
  },
  async connect() {
    const release = await acquire();
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release };
  },
};
const repository = new PostgresLeadsRepository(pool);

const users = {
  admin: { userId: 1, clinicId: 1, role: "superadmin" },
  reception: { userId: 2, clinicId: 1, role: "reception" },
  operator: { userId: 3, clinicId: 1, role: "operator" },
  manager: { userId: 4, clinicId: 1, role: "manager" },
  director: { userId: 5, clinicId: 1, role: "director" },
  doctor: { userId: 6, clinicId: 1, role: "doctor" },
  marketerA: { userId: 7, clinicId: 1, role: "marketer" },
  marketerB: { userId: 8, clinicId: 1, role: "marketer" },
  foreignAdmin: { userId: 20, clinicId: 2, role: "superadmin" },
  foreignMarketer: { userId: 21, clinicId: 2, role: "marketer" },
} as const satisfies Record<string, { userId: number; clinicId: number; role: UserRole }>;
type Who = keyof typeof users;
// Sources seeded for every test: 1 and 2 in clinic 1 (marketers A and B), 3 in clinic 2.
const SOURCE_A = 1;
const SOURCE_B = 2;
const FOREIGN_SOURCE = 3;
// Made-up sheet id of the shape Google uses (44 characters); the real sheet is never named in the code.
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const SHEET_LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`;
const PHONE = "998901234567";
const NAME = "Алишер Тестов";
/** What must never appear in a 4xx body: fixture phones, names of leads and patients, the note, the sheet id. */
const PRIVATE = [PHONE, "901234567", "123-45-67", "Алишер", "Тестов", "Каримов", "Чужой Пациент", "Перезвонить", SHEET_ID];
let server: Server;
let root: string;
let checkedErrorBodies = 0;

const tokenOf = (who: Who) => signAccessToken({ username: who, ...users[who] });
const as = async (who: Who, path: string, method = "GET", body?: unknown) => {
  const res = await fetch(`${root}/api/leads${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenOf(who)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (res.status >= 400) {
    // Every error answer of every test is checked: no phone, no name, no sheet id.
    for (const secret of PRIVATE) expect(text, `${method} ${path} → ${res.status}`).not.toContain(secret);
    checkedErrorBodies += 1;
  }
  return { status: res.status, text, body: JSON.parse(text) as any };
};
const ingest = (sourceId: number, rows: LeadRowInput[], clinicId = 1) => services.leads.ingestLeadRows(clinicId, sourceId, rows);
/** `count` sheet rows with distinct valid phones; `start` shifts the phones so that two calls do not repeat them. */
const rowsOf = (count: number, start = 0): LeadRowInput[] =>
  Array.from({ length: count }, (_, index) => ({
    phone: `99893${String(5000000 + start + index)}`,
    fullName: `Лид ${start + index + 1}`,
    extra: {},
  }));
const FIXTURE_LEAD: LeadRowInput = { phone: PHONE, fullName: NAME, extra: { Город: "Ташкент", Услуга: "УЗИ" } };
const ids = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id);
const leadRow = async (id: number) =>
  (await db.query<Record<string, unknown>>(
    "SELECT clinic_id, source_id, external_key, full_name, phone, extra, status, note, patient_id, staff_updated_by FROM leads WHERE id = $1",
    [id]
  )).rows[0];
/** An appointment of a patient, created `offset` after (or before, when negative) the lead was received. */
const appointment = async (leadId: number, patientId: number, status: string, offset = "1 second", clinicId = 1) =>
  Number((await db.query<{ id: number }>(
    `INSERT INTO appointments (clinic_id, patient_id, status, created_at)
     SELECT $1, $2, $3, l.created_at + $4::interval FROM leads l WHERE l.id = $5 RETURNING id`,
    [clinicId, patientId, status, offset, leadId]
  )).rows[0].id);

beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text, subscription_status text, subscription_ends_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, username text not null, full_name text, role text not null,
      is_active boolean default true, deleted_at timestamptz);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, start_at timestamptz,
      status text, created_at timestamptz default now(), deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/038_leads.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api", rootRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  leadInserts = 0;
  sheet.calls.length = 0;
  sheet.answer = { status: "not_found" };
  await db.exec(`TRUNCATE leads, lead_sources, appointments, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics VALUES (1, 'Клиника Камилова', 'active', NULL), (2, 'Вторая клиника', 'active', NULL);
    INSERT INTO users (id, clinic_id, username, full_name, role, is_active, deleted_at) VALUES
      (1, 1, 'admin', 'Владелец', 'superadmin', TRUE, NULL),
      (2, 1, 'reception', 'Ресепшен Лола', 'reception', TRUE, NULL),
      (3, 1, 'operator', 'Оператор Нигора', 'operator', TRUE, NULL),
      (4, 1, 'manager', 'Менеджер', 'manager', TRUE, NULL),
      (5, 1, 'director', 'Директор', 'director', TRUE, NULL),
      (6, 1, 'doctor', 'Врач', 'doctor', TRUE, NULL),
      (7, 1, 'marketerA', 'Таргетолог А', 'marketer', TRUE, NULL),
      (8, 1, 'marketerB', 'Таргетолог Б', 'marketer', TRUE, NULL),
      (9, 1, 'marketerOff', 'Отключённый таргетолог', 'marketer', FALSE, NULL),
      (10, 1, 'marketerGone', 'Удалённый таргетолог', 'marketer', TRUE, now()),
      (20, 2, 'foreignAdmin', 'Админ второй клиники', 'superadmin', TRUE, NULL),
      (21, 2, 'foreignMarketer', 'Чужой таргетолог', 'marketer', TRUE, NULL);
    INSERT INTO patients (id, clinic_id, full_name, phone, deleted_at) VALUES
      (100, 1, 'Каримов Алишер', '+998 90 123-45-67', NULL),
      (101, 1, 'Каримова Дилноза', '998901234567', NULL),
      (102, 1, 'Юсупов Рустам', '+998935555555', NULL),
      (103, 1, 'Каримов Удалённый', '+998901234567', now()),
      (104, 1, 'Каримов Без кода', '90 123 45 67', NULL),
      (105, 1, 'Каримов Без телефона', NULL, NULL),
      (200, 2, 'Чужой Пациент', '+998901234567', NULL);
    INSERT INTO lead_sources (clinic_id, name, marketer_user_id, created_by) VALUES
      (1, 'Instagram', 7, 1), (1, 'Facebook', 8, 1), (2, 'Чужой источник', 21, 20);`);
});

describe("ingestLeadRows", () => {
  it("adds each phone once per source: a second read adds nothing, repeats inside a batch collapse", async () => {
    const batch: LeadRowInput[] = [FIXTURE_LEAD, { phone: "998935550001", fullName: null, extra: {} }, { phone: PHONE, fullName: "Повтор", extra: {} }];
    // A repeat inside the batch is not "already there": duplicates counts only the keys the source had before.
    expect(await ingest(SOURCE_A, batch)).toEqual({ received: 3, added: 2, duplicates: 0 });
    expect(await ingest(SOURCE_A, batch)).toEqual({ received: 3, added: 0, duplicates: 2 });

    const stored = await db.query("SELECT clinic_id, source_id, external_key, full_name, phone, extra, status FROM leads ORDER BY id");
    expect(stored.rows).toEqual([
      // The first row of a repeated phone wins.
      { clinic_id: 1, source_id: SOURCE_A, external_key: `p:${PHONE}`, full_name: NAME, phone: PHONE, extra: { Город: "Ташкент", Услуга: "УЗИ" }, status: "new" },
      { clinic_id: 1, source_id: SOURCE_A, external_key: "p:998935550001", full_name: null, phone: "998935550001", extra: {}, status: "new" },
    ]);
    // The same phone is a separate lead in another source and in another clinic.
    expect(await ingest(SOURCE_B, batch)).toEqual({ received: 3, added: 2, duplicates: 0 });
    expect(await ingest(FOREIGN_SOURCE, batch, 2)).toEqual({ received: 3, added: 2, duplicates: 0 });
    expect(await ingest(SOURCE_A, [])).toEqual({ received: 0, added: 0, duplicates: 0 });
  });

  it("writes nothing through a source of another clinic or an unknown source", async () => {
    expect(await ingest(SOURCE_A, rowsOf(2), 2)).toEqual({ received: 2, added: 0, duplicates: 2 });
    expect(await ingest(FOREIGN_SOURCE, rowsOf(2), 1)).toEqual({ received: 2, added: 0, duplicates: 2 });
    expect(await ingest(999, rowsOf(2))).toEqual({ received: 2, added: 0, duplicates: 2 });
    expect((await db.query("SELECT id FROM leads")).rows).toEqual([]);
  });

  it("keeps the status and the note set by staff when the sheet is read again", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    const patched = await as("reception", "/1", "PATCH", { status: "no_answer", note: "Перезвонить вечером" });
    expect(patched.status).toBe(200);
    await as("reception", "/1/patient", "PUT", { patientId: 100 });

    // The row changed in the sheet: another name and other columns under the same phone.
    expect(await ingest(SOURCE_A, [{ phone: PHONE, fullName: "Другое имя", extra: { Город: "Самарканд" } }])).toEqual({ received: 1, added: 0, duplicates: 1 });
    expect(await leadRow(1)).toEqual({
      clinic_id: 1, source_id: SOURCE_A, external_key: `p:${PHONE}`, full_name: NAME, phone: PHONE,
      extra: { Город: "Ташкент", Услуга: "УЗИ" }, status: "no_answer", note: "Перезвонить вечером", patient_id: 100, staff_updated_by: 2,
    });
  });

  it("inserts in chunks of 500 and never lets a bad row fail the batch", async () => {
    const many = rowsOf(1200);
    expect(await ingest(SOURCE_A, many)).toEqual({ received: 1200, added: 1200, duplicates: 0 });
    expect(leadInserts).toBe(3);
    // A phone that is not canonical is made canonical or dropped; an empty or overlong name cannot break a CHECK.
    const odd = [
      { phone: "+998 90 123-45-67", fullName: "   ", extra: {} },
      { phone: "12345", fullName: "Короткий номер", extra: {} },
      { phone: "998935559999", fullName: "я".repeat(300), extra: {} },
    ];
    // The row with an unusable phone was dropped: it is not a duplicate either.
    expect(await ingest(SOURCE_B, odd)).toEqual({ received: 3, added: 2, duplicates: 0 });
    expect(await ingest(SOURCE_B, odd)).toEqual({ received: 3, added: 0, duplicates: 2 });
    const stored = await db.query<{ phone: string; full_name: string | null }>("SELECT phone, full_name FROM leads WHERE source_id = $1 ORDER BY id", [SOURCE_B]);
    expect(stored.rows).toEqual([{ phone: PHONE, full_name: null }, { phone: "998935559999", full_name: "я".repeat(200) }]);
  });
});

describe("GET /api/leads", () => {
  it("is open to reception, operator, manager and superadmin only", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    for (const who of ["reception", "operator", "manager", "admin"] as const) {
      const res = await as(who, "");
      expect(res.status, who).toBe(200);
      expect(ids(res.body), who).toEqual([1]);
    }
    for (const who of ["director", "doctor", "marketerA", "marketerB", "foreignMarketer"] as const) {
      expect(await as(who, ""), who).toMatchObject({ status: 403, body: { error: "Недостаточно прав для этого действия" } });
    }
  });

  it("returns the lead with its source and never a lead of another clinic", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    await ingest(FOREIGN_SOURCE, rowsOf(2), 2);

    const own = await as("reception", "");
    expect(own.body).toEqual({
      items: [{
        id: 1, createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), fullName: NAME, phone: PHONE, extra: { Город: "Ташкент", Услуга: "УЗИ" },
        status: "new", stage: "new", note: null, sourceId: SOURCE_A, sourceName: "Instagram",
        patientId: null, patientName: null, staffUpdatedAt: null, staffUpdatedByName: null,
      }],
      nextBeforeId: null,
    });
    const foreign = await as("foreignAdmin", "");
    expect(foreign.status).toBe(200);
    expect(ids(foreign.body)).toEqual([3, 2]);
    expect(foreign.text).not.toContain(PHONE);
    // A source id of another clinic is just a filter that matches nothing.
    expect((await as("reception", `?sourceId=${FOREIGN_SOURCE}`)).body).toEqual({ items: [], nextBeforeId: null });
    expect((await as("foreignAdmin", `?sourceId=${SOURCE_A}`)).body).toEqual({ items: [], nextBeforeId: null });
  });

  it("pages by beforeId, newest first", async () => {
    await ingest(SOURCE_A, rowsOf(5));
    const first = await as("operator", "?limit=2");
    expect([ids(first.body), first.body.nextBeforeId]).toEqual([[5, 4], 4]);
    const second = await as("operator", "?limit=2&beforeId=4");
    expect([ids(second.body), second.body.nextBeforeId]).toEqual([[3, 2], 2]);
    const last = await as("operator", "?limit=2&beforeId=2");
    expect([ids(last.body), last.body.nextBeforeId]).toEqual([[1], null]);
    // Exactly one page: no "next" for a page that ends the list.
    expect((await as("operator", "?limit=5")).body.nextBeforeId).toBeNull();
    // The limit is clamped to 200, not refused.
    const clamped = await as("operator", "?limit=5000");
    expect([clamped.status, clamped.body.items.length]).toEqual([200, 5]);
  });

  it("caps a page at 200 leads and at 50 by default", async () => {
    await ingest(SOURCE_A, rowsOf(205));
    const byDefault = await as("manager", "");
    expect([byDefault.body.items.length, byDefault.body.nextBeforeId]).toEqual([50, 156]);
    const capped = await as("manager", "?limit=1000");
    expect([capped.body.items.length, capped.body.nextBeforeId]).toEqual([200, 6]);
  });

  it("filters by source and by stage", async () => {
    await ingest(SOURCE_A, rowsOf(3));
    await ingest(SOURCE_B, rowsOf(2, 10));
    await as("reception", "/2", "PATCH", { status: "in_progress" });
    await as("reception", "/5", "PATCH", { status: "declined" });

    expect(ids((await as("reception", `?sourceId=${SOURCE_B}`)).body)).toEqual([5, 4]);
    expect(ids((await as("reception", "?stage=new")).body)).toEqual([4, 3, 1]);
    expect(ids((await as("reception", "?stage=in_progress")).body)).toEqual([2]);
    expect(ids((await as("reception", `?stage=new&sourceId=${SOURCE_A}`)).body)).toEqual([3, 1]);
    expect(ids((await as("reception", "?stage=visited")).body)).toEqual([]);
    const paged = await as("reception", "?stage=new&limit=2");
    expect([ids(paged.body), paged.body.nextBeforeId]).toEqual([[4, 3], 3]);
    expect(ids((await as("reception", "?stage=new&limit=2&beforeId=3")).body)).toEqual([1]);
  });

  it("answers 400 to a bad filter", async () => {
    for (const query of ["?stage=unknown", "?sourceId=abc", "?sourceId=0", "?beforeId=-1", "?beforeId=1.5", "?limit=0", "?limit=many"]) {
      expect((await as("reception", query)).status, query).toBe(400);
    }
  });
});

describe("PATCH /api/leads/:id", () => {
  beforeEach(async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    await ingest(FOREIGN_SOURCE, rowsOf(1), 2); // lead 2, clinic 2
  });

  it("changes the status and the note and records who did it", async () => {
    const taken = await as("reception", "/1", "PATCH", { status: "in_progress", expectedStatus: "new" });
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({
      id: 1, status: "in_progress", stage: "in_progress", note: null, staffUpdatedByName: "Ресепшен Лола",
      staffUpdatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), fullName: NAME, phone: PHONE, sourceName: "Instagram",
    });

    const noted = await as("operator", "/1", "PATCH", { note: "  Перезвонить вечером  " });
    expect(noted.body).toMatchObject({ status: "in_progress", note: "Перезвонить вечером", staffUpdatedByName: "Оператор Нигора" });
    expect((await as("manager", "/1", "PATCH", { note: "   " })).body).toMatchObject({ note: null, staffUpdatedByName: "Менеджер" });
    expect((await as("admin", "/1", "PATCH", { status: "booked", note: "x".repeat(2000) })).body).toMatchObject({ status: "booked", stage: "booked" });
    expect(await leadRow(1)).toMatchObject({ status: "booked", staff_updated_by: 1 });
  });

  it("answers 400 to a status of 'new', an unknown status and an empty patch", async () => {
    await as("reception", "/1", "PATCH", { status: "in_progress" });
    const bad: unknown[] = [
      { status: "new" }, { status: "visited" }, { status: 5 }, {}, { expectedStatus: "in_progress" }, { note: 5 },
      { note: "x".repeat(2001) }, { status: "declined", expectedStatus: "bogus" }, [],
    ];
    for (const body of bad) {
      expect((await as("reception", "/1", "PATCH", body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await as("reception", "/abc", "PATCH", { status: "declined" })).status).toBe(400);
    expect(await leadRow(1)).toMatchObject({ status: "in_progress", note: null });
  });

  it("answers 409 when a colleague has already changed the status", async () => {
    expect((await as("reception", "/1", "PATCH", { status: "in_progress", expectedStatus: "new" })).status).toBe(200);
    const late = await as("operator", "/1", "PATCH", { status: "declined", note: "Перезвонить", expectedStatus: "new" });
    expect(late).toMatchObject({ status: 409, body: { error: "Статус лида уже изменён другим сотрудником. Обновите список" } });
    expect(await leadRow(1)).toMatchObject({ status: "in_progress", note: null, staff_updated_by: 2 });
    // With the current status the same change goes through.
    expect((await as("operator", "/1", "PATCH", { status: "declined", expectedStatus: "in_progress" })).body).toMatchObject({ status: "declined" });
  });

  it("answers 404 for a lead of another clinic and 403 to roles without leads.update", async () => {
    expect(await as("reception", "/2", "PATCH", { status: "declined" })).toMatchObject({ status: 404, body: { error: "Лид не найден" } });
    expect((await as("foreignAdmin", "/1", "PATCH", { status: "declined", expectedStatus: "new" })).status).toBe(404);
    expect((await as("reception", "/999", "PATCH", { status: "declined" })).status).toBe(404);
    for (const who of ["director", "doctor", "marketerA"] as const) {
      expect((await as(who, "/1", "PATCH", { status: "declined" })).status, who).toBe(403);
    }
    expect(await leadRow(1)).toMatchObject({ status: "new", staff_updated_by: null });
    expect(await leadRow(2)).toMatchObject({ status: "new", staff_updated_by: null });
  });
});

describe("lead and patient", () => {
  beforeEach(async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    await ingest(FOREIGN_SOURCE, [FIXTURE_LEAD], 2); // lead 2, clinic 2
  });

  it("suggests patients of the clinic with the same last 9 digits, newest first", async () => {
    const res = await as("operator", "/1/patient-matches");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: 104, fullName: "Каримов Без кода", phone: "90 123 45 67" },
        { id: 101, fullName: "Каримова Дилноза", phone: "998901234567" },
        { id: 100, fullName: "Каримов Алишер", phone: "+998 90 123-45-67" },
      ],
    });
    // Clinic 2 sees only its own patient for its own lead; a lead of the other clinic is 404 both ways.
    expect((await as("foreignAdmin", "/2/patient-matches")).body).toEqual({ items: [{ id: 200, fullName: "Чужой Пациент", phone: "+998901234567" }] });
    expect((await as("foreignAdmin", "/1/patient-matches")).status).toBe(404);
    expect((await as("operator", "/2/patient-matches")).status).toBe(404);
  });

  it("returns at most 5 matches", async () => {
    await db.exec(`INSERT INTO patients (id, clinic_id, full_name, phone) VALUES
      (110, 1, 'Двойник 1', '901234567'), (111, 1, 'Двойник 2', '901234567'), (112, 1, 'Двойник 3', '901234567')`);
    expect(ids((await as("reception", "/1/patient-matches")).body)).toEqual([112, 111, 110, 104, 101]);
  });

  it("needs both leads access and patients access", async () => {
    // director reads patients but not leads; the marketer reads neither.
    for (const who of ["director", "doctor", "marketerA"] as const) {
      expect((await as(who, "/1/patient-matches")).status, who).toBe(403);
      expect((await as(who, "/1/patient", "PUT", { patientId: 100 })).status, who).toBe(403);
    }
    expect(await leadRow(1)).toMatchObject({ patient_id: null, status: "new" });
  });

  it("links a patient, moving a new lead to 'in_progress', and unlinks", async () => {
    const linked = await as("reception", "/1/patient", "PUT", { patientId: 100 });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({
      id: 1, patientId: 100, patientName: "Каримов Алишер", status: "in_progress", stage: "in_progress", staffUpdatedByName: "Ресепшен Лола",
    });

    // Another status is not touched by a link.
    await as("reception", "/1", "PATCH", { status: "no_answer" });
    expect((await as("operator", "/1/patient", "PUT", { patientId: 101 })).body).toMatchObject({ patientId: 101, patientName: "Каримова Дилноза", status: "no_answer" });

    const unlinked = await as("manager", "/1/patient", "PUT", { patientId: null });
    expect(unlinked.body).toMatchObject({ patientId: null, patientName: null, status: "no_answer", staffUpdatedByName: "Менеджер" });
    expect(await leadRow(1)).toMatchObject({ patient_id: null, staff_updated_by: 4 });
  });

  it("answers 404 for a patient or a lead outside the clinic", async () => {
    expect(await as("reception", "/1/patient", "PUT", { patientId: 200 })).toMatchObject({ status: 404, body: { error: "Пациент не найден" } });
    expect((await as("reception", "/1/patient", "PUT", { patientId: 103 })).status).toBe(404); // deleted patient
    expect((await as("reception", "/1/patient", "PUT", { patientId: 999 })).status).toBe(404);
    expect(await as("reception", "/2/patient", "PUT", { patientId: 100 })).toMatchObject({ status: 404, body: { error: "Лид не найден" } });
    expect((await as("foreignAdmin", "/1/patient", "PUT", { patientId: 200 })).status).toBe(404);
    expect((await as("foreignAdmin", "/1/patient", "PUT", { patientId: null })).status).toBe(404);
    for (const body of [{}, { patientId: "100" }, { patientId: 0 }, { patientId: 1.5 }]) {
      expect((await as("reception", "/1/patient", "PUT", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await leadRow(1)).toMatchObject({ patient_id: null, status: "new", staff_updated_by: null });
    expect(await leadRow(2)).toMatchObject({ patient_id: null, status: "new" });
  });

  it("derives 'booked' and 'visited' from the linked patient's appointments made after the lead", async () => {
    const stage = async () => (await as("reception", "")).body.items[0].stage as string;
    await as("reception", "/1", "PATCH", { status: "no_answer" });
    // Appointments of a patient who is not linked mean nothing.
    await appointment(1, 100, "completed", "-1 day");
    expect(await stage()).toBe("no_answer");

    await as("reception", "/1/patient", "PUT", { patientId: 100 });
    // Made before the lead came: ignored. Of another clinic's patient with the same id: ignored. Deleted: ignored.
    expect(await stage()).toBe("no_answer");
    await appointment(1, 100, "completed", "1 second", 2);
    const removed = await appointment(1, 100, "scheduled");
    await db.query("UPDATE appointments SET deleted_at = now() WHERE id = $1", [removed]);
    expect(await stage()).toBe("no_answer");

    const visit = await appointment(1, 100, "scheduled");
    expect(await stage()).toBe("booked");
    expect(ids((await as("reception", "?stage=booked")).body)).toEqual([1]);
    expect(ids((await as("reception", "?stage=no_answer")).body)).toEqual([]);
    await db.query("UPDATE appointments SET status = 'confirmed' WHERE id = $1", [visit]);
    expect(await stage()).toBe("booked");

    for (const status of ["arrived", "in_consultation", "completed"]) {
      await db.query("UPDATE appointments SET status = $2 WHERE id = $1", [visit, status]);
      expect(await stage(), status).toBe("visited");
    }
    // A visit wins over a later upcoming appointment.
    await appointment(1, 100, "scheduled", "2 seconds");
    expect(await stage()).toBe("visited");
    expect(ids((await as("reception", "?stage=visited")).body)).toEqual([1]);
    // The stored status stays what staff set.
    expect((await as("reception", "")).body.items[0]).toMatchObject({ status: "no_answer", stage: "visited" });

    // Only cancelled and missed appointments: back to the stored status.
    await db.query("UPDATE appointments SET status = 'cancelled' WHERE deleted_at IS NULL AND clinic_id = 1 AND created_at >= (SELECT created_at FROM leads WHERE id = 1)");
    expect(await stage()).toBe("no_answer");
    await appointment(1, 100, "no_show");
    expect(await stage()).toBe("no_answer");
    // Unlinking drops the derived stage at once.
    await appointment(1, 100, "completed");
    expect(await stage()).toBe("visited");
    await as("reception", "/1/patient", "PUT", { patientId: null });
    expect(await stage()).toBe("no_answer");
  });

  it("shows a lead whose patient was deleted afterwards as not linked, and keeps the stored link", async () => {
    await as("reception", "/1", "PATCH", { status: "no_answer" });
    await as("reception", "/1/patient", "PUT", { patientId: 100 });
    await appointment(1, 100, "completed");
    const shown = { patientId: 100, patientName: "Каримов Алишер", status: "no_answer", stage: "visited" };
    expect((await as("reception", "")).body.items[0]).toMatchObject(shown);
    expect((await as("marketerA", "/mine")).body.items[0].stage).toBe("visited");

    await db.query("UPDATE patients SET deleted_at = now() WHERE id = 100");
    const hidden = { patientId: null, patientName: null, status: "no_answer", stage: "no_answer" };
    // The staff list, its stage filter, the single lead (the answer of a PATCH) and the contractor's list.
    expect((await as("reception", "")).body.items[0]).toMatchObject(hidden);
    expect(ids((await as("reception", "?stage=visited")).body)).toEqual([]);
    expect(ids((await as("reception", "?stage=no_answer")).body)).toEqual([1]);
    expect((await as("reception", "/1", "PATCH", { note: "Перезвонить вечером" })).body).toMatchObject(hidden);
    expect((await as("marketerA", "/mine")).body.items[0].stage).toBe("no_answer");
    // Only what is returned changes: the row keeps its patient, and a restored patient is linked again.
    expect(await leadRow(1)).toMatchObject({ patient_id: 100, status: "no_answer" });
    await db.query("UPDATE patients SET deleted_at = NULL WHERE id = 100");
    expect((await as("reception", "")).body.items[0]).toMatchObject(shown);
  });
});

describe("lead sources", () => {
  const MANAGE_SHAPE = {
    id: expect.any(Number), name: "Telegram", marketerUserId: 7, marketerName: "Таргетолог А", sheetUrl: buildSheetUrl(SHEET_ID, 0),
    columnMap: null, syncEnabled: false, lastSyncAt: null, lastSyncStatus: null, lastSyncRows: null, lastSyncSkipped: null,
    leadsCount: 0, createdAt: expect.stringMatching(/Z$/), updatedAt: expect.stringMatching(/Z$/),
  };

  it("lists id and name of the clinic's sources for everyone who reads leads", async () => {
    const expected = { items: [{ id: SOURCE_A, name: "Instagram" }, { id: SOURCE_B, name: "Facebook" }] };
    for (const who of ["reception", "operator", "manager", "admin"] as const) {
      expect(await as(who, "/sources"), who).toMatchObject({ status: 200, body: expected });
    }
    expect((await as("reception", "/sources")).body).toEqual(expected);
    expect((await as("foreignAdmin", "/sources")).body).toEqual({ items: [{ id: FOREIGN_SOURCE, name: "Чужой источник" }] });
    for (const who of ["director", "doctor", "marketerA"] as const) {
      expect((await as(who, "/sources")).status, who).toBe(403);
    }
  });

  it("lets only superadmin manage sources", async () => {
    for (const who of ["manager", "reception", "operator", "director", "marketerA"] as const) {
      expect((await as(who, "/sources/manage")).status, who).toBe(403);
      expect((await as(who, "/sources", "POST", { name: "Telegram" })).status, who).toBe(403);
      expect((await as(who, `/sources/${SOURCE_A}`, "PATCH", { name: "Telegram" })).status, who).toBe(403);
    }
    expect((await db.query<{ name: string }>("SELECT name FROM lead_sources ORDER BY id")).rows.map((row) => row.name)).toEqual(["Instagram", "Facebook", "Чужой источник"]);
  });

  it("shows the manager view: sources with binding, sheet and lead count, and the marketers that can be bound", async () => {
    await ingest(SOURCE_A, rowsOf(2));
    const res = await as("admin", "/sources/manage");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { ...MANAGE_SHAPE, id: SOURCE_A, name: "Instagram", sheetUrl: null, leadsCount: 2 },
      { ...MANAGE_SHAPE, id: SOURCE_B, name: "Facebook", marketerUserId: 8, marketerName: "Таргетолог Б", sheetUrl: null },
    ]);
    // Only active, not deleted marketers of this clinic.
    expect(res.body.marketers).toEqual([
      { id: 7, fullName: "Таргетолог А", username: "marketerA" },
      { id: 8, fullName: "Таргетолог Б", username: "marketerB" },
    ]);
    const foreign = await as("foreignAdmin", "/sources/manage");
    expect(foreign.body.items.map((item: { id: number }) => item.id)).toEqual([FOREIGN_SOURCE]);
    expect(foreign.body.marketers).toEqual([{ id: 21, fullName: "Чужой таргетолог", username: "foreignMarketer" }]);
  });

  it("creates a source from a pasted sheet link", async () => {
    const created = await as("admin", "/sources", "POST", { name: "  Telegram  ", marketerUserId: 7, sheetUrl: `${SHEET_LINK}#gid=0` });
    expect(created.status).toBe(201);
    expect(created.body).toEqual(MANAGE_SHAPE);
    expect((await db.query("SELECT clinic_id, spreadsheet_id, sheet_gid, created_by FROM lead_sources WHERE id = $1", [created.body.id])).rows)
      .toEqual([{ clinic_id: 1, spreadsheet_id: SHEET_ID, sheet_gid: 0, created_by: 1 }]);

    // Name alone is enough; a bare id and another tab are understood too.
    expect((await as("admin", "/sources", "POST", { name: "Без таблицы" })).body).toMatchObject({ marketerUserId: null, marketerName: null, sheetUrl: null });
    expect((await as("admin", "/sources", "POST", { name: "Только id", sheetUrl: SHEET_ID })).body.sheetUrl).toBe(buildSheetUrl(SHEET_ID, 0));
    const tab = await as("foreignAdmin", "/sources", "POST", { name: "Лист 2", marketerUserId: 21, sheetUrl: `${SHEET_LINK}&gid=77` });
    expect(tab.body).toMatchObject({ marketerUserId: 21, sheetUrl: buildSheetUrl(SHEET_ID, 77) });
    expect((await db.query("SELECT clinic_id FROM lead_sources WHERE id = $1", [tab.body.id])).rows).toEqual([{ clinic_id: 2 }]);
  });

  it("answers 400 to a bad name and 422 to a marketer that cannot be bound or a link that is not a sheet", async () => {
    const post = (body: unknown) => as("admin", "/sources", "POST", body);
    for (const body of [{}, { name: "   " }, { name: "x".repeat(101) }, { name: 5 }, { name: "Ок", marketerUserId: "7" }, { name: "Ок", sheetUrl: 5 }]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    // 2 — reception, 9 — switched off, 10 — deleted, 21 — marketer of clinic 2, 999 — nobody.
    for (const marketerUserId of [2, 9, 10, 21, 999]) {
      expect(await post({ name: "Ок", marketerUserId }), String(marketerUserId))
        .toEqual(expect.objectContaining({ status: 422, body: { error: "Таргетолог не найден среди активных аккаунтов клиники" } }));
      expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { marketerUserId })).status, String(marketerUserId)).toBe(422);
    }
    for (const sheetUrl of ["https://example.com/spreadsheets/d/" + SHEET_ID, "не ссылка", "", "https://docs.google.com/document/d/" + SHEET_ID]) {
      expect((await post({ name: "Ок", sheetUrl })).status, sheetUrl).toBe(422);
      expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { sheetUrl })).status, sheetUrl).toBe(422);
    }
    expect((await post({ name: "x".repeat(100) })).status).toBe(201);
    expect((await db.query("SELECT marketer_user_id, spreadsheet_id FROM lead_sources WHERE id = $1", [SOURCE_A])).rows)
      .toEqual([{ marketer_user_id: 7, spreadsheet_id: null }]);
  });

  it("answers 400, not 500, to a control character in a source name or in a column header", async () => {
    // PostgreSQL stores no NUL in text or jsonb: without the check the statement fails and the answer is 500.
    for (const name of ["Insta\u0000gram", "\u0000", "Insta\u0007gram", "Insta\ngram", "Insta\u007fgram"]) {
      const label = JSON.stringify(name);
      expect(await as("admin", "/sources", "POST", { name }), label)
        .toMatchObject({ status: 400, body: { error: "Название источника не должно содержать управляющих символов" } });
      expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { name })).status, label).toBe(400);
    }
    const columnMaps = [
      { phone: "Теле\u0000фон", name: null }, { phone: "Телефон", name: "И\u0000мя" }, { phone: "\u0000", name: null },
      { phone: "Теле\u001bфон", name: null },
    ];
    for (const columnMap of columnMaps) {
      const res = await as("admin", `/sources/${SOURCE_A}`, "PATCH", { columnMap });
      expect(res, JSON.stringify(columnMap)).toMatchObject({ status: 400, body: { error: expect.stringContaining("columnMap") } });
      // The value is not repeated in the answer.
      expect(res.text).not.toMatch(/[\u0000-\u001f]|\\u00/);
    }
    expect((await db.query("SELECT name, column_map FROM lead_sources ORDER BY id")).rows).toEqual([
      { name: "Instagram", column_map: null }, { name: "Facebook", column_map: null }, { name: "Чужой источник", column_map: null },
    ]);

    // White space at the edges of a name is trimmed as before; a header cell of two lines can still be chosen.
    expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { name: "\tИнста\n" })).body).toMatchObject({ name: "Инста" });
    expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { columnMap: { phone: "Номер\nтелефона", name: null } })).body)
      .toMatchObject({ columnMap: { phone: "Номер\nтелефона", name: null } });
  });

  it("patches only the fields that are sent", async () => {
    const renamed = await as("admin", `/sources/${SOURCE_A}`, "PATCH", { name: " Инста " });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: SOURCE_A, name: "Инста", marketerUserId: 7, sheetUrl: null, syncEnabled: false });
    expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { marketerUserId: 8 })).body).toMatchObject({ name: "Инста", marketerUserId: 8, marketerName: "Таргетолог Б" });
    expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { marketerUserId: null })).body).toMatchObject({ marketerUserId: null, marketerName: null });

    for (const body of [{ name: "" }, { syncEnabled: "yes" }, { columnMap: "Телефон" }, { columnMap: { phone: "" } }, { columnMap: { phone: "x".repeat(201), name: null } },
      { columnMap: { phone: "Телефон", name: 5 } }, { columnMap: { phone: "Телефон", name: "x".repeat(201) } }, { columnMap: ["Телефон"] }]) {
      expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(await as("admin", "/sources/999", "PATCH", { name: "Нет" })).toMatchObject({ status: 404, body: { error: "Источник не найден" } });
    expect((await as("admin", "/sources/abc", "PATCH", { name: "Нет" })).status).toBe(400);
    // A source of another clinic does not exist for this superadmin, in both directions.
    expect((await as("foreignAdmin", `/sources/${SOURCE_A}`, "PATCH", { name: "Чужой" })).status).toBe(404);
    expect((await as("admin", `/sources/${FOREIGN_SOURCE}`, "PATCH", { marketerUserId: 7 })).status).toBe(404);
    expect((await db.query("SELECT name, marketer_user_id FROM lead_sources ORDER BY id")).rows).toEqual([
      { name: "Инста", marketer_user_id: null }, { name: "Facebook", marketer_user_id: 8 }, { name: "Чужой источник", marketer_user_id: 21 },
    ]);
  });

  it("switches reading on only for a source with a sheet", async () => {
    const path = `/sources/${SOURCE_A}`;
    expect(await as("admin", path, "PATCH", { syncEnabled: true }))
      .toMatchObject({ status: 422, body: { error: "Сначала укажите ссылку на таблицу" } });
    expect((await as("admin", path, "PATCH", { syncEnabled: true, sheetUrl: null })).status).toBe(422);
    expect((await as("admin", path, "PATCH", { syncEnabled: false })).body).toMatchObject({ syncEnabled: false });

    // The link and the switch may come in one request.
    expect((await as("admin", path, "PATCH", { sheetUrl: SHEET_LINK, syncEnabled: true })).body)
      .toMatchObject({ sheetUrl: buildSheetUrl(SHEET_ID, 0), syncEnabled: true });
    expect((await as("admin", path, "PATCH", { syncEnabled: false })).body).toMatchObject({ syncEnabled: false, sheetUrl: buildSheetUrl(SHEET_ID, 0) });
    expect((await as("admin", path, "PATCH", { syncEnabled: true })).body).toMatchObject({ syncEnabled: true });
    // Clearing the sheet switches reading off.
    expect((await as("admin", path, "PATCH", { sheetUrl: null })).body).toMatchObject({ sheetUrl: null, syncEnabled: false });
  });

  it("resets the column map and the last read when the sheet changes, and keeps them when it does not", async () => {
    const path = `/sources/${SOURCE_A}`;
    await as("admin", path, "PATCH", { sheetUrl: SHEET_LINK, syncEnabled: true });
    const mapped = await as("admin", path, "PATCH", { columnMap: { phone: " Номер клиента ", name: null } });
    expect(mapped.body).toMatchObject({ columnMap: { phone: "Номер клиента", name: null } });
    await repository.recordSync(1, SOURCE_A, "ok", 12, 3);

    // The form sends the same link again with the name: nothing is reset.
    const same = await as("admin", path, "PATCH", { name: "Instagram 2", marketerUserId: 7, sheetUrl: `${SHEET_LINK}#gid=0` });
    expect(same.body).toMatchObject({
      name: "Instagram 2", columnMap: { phone: "Номер клиента", name: null }, syncEnabled: true,
      lastSyncStatus: "ok", lastSyncRows: 12, lastSyncSkipped: 3, lastSyncAt: expect.stringMatching(/Z$/),
    });

    // Another tab of the same file is another sheet.
    const moved = await as("admin", path, "PATCH", { sheetUrl: `${SHEET_LINK}#gid=5` });
    expect(moved.body).toMatchObject({
      sheetUrl: buildSheetUrl(SHEET_ID, 5), columnMap: null, syncEnabled: true,
      lastSyncAt: null, lastSyncStatus: null, lastSyncRows: null, lastSyncSkipped: null,
    });

    await as("admin", path, "PATCH", { columnMap: { phone: "Телефон", name: "Имя" } });
    await repository.recordSync(1, SOURCE_A, "columns_not_found", null, null);
    const cleared = await as("admin", path, "PATCH", { sheetUrl: null });
    expect(cleared.body).toMatchObject({ sheetUrl: null, columnMap: null, syncEnabled: false, lastSyncAt: null, lastSyncStatus: null });
    expect((await as("admin", path, "PATCH", { columnMap: null })).body).toMatchObject({ columnMap: null });
  });

  it("gives the sheet reader its sources with the clinic of each, and records a read inside one clinic", async () => {
    expect(await repository.listSyncEnabledSources()).toEqual([]);
    await as("admin", `/sources/${SOURCE_A}`, "PATCH", { sheetUrl: `${SHEET_LINK}#gid=5`, syncEnabled: true });
    await as("admin", `/sources/${SOURCE_A}`, "PATCH", { columnMap: { phone: "Телефон", name: "Имя" } });
    await as("admin", `/sources/${SOURCE_B}`, "PATCH", { sheetUrl: SHEET_LINK });
    await as("foreignAdmin", `/sources/${FOREIGN_SOURCE}`, "PATCH", { sheetUrl: SHEET_ID, syncEnabled: true });

    // Source B has a sheet but reading is off.
    expect(await repository.listSyncEnabledSources()).toEqual([
      { clinicId: 1, id: SOURCE_A, spreadsheetId: SHEET_ID, gid: 5, columnMap: { phone: "Телефон", name: "Имя" } },
      { clinicId: 2, id: FOREIGN_SOURCE, spreadsheetId: SHEET_ID, gid: 0, columnMap: null },
    ]);

    expect(await repository.findSource(2, SOURCE_A)).toBeNull();
    expect(await repository.findSource(1, 999)).toBeNull();
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({
      id: SOURCE_A, clinicId: 1, name: "Instagram", spreadsheetId: SHEET_ID, gid: 5, columnMap: { phone: "Телефон", name: "Имя" }, syncEnabled: true,
    });

    // A read recorded with the wrong clinic changes nothing.
    await repository.recordSync(2, SOURCE_A, "no_access", null, null);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null });
    await repository.recordSync(1, SOURCE_A, "ok", 40, 2);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncStatus: "ok", lastSyncRows: 40, lastSyncSkipped: 2, lastSyncAt: expect.stringMatching(/Z$/) });
    await repository.recordSync(1, SOURCE_A, "no_access", null, null);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncStatus: "no_access", lastSyncRows: null, lastSyncSkipped: null });
    expect(await repository.findSource(2, FOREIGN_SOURCE)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null });
  });
});

describe("sheet check and read of a source", () => {
  // Two rows with a usable phone and one without.
  const SHEET_CSV = ["Имя,Телефон,Город", `${NAME},+998 90 123-45-67,Ташкент`, "Дилноза,998935550001,", "Гость,,Бухара"].join("\r\n");
  const ACTIONS = ["check", "sync"] as const;
  const leadIds = async () => (await db.query<{ id: number }>("SELECT id FROM leads ORDER BY id")).rows.map((row) => Number(row.id));

  beforeEach(async () => {
    await as("admin", `/sources/${SOURCE_A}`, "PATCH", { sheetUrl: `${SHEET_LINK}#gid=7` });
    await as("foreignAdmin", `/sources/${FOREIGN_SOURCE}`, "PATCH", { sheetUrl: SHEET_LINK });
    sheet.answer = { status: "ok", text: SHEET_CSV };
  });

  it("checks the sheet for the superadmin and writes nothing", async () => {
    const res = await as("admin", `/sources/${SOURCE_A}/check`, "POST");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok", headers: ["Имя", "Телефон", "Город"], detected: { phone: "Телефон", name: "Имя" }, rows: 3, valid: 2, skipped: 1,
    });
    // The tab of the stored link is the one that is read.
    expect(sheet.calls).toEqual([[SHEET_ID, 7]]);
    expect(leadInserts).toBe(0);
    expect(await leadIds()).toEqual([]);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null, lastSyncRows: null });
  });

  it("reads the sheet now for the superadmin: the leads go to the clinic of the source, the result is stored on it", async () => {
    const res = await as("admin", `/sources/${SOURCE_A}/sync`, "POST");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", rows: 3, added: 2, duplicates: 0, skipped: 1 });
    expect((await as("admin", `/sources/${SOURCE_A}/sync`, "POST")).body).toEqual({ status: "ok", rows: 3, added: 0, duplicates: 2, skipped: 1 });
    expect(sheet.calls).toEqual([[SHEET_ID, 7], [SHEET_ID, 7]]);

    const list = await as("reception", "");
    expect(list.body.items.map((lead: { id: number; fullName: string; phone: string; sourceName: string; status: string }) =>
      [lead.id, lead.fullName, lead.phone, lead.sourceName, lead.status]
    )).toEqual([[2, "Дилноза", "998935550001", "Instagram", "new"], [1, NAME, PHONE, "Instagram", "new"]]);
    expect(list.body.items[1].extra).toEqual({ Город: "Ташкент" });
    expect(ids((await as("marketerA", "/mine")).body)).toEqual([2, 1]);
    expect((await as("foreignAdmin", "")).body.items).toEqual([]);
    expect((await as("admin", "/sources/manage")).body.items[0]).toMatchObject({
      id: SOURCE_A, leadsCount: 2, lastSyncStatus: "ok", lastSyncRows: 3, lastSyncSkipped: 1, lastSyncAt: expect.stringMatching(/Z$/),
    });
    expect(await repository.findSource(2, FOREIGN_SOURCE)).toMatchObject({ lastSyncAt: null, leadsCount: 0 });
  });

  it("answers 200 with the code of the read when the sheet cannot be read", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    sheet.answer = { status: "no_access" };
    expect(await as("admin", `/sources/${SOURCE_A}/check`, "POST")).toMatchObject({
      status: 200, body: { status: "no_access", headers: [], detected: { phone: null, name: null }, rows: 0, valid: 0, skipped: 0 },
    });
    expect(await as("admin", `/sources/${SOURCE_A}/sync`, "POST")).toMatchObject({
      status: 200, body: { status: "no_access", rows: 0, added: 0, duplicates: 0, skipped: 0 },
    });
    expect((await as("admin", "/sources/manage")).body.items[0]).toMatchObject({ lastSyncStatus: "no_access", lastSyncRows: null, leadsCount: 1 });
    expect(await leadIds()).toEqual([1]);
  });

  it("is closed to everyone but the superadmin", async () => {
    for (const who of ["manager", "reception", "operator", "director", "doctor", "marketerA", "marketerB"] as const) {
      for (const action of ACTIONS) {
        expect((await as(who, `/sources/${SOURCE_A}/${action}`, "POST")).status, `${who} ${action}`).toBe(403);
      }
    }
    expect(sheet.calls).toEqual([]);
    expect(await leadIds()).toEqual([]);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null });
  });

  it("answers 404 for a source of another clinic, 422 for a source without a sheet and 400 for a bad id", async () => {
    for (const action of ACTIONS) {
      expect(await as("foreignAdmin", `/sources/${SOURCE_A}/${action}`, "POST"), action)
        .toMatchObject({ status: 404, body: { error: "Источник не найден" } });
      expect((await as("admin", `/sources/${FOREIGN_SOURCE}/${action}`, "POST")).status, action).toBe(404);
      expect((await as("admin", `/sources/999/${action}`, "POST")).status, action).toBe(404);
      expect(await as("admin", `/sources/${SOURCE_B}/${action}`, "POST"), action)
        .toMatchObject({ status: 422, body: { error: "Сначала укажите ссылку на таблицу" } });
      expect((await as("admin", `/sources/abc/${action}`, "POST")).status, action).toBe(400);
    }
    // Nothing was fetched and nothing was written, in either clinic.
    expect(sheet.calls).toEqual([]);
    expect(await leadIds()).toEqual([]);
    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null });
    expect(await repository.findSource(2, FOREIGN_SOURCE)).toMatchObject({ lastSyncAt: null, lastSyncStatus: null });
  });
});

describe("clinic scope of the repository", () => {
  it("does not read or write a lead or a source through another clinic's id", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    expect(await repository.getLead(2, 1)).toBeNull();
    expect(await repository.listLeads(2, { stage: null, sourceId: SOURCE_A, beforeId: null, limit: 10 })).toEqual([]);
    expect(await repository.listMarketerLeads(2, 7, { beforeId: null, limit: 10 })).toEqual([]);
    expect(await repository.updateLead(2, 1, { status: "declined", note: "x" }, null, 20)).toBe("not_found");
    expect(await repository.updateLead(2, 1, { status: "declined" }, "new", 20)).toBe("not_found");
    expect(await repository.setLeadPatient(2, 1, 200, 20)).toBe("not_found");
    expect(await repository.setLeadPatient(2, 1, null, 20)).toBe("not_found");
    expect(await repository.insertLeads(2, SOURCE_A, [{ externalKey: "p:998935550002", fullName: null, phone: "998935550002", extra: {} }])).toBe(0);
    const foreignChange = { name: "Чужое имя", marketerUserId: 21, sheet: { spreadsheetId: SHEET_ID, gid: 0 }, syncEnabled: true };
    expect(await repository.updateSource(2, SOURCE_A, foreignChange)).toBeNull();
    expect(await repository.isBindableMarketer(2, 7)).toBe(false);
    expect(await repository.isBindableMarketer(1, 7)).toBe(true);
    expect(await repository.findPatientMatches(2, PHONE)).toEqual([{ id: 200, fullName: "Чужой Пациент", phone: "+998901234567" }]);

    expect(await repository.findSource(1, SOURCE_A)).toMatchObject({ name: "Instagram", marketerUserId: 7, spreadsheetId: null, syncEnabled: false });
    expect(await leadRow(1)).toMatchObject({ status: "new", note: null, patient_id: null, staff_updated_by: null });
    expect((await db.query("SELECT id FROM leads")).rows).toHaveLength(1);
  });
});

describe("GET /api/leads/mine", () => {
  beforeEach(async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD, ...rowsOf(2)]); // leads 1-3, marketer A
    await ingest(SOURCE_B, rowsOf(2, 10)); // leads 4-5, marketer B
    await ingest(FOREIGN_SOURCE, [FIXTURE_LEAD], 2); // lead 6, clinic 2
  });

  it("shows a marketer only the leads of the sources bound to them", async () => {
    const mine = await as("marketerA", "/mine");
    expect(mine.status).toBe(200);
    expect(ids(mine.body)).toEqual([3, 2, 1]);
    expect(mine.body.nextBeforeId).toBeNull();
    expect(ids((await as("marketerB", "/mine")).body)).toEqual([5, 4]);
    expect(ids((await as("foreignMarketer", "/mine")).body)).toEqual([6]);
    // Neither a source nor a clinic can be asked for.
    expect(ids((await as("marketerA", `/mine?sourceId=${SOURCE_B}&clinicId=2`)).body)).toEqual([3, 2, 1]);
  });

  it("returns exactly the allowed fields and nothing staff wrote", async () => {
    await as("reception", "/1", "PATCH", { status: "no_answer", note: "Перезвонить вечером" });
    await as("reception", "/1/patient", "PUT", { patientId: 100 });
    const mine = await as("marketerA", "/mine");
    for (const item of mine.body.items) {
      expect(Object.keys(item).sort()).toEqual(["fullName", "id", "phone", "receivedAt", "sourceName", "stage"]);
    }
    expect(mine.body.items[2]).toEqual({
      id: 1, receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), fullName: NAME, phone: PHONE, sourceName: "Instagram", stage: "no_answer",
    });
    for (const hidden of ["Перезвонить", "Ташкент", "УЗИ", "Каримов", "Ресепшен", "patient", "note", "extra", "staff"]) {
      expect(mine.text, hidden).not.toContain(hidden);
    }
  });

  it("shows 'visited' and 'booked' for the marketer's own leads", async () => {
    await as("reception", "/1/patient", "PUT", { patientId: 100 });
    await as("reception", "/2/patient", "PUT", { patientId: 102 });
    await appointment(1, 100, "completed");
    await appointment(2, 102, "scheduled");
    const stages = (await as("marketerA", "/mine")).body.items.map((item: { id: number; stage: string }) => [item.id, item.stage]);
    expect(stages).toEqual([[3, "new"], [2, "booked"], [1, "visited"]]);
  });

  it("empties the list at once when the source is unbound, with the same token", async () => {
    expect(ids((await as("marketerA", "/mine")).body)).toEqual([3, 2, 1]);
    expect((await as("admin", `/sources/${SOURCE_A}`, "PATCH", { marketerUserId: null })).status).toBe(200);
    expect((await as("marketerA", "/mine")).body).toEqual({ items: [], nextBeforeId: null });
    // Bound to the other marketer, the leads move to that marketer's list.
    await as("admin", `/sources/${SOURCE_A}`, "PATCH", { marketerUserId: 8 });
    expect(ids((await as("marketerB", "/mine")).body)).toEqual([5, 4, 3, 2, 1]);
    expect((await as("marketerA", "/mine")).body.items).toEqual([]);
  });

  it("pages by beforeId and validates the query", async () => {
    const first = await as("marketerA", "/mine?limit=2");
    expect([ids(first.body), first.body.nextBeforeId]).toEqual([[3, 2], 2]);
    const rest = await as("marketerA", "/mine?limit=2&beforeId=2");
    expect([ids(rest.body), rest.body.nextBeforeId]).toEqual([[1], null]);
    expect((await as("marketerA", "/mine?beforeId=abc")).status).toBe(400);
    expect((await as("marketerA", "/mine?limit=0")).status).toBe(400);
  });

  it("is closed to everyone but the marketer, superadmin included", async () => {
    for (const who of ["admin", "reception", "operator", "manager", "director", "doctor", "foreignAdmin"] as const) {
      expect((await as(who, "/mine")).status, who).toBe(403);
    }
  });

  it("answers 401 to a marketer whose account was switched off", async () => {
    await db.exec("UPDATE users SET is_active = false WHERE id = 7");
    expect((await as("marketerA", "/mine")).status).toBe(401);
    expect((await as("marketerB", "/mine")).status).toBe(200);
  });
});

describe("error bodies", () => {
  it("carry fixed texts: no phone, no name, no sheet id", async () => {
    await ingest(SOURCE_A, [FIXTURE_LEAD]);
    await as("admin", `/sources/${SOURCE_A}`, "PATCH", { sheetUrl: SHEET_LINK });
    await as("reception", "/1", "PATCH", { status: "in_progress", note: "Перезвонить вечером" });
    const before = checkedErrorBodies;
    const answers = [
      await as("reception", "/1", "PATCH", { status: "new", note: `Перезвонить ${NAME} ${PHONE}` }),
      await as("reception", "/1", "PATCH", { status: "declined", expectedStatus: "new", note: `${NAME} ${PHONE}` }),
      await as("reception", "/1", "PATCH", { note: `${PHONE} `.repeat(200) }),
      await as("foreignAdmin", "/1", "PATCH", { note: PHONE }),
      await as("reception", "/1/patient", "PUT", { patientId: 200 }),
      await as("foreignAdmin", "/1/patient-matches"),
      await as("marketerA", "/1", "PATCH", { note: PHONE }),
      await as("admin", "/sources", "POST", { name: NAME, sheetUrl: `https://example.com/${SHEET_ID}` }),
      await as("admin", "/sources", "POST", { name: NAME, marketerUserId: 2, sheetUrl: SHEET_LINK }),
      await as("admin", `/sources/${SOURCE_B}`, "PATCH", { syncEnabled: true, name: NAME }),
      await as("admin", `/sources/${SOURCE_A}`, "PATCH", { columnMap: { phone: PHONE.repeat(20), name: NAME } }),
      await as("reception", `?stage=${PHONE}`),
      await as("reception", `?sourceId=${PHONE}x`),
    ];
    expect(answers.map((answer) => [answer.status, answer.body])).toEqual([
      [400, { error: "Статус лида: in_progress, no_answer, booked, declined, invalid" }],
      [409, { error: "Статус лида уже изменён другим сотрудником. Обновите список" }],
      [400, { error: "Заметка: не длиннее 2000 символов" }],
      [404, { error: "Лид не найден" }],
      [404, { error: "Пациент не найден" }],
      [404, { error: "Лид не найден" }],
      [403, { error: "Недостаточно прав для этого действия" }],
      [422, { error: "Не удалось распознать ссылку на Google-таблицу" }],
      [422, { error: "Таргетолог не найден среди активных аккаунтов клиники" }],
      [422, { error: "Сначала укажите ссылку на таблицу" }],
      [400, { error: "Поле 'columnMap': заголовок колонки телефона (до 200 символов) и заголовок колонки имени или null" }],
      [400, { error: "Неизвестный статус лида в фильтре" }],
      [400, { error: "Поле 'sourceId' должно быть положительным целым числом" }],
    ]);
    // The helper has looked into each of these bodies for the fixture phone, the names and the sheet id.
    expect(checkedErrorBodies - before).toBe(answers.length);
  });
});
