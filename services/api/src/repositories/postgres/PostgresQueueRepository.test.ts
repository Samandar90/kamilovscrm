import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({
  env: { isProduction: false, jwtSecret: "isolated-queue-tests-only", reportsTimezone: "Asia/Tashkent", dataProvider: "postgres" },
}));
vi.mock("../../container", () => ({ services: { get queue() { return svc; } } }));
vi.mock("../../config/database", () => ({
  dbPool: {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: () => pool.connect(),
  },
}));
import { PostgresQueueRepository } from "./PostgresQueueRepository";
import { QueueService } from "../../services/queueService";
import { queueRouter } from "../../routes/queueRoutes";
import { errorHandler } from "../../middleware/errorHandler";
import { signAccessToken } from "../../utils/jwt";

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
// Fixed clock: 2026-09-30T06:00Z = 11:00 in Tashkent, clinic day "2026-09-30".
const NOW = new Date("2026-09-30T06:00:00Z");
const svc = new QueueService(new PostgresQueueRepository(pool), "Asia/Tashkent", () => NOW);

type Role = "superadmin" | "manager" | "reception" | "doctor" | "nurse" | "cashier";
const users: Record<string, { userId: number; role: Role; doctorId?: number | null; nurseDoctorId?: number | null; clinicId?: number }> = {
  superadmin: { userId: 9, role: "superadmin" },
  reception: { userId: 2, role: "reception" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  otherDoctor: { userId: 4, role: "doctor", doctorId: 11 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
  manager: { userId: 1, role: "manager" },
  cashier: { userId: 6, role: "cashier" },
  foreignReception: { userId: 8, role: "reception", clinicId: 2 },
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
const column = async (id: number, expr: string) =>
  (await db.query<{ v: unknown }>(`SELECT ${expr} AS v FROM appointments WHERE id = $1`, [id])).rows[0]?.v;

beforeAll(async () => {
  // start_at literals are wall clock; they round-trip only when the DB session and Node share a zone (as in production).
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
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/queue", queueRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  // Doctor 10 (room 5, letter К): #1 called, #2 serving, #3 missed, #4 and #5 waiting, #6 done, a serving patient without
  // a ticket, a cancelled #7, a deleted #8, yesterday's #1, and three unnumbered rows for the issue tests.
  // Doctor 11 (room 7) has nothing today; doctor 12 (room 3, no letter) has #1 waiting; clinic 2 has its own #1.
  await db.exec(`TRUNCATE queue_counters, queue_displays, appointments, doctors, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics (id, name) VALUES (1, 'Клиника Шифо'), (2, 'Чужая клиника');
    INSERT INTO users (id, clinic_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (8, 2), (9, 1);
    INSERT INTO patients (id, clinic_id, full_name) VALUES
      (100, 1, 'Каримова Анна Сергеевна'), (101, 1, 'Юсупов Бобур'), (102, 1, 'Алиев Сардор'), (103, 1, 'Назарова Дилноза'),
      (104, 1, 'Рахимов Тимур'), (105, 1, 'Ким Ольга'), (106, 1, 'Ли Виктор'), (107, 1, 'Отменённый Пациент'),
      (108, 1, 'Удалённый Пациент'), (109, 1, 'Вчерашний Пациент'), (110, 1, 'Поздний Пациент'), (111, 1, 'Записанный Пациент'),
      (112, 1, 'Завтрашний Пациент'), (120, 1, 'Турсунова Мадина'), (200, 2, 'Чужой Пациент');
    INSERT INTO doctors (id, clinic_id, full_name, specialty, room, queue_prefix) VALUES
      (10, 1, 'Алиева Нигора', 'Терапевт', '5', 'К'), (11, 1, 'Юсупов Азиз', 'Кардиолог', '7', NULL),
      (12, 1, 'Ким Елена', 'Педиатр', '3', NULL), (20, 2, 'Чужой Врач', 'Хирург', '1', 'Х');
    INSERT INTO appointments (id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status,
        queue_number, queue_prefix, queue_date, queue_issued_at, queue_called_at, queue_call_count, updated_at, deleted_at) VALUES
      (500, 1, 100, 10, 1, 0, '2026-09-30 08:00:00', '2026-09-30 08:30:00', 'arrived', 1, 'К', '2026-09-30', '2026-09-30 03:00:00+00', '2026-09-30 05:10:00+00', 1, '2026-09-30 05:00:00+00', NULL),
      (501, 1, 101, 10, 1, 0, '2026-09-30 08:30:00', '2026-09-30 09:00:00', 'in_consultation', 2, 'К', '2026-09-30', '2026-09-30 03:05:00+00', NULL, 0, '2026-09-30 05:20:00+00', NULL),
      (502, 1, 102, 10, 1, 0, '2026-09-30 09:00:00', '2026-09-30 09:30:00', 'no_show', 3, 'К', '2026-09-30', '2026-09-30 03:10:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (503, 1, 103, 10, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 5, 'К', '2026-09-30', '2026-09-30 03:20:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (504, 1, 104, 10, 1, 0, '2026-09-30 10:30:00', '2026-09-30 11:00:00', 'arrived', 4, 'К', '2026-09-30', '2026-09-30 03:15:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (505, 1, 105, 10, 1, 0, '2026-09-30 07:00:00', '2026-09-30 07:30:00', 'completed', 6, 'К', '2026-09-30', '2026-09-30 02:00:00+00', '2026-09-30 02:05:00+00', 1, '2026-09-30 03:00:00+00', NULL),
      (506, 1, 106, 10, 1, 0, '2026-09-30 09:00:00', '2026-09-30 09:30:00', 'in_consultation', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:30:00+00', NULL),
      (507, 1, 107, 10, 1, 0, '2026-09-30 11:00:00', '2026-09-30 11:30:00', 'cancelled', 7, 'К', '2026-09-30', '2026-09-30 03:25:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (508, 1, 108, 10, 1, 0, '2026-09-30 11:30:00', '2026-09-30 12:00:00', 'arrived', 8, 'К', '2026-09-30', '2026-09-30 03:30:00+00', NULL, 0, '2026-09-30 05:00:00+00', '2026-09-30 05:40:00+00'),
      (509, 1, 109, 10, 1, 0, '2026-09-29 10:00:00', '2026-09-29 10:30:00', 'arrived', 1, 'К', '2026-09-29', '2026-09-29 03:00:00+00', NULL, 0, '2026-09-29 05:00:00+00', NULL),
      (510, 1, 110, 10, 1, 0, '2026-09-30 12:00:00', '2026-09-30 12:30:00', 'arrived', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (511, 1, 111, 10, 1, 0, '2026-09-30 13:00:00', '2026-09-30 13:30:00', 'scheduled', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (512, 1, 112, 10, 1, 0, '2026-10-01 10:00:00', '2026-10-01 10:30:00', 'arrived', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (520, 1, 120, 12, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 1, NULL, '2026-09-30', '2026-09-30 04:00:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (600, 2, 200, 20, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 1, 'Х', '2026-09-30', '2026-09-30 04:00:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL);
    INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number) VALUES
      (1, 10, '2026-09-30', 8), (1, 10, '2026-09-29', 1), (1, 12, '2026-09-30', 1), (2, 20, '2026-09-30', 1);`);
});

describe("GET /today", () => {
  it("groups today's queue per cabinet with serving, waiting, missed and done", async () => {
    const res = await http("reception", "/today");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: "2026-09-30", timeZone: "Asia/Tashkent", serverTime: "2026-09-30T06:00:00.000Z" });
    expect(res.body.doctors.map((d: any) => d.doctorId)).toEqual([12, 10]);
    const [pediatrician, therapist] = res.body.doctors;
    expect(pediatrician).toMatchObject({ doctorName: "Ким Елена", specialty: "Педиатр", room: "3", prefix: null, serving: null, missed: [], doneCount: 0 });
    expect(pediatrician.waiting).toEqual([
      {
        appointmentId: 520, doctorId: 12, patientId: 120, patientName: "Турсунова Мадина", number: 1, code: "01", state: "waiting",
        startAt: "2026-09-30 10:00:00", issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0,
      },
    ]);
    expect(therapist).toMatchObject({ doctorName: "Алиева Нигора", room: "5", prefix: "К", doneCount: 1 });
    expect(therapist.serving).toMatchObject({ appointmentId: 506, number: null, code: null, state: "serving", startAt: "2026-09-30 09:00:00" });
    expect(therapist.waiting.map((e: any) => [e.appointmentId, e.code, e.state])).toEqual([
      [500, "К-01", "called"],
      [504, "К-04", "waiting"],
      [503, "К-05", "waiting"],
    ]);
    expect(therapist.waiting[0]).toMatchObject({ calledAt: "2026-09-30T05:10:00.000Z", callCount: 1 });
    expect(therapist.missed.map((e: any) => [e.appointmentId, e.code])).toEqual([[502, "К-03"]]);
  });

  it("filters by doctor and scopes doctors and nurses to their own queue", async () => {
    const filtered = await http("reception", "/today?doctorId=12");
    expect(filtered.body.doctors.map((d: any) => d.doctorId)).toEqual([12]);
    expect((await http("reception", "/today?doctorId=11")).body.doctors).toMatchObject([
      { doctorId: 11, serving: null, waiting: [], missed: [], doneCount: 0 },
    ]);

    expect((await http("doctor", "/today")).body.doctors.map((d: any) => d.doctorId)).toEqual([10]);
    expect((await http("nurse", "/today")).body.doctors.map((d: any) => d.doctorId)).toEqual([10]);
    const own = await http("otherDoctor", "/today");
    expect(own.status).toBe(200);
    expect(own.body.doctors).toMatchObject([{ doctorId: 11, doctorName: "Юсупов Азиз", room: "7", serving: null, waiting: [], missed: [], doneCount: 0 }]);
    expect((await http("otherDoctor", "/today?doctorId=11")).status).toBe(200);
    const foreign = await http("otherDoctor", "/today?doctorId=10");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
  });

  it("enforces the queue permission and validates the filter", async () => {
    expect((await http("manager", "/today")).status).toBe(200);
    expect((await http("superadmin", "/today")).status).toBe(200);
    expect((await http("cashier", "/today")).status).toBe(403);
    expect((await http("reception", "/today?doctorId=0")).status).toBe(400);
    expect((await http("reception", "/today?doctorId=abc")).status).toBe(400);
  });

  it("never mixes clinics", async () => {
    const own = await http("reception", "/today");
    const ids = own.body.doctors.flatMap((d: any) => [...d.waiting, ...d.missed, d.serving].filter(Boolean).map((e: any) => e.appointmentId));
    expect(ids).not.toContain(600);
    const foreign = await http("foreignReception", "/today");
    expect(foreign.body.doctors).toHaveLength(1);
    expect(foreign.body.doctors[0]).toMatchObject({ doctorId: 20, prefix: "Х" });
    expect(foreign.body.doctors[0].waiting.map((e: any) => e.appointmentId)).toEqual([600]);
    expect((await http("foreignReception", "/today?doctorId=10")).body.doctors).toEqual([]);
  });
});

describe("POST /doctors/:doctorId/call-next", () => {
  it("calls the lowest waiting number, skipping called, serving and missed ones", async () => {
    const first = await http("reception", "/doctors/10/call-next", "POST");
    expect(first.status).toBe(200);
    expect(first.body.entry).toMatchObject({ appointmentId: 504, code: "К-04", state: "called", callCount: 1 });
    expect(first.body.entry.calledAt).toEqual(expect.any(String));
    expect((await http("doctor", "/doctors/10/call-next", "POST")).body.entry).toMatchObject({ appointmentId: 503, callCount: 1 });
    expect((await http("nurse", "/doctors/10/call-next", "POST")).body).toEqual({ entry: null });
    expect((await http("reception", "/doctors/11/call-next", "POST")).body).toEqual({ entry: null });
  });

  it("keeps doctors to their own queue and read-only roles out", async () => {
    const foreign = await http("doctor", "/doctors/12/call-next", "POST");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
    expect((await http("manager", "/doctors/10/call-next", "POST")).status).toBe(403);
    expect((await http("reception", "/doctors/abc/call-next", "POST")).status).toBe(400);
    expect((await http("foreignReception", "/doctors/10/call-next", "POST")).body).toEqual({ entry: null });
    expect(await column(504, "queue_called_at")).toBeNull();
  });
});

describe("POST /appointments/:id/call", () => {
  it("re-calls a patient without touching updated_at", async () => {
    const before = await column(500, "updated_at::text");
    const res = await http("reception", "/appointments/500/call", "POST");
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ appointmentId: 500, state: "called", callCount: 2 });
    expect(res.body.entry.calledAt).not.toBe("2026-09-30T05:10:00.000Z");
    expect(await column(500, "updated_at::text")).toBe(before);

    const waiting = await http("reception", "/appointments/503/call", "POST");
    expect(waiting.body.entry).toMatchObject({ appointmentId: 503, state: "called", callCount: 1 });
  });

  it("rejects patients who are not waiting in today's queue", async () => {
    for (const id of [501, 502, 509, 510, 511]) {
      const res = await http("reception", `/appointments/${id}/call`, "POST");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Пациент не ожидает в очереди");
    }
    expect((await http("reception", "/appointments/508/call", "POST")).status).toBe(404);
    expect((await http("reception", "/appointments/600/call", "POST")).status).toBe(404);
    expect((await http("reception", "/appointments/0/call", "POST")).status).toBe(400);
  });

  it("applies roles and the doctor scope", async () => {
    expect((await http("manager", "/appointments/503/call", "POST")).status).toBe(403);
    expect((await http("cashier", "/appointments/503/call", "POST")).status).toBe(403);
    const foreign = await http("otherDoctor", "/appointments/503/call", "POST");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
    expect((await http("nurse", "/appointments/503/call", "POST")).body.entry).toMatchObject({ appointmentId: 503, state: "called" });
    expect((await http("doctor", "/appointments/504/call", "POST")).body.entry).toMatchObject({ appointmentId: 504, state: "called" });
  });
});

