import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-appointments-queue-tests-only" } }));
vi.mock("../../container", () => ({ services: { get appointments() { return svc; } } }));
// BOTH query and connect go through the gated pool: a pool query issued while a transaction client is
// checked out would wait for the gate forever, so these tests also prove the transactions use only `client`.
vi.mock("../../config/database", () => ({ dbPool: {
  query: (sql: string, params?: unknown[]) => pool.query(sql, params),
  connect: () => pool.connect(),
} }));
import { PostgresAppointmentsRepository } from "./PostgresAppointmentsRepository";
import { allocateQueueNumber } from "./queueAllocation";
import { AppointmentsService } from "../../services/appointmentsService";
import { appointmentsRouter } from "../../routes/appointmentsRoutes";
import { errorHandler } from "../../middleware/errorHandler";
import { signAccessToken } from "../../utils/jwt";
import { runWithClinicContext } from "../../tenancy/clinicContext";

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
const pool = {
  async query(sql: string, params?: unknown[]) {
    const release = await acquire();
    try { return await db.query(sql, params); } finally { release(); }
  },
  async connect() {
    const release = await acquire();
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release };
  },
};

const TODAY = "2026-09-30";
const YESTERDAY = "2026-09-29";
// 06:00 UTC = 11:00 in Tashkent: the clinic day is TODAY whatever the real date is.
const repo = new PostgresAppointmentsRepository();
const svc = new AppointmentsService(repo, "Asia/Tashkent", () => new Date("2026-09-30T06:00:00Z"));

type Role = "reception" | "manager" | "doctor" | "nurse";
const users: Record<string, { userId: number; role: Role; doctorId?: number | null; nurseDoctorId?: number | null }> = {
  manager: { userId: 1, role: "manager" },
  reception: { userId: 2, role: "reception" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
};
let server: Server;
let baseUrl: string;

const http = async (who: keyof typeof users, path: string, method = "GET", body?: unknown) => {
  const user = users[who];
  const token = signAccessToken({ clinicId: 1, username: who, ...user } as never);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const counters = async () =>
  (await db.query<{ doctor_id: number; queue_date: string; last_number: number }>(
    "SELECT doctor_id, to_char(queue_date, 'YYYY-MM-DD') AS queue_date, last_number FROM queue_counters ORDER BY doctor_id, queue_date"
  )).rows.map((row) => [Number(row.doctor_id), row.queue_date, Number(row.last_number)]);

beforeAll(async () => {
  // start_at holds clinic wall-clock time: literals round-trip only when the session zone equals Node's zone.
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
    CREATE TABLE services(id bigint primary key, clinic_id bigint, name text, price numeric, duration integer, active boolean default true, deleted_at timestamptz);
    CREATE TABLE doctor_services(doctor_id bigint, service_id bigint);
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric,
      created_by bigint, created_at timestamptz default now());`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/appointments", appointmentsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/appointments`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE queue_counters, appointment_services, appointments, doctor_services, services, doctors, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Другая клиника');
    INSERT INTO users(id, clinic_id) VALUES (1, 1), (2, 1), (3, 1), (5, 1);
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримов Алишер'), (101, 1, 'Юсупова Нигора'), (102, 1, 'Азимов Бобур'), (103, 1, 'Рахимов Жасур');
    INSERT INTO doctors(id, clinic_id, full_name, specialty, queue_prefix) VALUES
      (10, 1, 'Алиева Дилноза', 'Терапевт', 'К'), (11, 1, 'Юсупов Тимур', 'Кардиолог', 'Т'), (12, 1, 'Без буквы', 'Хирург', NULL);
    INSERT INTO services(id, clinic_id, name, price, duration) VALUES (3, 1, 'Приём', 100000, 30);
    INSERT INTO doctor_services VALUES (10, 3), (11, 3), (12, 3);
    INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status) VALUES
      (201, 1, 100, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled'),
      (202, 1, 101, 10, 3, 100000, '${TODAY} 10:30:00', '${TODAY} 11:00:00', 'confirmed'),
      (203, 1, 102, 11, 3, 100000, '${TODAY} 11:00:00', '${TODAY} 11:30:00', 'scheduled'),
      (204, 1, 103, 10, 3, 100000, '${YESTERDAY} 10:00:00', '${YESTERDAY} 10:30:00', 'scheduled'),
      (205, 1, 103, 10, 3, 100000, '${YESTERDAY} 11:00:00', '${YESTERDAY} 11:30:00', 'no_show'),
      (206, 1, 103, 12, 3, 100000, '${TODAY} 12:00:00', '${TODAY} 12:30:00', 'scheduled');`);
});

describe("allocateQueueNumber", () => {
  it("counts per doctor and day, snapshots the letter and gives the number back on rollback", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 2, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 11, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "Т" });
      expect(await allocateQueueNumber(client, 1, 10, "2026-10-01")).toEqual({ queueNumber: 1, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 12, TODAY)).toEqual({ queueNumber: 1, queuePrefix: null });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "К" });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });
});

describe("queue numbers through PUT /api/appointments/:id", () => {
  it("numbers today's arrivals per doctor with the doctor's letter snapshot", async () => {
    const first = await http("reception", "/201", "PUT", { status: "arrived" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "arrived", queueNumber: 1, queueCode: "К-01", queueDate: TODAY, queueCalledAt: null, queueCallCount: 0 });
    expect(typeof first.body.queueIssuedAt).toBe("string");
    expect((await http("nurse", "/202", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 2, queueCode: "К-02" });
    expect((await http("reception", "/203", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "Т-01" });
    expect((await http("reception", "/206", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "01" });
    expect(await counters()).toEqual([[10, TODAY, 2], [11, TODAY, 1], [12, TODAY, 1]]);

    // A printed ticket stays valid when the doctor's letter changes later.
    await db.query("UPDATE doctors SET queue_prefix = 'Б' WHERE id = 10");
    expect((await http("reception", "/201")).body).toMatchObject({ queueCode: "К-01" });
  });

  it("lets an arrival for another day pass without a number", async () => {
    const res = await http("reception", "/204", "PUT", { status: "arrived" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "arrived", queueNumber: null, queueCode: null, queueDate: null });
    expect(await counters()).toEqual([]);
  });

  it("keeps the same number when the arrival is sent again", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    expect((await http("reception", "/201", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "К-01" });
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });

  it("takes a number from the new doctor's counter when an arrived visit changes doctor", async () => {
    await http("reception", "/203", "PUT", { status: "arrived" });
    await http("reception", "/201", "PUT", { status: "arrived" });
    const moved = await http("manager", "/201", "PUT", { doctorId: 11 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ doctorId: 11, status: "arrived", queueNumber: 2, queueCode: "Т-02", queueDate: TODAY });
  });

  it("clears the queue fields when a numbered visit moves to another day", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const moved = await http("manager", "/201", "PUT", { startAt: "2099-01-05 10:00:00" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      startAt: "2099-01-05 10:00:00",
      queueNumber: null,
      queueCode: null,
      queueDate: null,
      queueIssuedAt: null,
      queueCallCount: 0,
    });
  });

  it("keeps the number through consultation and completion", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    expect((await http("doctor", "/201", "PUT", { status: "in_consultation" })).body).toMatchObject({ queueCode: "К-01" });
    const done = await http("doctor", "/201/complete", "PATCH", {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", queueNumber: 1, queueCode: "К-01" });
  });

  it("gives a returning no-show a new number at the end, even when its slot is taken meanwhile", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    await http("reception", "/202", "PUT", { status: "arrived" });
    expect((await http("reception", "/201", "PUT", { status: "no_show" })).body).toMatchObject({ status: "no_show", queueCode: "К-01" });
    await db.query(
      `INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status)
       VALUES (207, 1, 103, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled')`
    );
    const back = await http("reception", "/201", "PUT", { status: "arrived" });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: "arrived", queueNumber: 3, queueCode: "К-03" });
    // The slot really is taken: an ordinary arrival there is still refused.
    expect((await http("reception", "/207", "PUT", { status: "arrived" })).status).toBe(409);
  });

  it("refuses to return a no-show of another day to the queue", async () => {
    const res = await http("reception", "/205", "PUT", { status: "arrived" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Вернуть в очередь можно только запись на сегодня");
  });

  it("ignores queue fields sent in the request body", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const res = await http("doctor", "/201", "PUT", { notes: "Кашель", queueNumber: 99, queueCode: "Z-99", queueDate: "2020-01-01", queuePrefix: "Z" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notes: "Кашель", queueNumber: 1, queueCode: "К-01", queueDate: TODAY });
    expect((await http("reception", "/202", "PUT", { queueNumber: 5 })).status).toBe(400);
  });

  it("returns queue fields in the appointment list", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const list = await http("reception", "/?doctorId=10");
    expect(list.status).toBe(200);
    const byId = new Map<number, any>(list.body.map((row: any) => [row.id, row]));
    expect(byId.get(201)).toMatchObject({ queueNumber: 1, queueCode: "К-01", queueDate: TODAY, queueCallCount: 0 });
    expect(byId.get(202)).toMatchObject({ queueNumber: null, queueCode: null, queueDate: null, queueCallCount: 0 });
  });
});