describe("nurse scope", () => {
  it("keeps a nurse to her doctor's queue: another doctor's day view, call and call-next are 403 and change nothing", async () => {
    // Doctor 11 gets one waiting patient, so only the scope check can refuse the nurse (reception calls it at the end).
    await db.exec(`INSERT INTO appointments (id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status,
        queue_number, queue_prefix, queue_date, queue_issued_at, queue_called_at, queue_call_count) VALUES
      (530, 1, 111, 11, 1, 0, '2026-09-30 14:00:00', '2026-09-30 14:30:00', 'arrived', 1, NULL, '2026-09-30', '2026-09-30 04:30:00+00', NULL, 0);`);
    for (const [path, method] of [["/today?doctorId=11", "GET"], ["/appointments/530/call", "POST"], ["/doctors/11/call-next", "POST"]]) {
      const res = await http("nurse", path, method);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Можно работать только со своей очередью");
    }
    expect(await column(530, "queue_called_at")).toBeNull();
    expect(await column(530, "queue_call_count")).toBe(0);
    expect((await http("reception", "/appointments/530/call", "POST")).body.entry).toMatchObject({ appointmentId: 530, state: "called", callCount: 1 });
  });
});

describe("POST /appointments/:id/issue", () => {
  it("backfills a number for an arrived-today patient from the doctor's counter, idempotently", async () => {
    const res = await http("reception", "/appointments/510/issue", "POST");
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ appointmentId: 510, number: 9, code: "К-09", state: "waiting", callCount: 0, calledAt: null });
    expect(res.body.entry.issuedAt).toEqual(expect.any(String));
    const again = await http("reception", "/appointments/510/issue", "POST");
    expect(again.body.entry).toMatchObject({ number: 9, code: "К-09" });
    const counter = await db.query<{ last_number: number }>(
      `SELECT last_number FROM queue_counters WHERE doctor_id = 10 AND queue_date = '2026-09-30'`
    );
    expect(counter.rows[0].last_number).toBe(9);
    expect(await column(503, "queue_number")).toBe(5);
  });

  it("refuses patients who have not arrived or are not booked for today", async () => {
    const scheduled = await http("reception", "/appointments/511/issue", "POST");
    expect(scheduled.status).toBe(409);
    expect(scheduled.body.error).toBe("Номер выдаётся только пришедшему пациенту");
    const tomorrow = await http("reception", "/appointments/512/issue", "POST");
    expect(tomorrow.status).toBe(409);
    expect(tomorrow.body.error).toBe("Запись не на сегодня");
    expect((await http("reception", "/appointments/9999/issue", "POST")).status).toBe(404);
    expect((await http("foreignReception", "/appointments/510/issue", "POST")).status).toBe(404);
    expect((await http("doctor", "/appointments/510/issue", "POST")).status).toBe(403);
    expect((await http("manager", "/appointments/510/issue", "POST")).status).toBe(403);
    expect(await column(510, "queue_number")).toBeNull();
  });
});