describe("repository queue writes", () => {
  it("numbers a visit created as arrived inside the create transaction", async () => {
    const created = await runWithClinicContext(1, () =>
      repo.create(
        { patientId: 100, doctorId: 10, serviceId: 3, price: 100000, startAt: `${TODAY} 15:00:00`, endAt: `${TODAY} 15:30:00`, status: "arrived", diagnosis: null, treatment: null, notes: null },
        { queue: { kind: "issue", day: TODAY } }
      )
    );
    expect(created).toMatchObject({ status: "arrived", queueNumber: 1, queueCode: "К-01", queueDate: TODAY });
    const lines = await db.query<{ service_id: number }>("SELECT service_id FROM appointment_services WHERE appointment_id = $1", [created.id]);
    expect(lines.rows.map((row) => Number(row.service_id))).toEqual([3]);
  });

  it("does not take a second number for an issue decided on stale data", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const again = await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { queue: { kind: "issue", day: TODAY } }));
    expect(again).toMatchObject({ queueNumber: 1, queueCode: "К-01" });
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });

  it("returns null and gives the number back when the row vanished", async () => {
    await db.query("UPDATE appointments SET deleted_at = now() WHERE id = 201");
    expect(await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { queue: { kind: "issue", day: TODAY } }))).toBeNull();
    expect(await counters()).toEqual([]);
  });

  it("skips the slot check only when asked to", async () => {
    await db.query(
      `INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status)
       VALUES (207, 1, 103, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled')`
    );
    await expect(runWithClinicContext(1, () => repo.update(201, { status: "arrived" }))).rejects.toMatchObject({ status: 409 });
    expect(
      await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { skipConflictCheck: true, queue: { kind: "issue", day: TODAY } }))
    ).toMatchObject({ status: "arrived", queueCode: "К-01" });
  });
});

describe("returning a no-show that also moves its slot", () => {
  // A clinic "today" in the future: ensureStartAtNotInPast uses the real clock, so a moved slot must be ahead of it.
  const DAY = "2099-03-10";
  const DAY_BEFORE = "2099-03-09";
  const laterSvc = new AppointmentsService(repo, "Asia/Tashkent", () => new Date(`${DAY}T06:00:00Z`));
  const reception = { userId: 2, clinicId: 1, username: "reception", role: "reception" as const };
  const returnToQueue = (id: number, patch: { startAt?: string; doctorId?: number }) =>
    runWithClinicContext(1, () => laterSvc.update(reception, id, { status: "arrived", ...patch }));

  beforeEach(async () => {
    await db.exec(`INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status) VALUES
      (301, 1, 100, 10, 3, 100000, '${DAY} 10:00:00', '${DAY} 10:30:00', 'no_show'),
      (302, 1, 101, 10, 3, 100000, '${DAY} 16:00:00', '${DAY} 16:30:00', 'scheduled'),
      (303, 1, 102, 11, 3, 100000, '${DAY} 10:00:00', '${DAY} 10:30:00', 'scheduled'),
      (304, 1, 103, 10, 3, 100000, '${DAY_BEFORE} 10:00:00', '${DAY_BEFORE} 10:30:00', 'no_show');`);
  });

  it("checks the slot again when the same request moves the visit to another time", async () => {
    await expect(returnToQueue(301, { startAt: `${DAY} 16:00:00` })).rejects.toMatchObject({
      status: 409,
      message: "У врача уже есть запись на это время",
    });
    // A free new time passes the checks and still takes a number.
    expect(await returnToQueue(301, { startAt: `${DAY} 18:00:00` })).toMatchObject({ status: "arrived", queueCode: "К-01", queueDate: DAY });
  });

  it("checks the slot again when the same request moves the visit to another doctor", async () => {
    await expect(returnToQueue(301, { doctorId: 11 })).rejects.toMatchObject({
      status: 409,
      message: "У врача уже есть запись на это время",
    });
    expect(await counters()).toEqual([]);
  });

  it("refuses to return a no-show of another day by moving it to today in the same request", async () => {
    await expect(returnToQueue(304, { startAt: `${DAY} 12:00:00` })).rejects.toMatchObject({
      status: 400,
      message: "Вернуть в очередь можно только запись на сегодня",
    });
    expect(await counters()).toEqual([]);
  });
});