describe("GET /appointments/:id/ticket", () => {
  it("returns the printable ticket with the number of patients ahead", async () => {
    const res = await http("reception", "/appointments/503/ticket");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      appointmentId: 503, clinicName: "Клиника Шифо", code: "К-05", number: 5, doctorName: "Алиева Нигора", specialty: "Терапевт",
      room: "5", issuedAt: "2026-09-30T03:20:00.000Z", aheadCount: 2, timeZone: "Asia/Tashkent",
    });
    expect((await http("doctor", "/appointments/520/ticket")).status).toBe(403);
    expect((await http("cashier", "/appointments/503/ticket")).status).toBe(403);
    expect((await http("manager", "/appointments/520/ticket")).body).toMatchObject({ code: "01", aheadCount: 0, room: "3" });
  });

  it("falls back to a generic clinic name and 404s without a number", async () => {
    await db.exec(`UPDATE clinics SET name = '   ' WHERE id = 1`);
    expect((await http("reception", "/appointments/503/ticket")).body.clinicName).toBe("Клиника");
    const none = await http("reception", "/appointments/511/ticket");
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("У записи нет номера очереди");
    expect((await http("reception", "/appointments/9999/ticket")).status).toBe(404);
    expect((await http("reception", "/appointments/600/ticket")).status).toBe(404);
  });
});
