import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-last-visits-tests-only" } }));
vi.mock("../../container", () => ({ services: { get appointments() { return svc; } } }));
vi.mock("../../config/database", () => ({ dbPool: { query: (sql: string, params?: unknown[]) => db.query(sql, params) } }));
import { PostgresAppointmentsRepository } from "./PostgresAppointmentsRepository";
import { AppointmentsService } from "../../services/appointmentsService";
import { appointmentsRouter } from "../../routes/appointmentsRoutes";
import { errorHandler } from "../../middleware/errorHandler";
import { signAccessToken } from "../../utils/jwt";

const db = new PGlite();
const svc = new AppointmentsService(new PostgresAppointmentsRepository());

const users = {
  reception: { userId: 2, role: "reception" },
  cashier: { userId: 6, role: "cashier" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
  unlinkedDoctor: { userId: 7, role: "doctor", doctorId: null },
  otherClinic: { userId: 9, role: "reception", clinicId: 2 },
};
let server: Server;
let baseUrl: string;

const get = async (who: keyof typeof users, path: string) => {
  const token = signAccessToken({ clinicId: 1, username: who, ...users[who] } as never);
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  // start_at holds clinic wall-clock time: literals round-trip only when the session zone equals Node's zone.
  await db.exec(`SET TIME ZONE '${Intl.DateTimeFormat().resolvedOptions().timeZone}'`);
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text);
    CREATE TABLE users(id bigint primary key, clinic_id bigint);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, deleted_at timestamptz);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
      price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text default 'draft',
      cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
      created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE services(id bigint primary key, clinic_id bigint, name text, price numeric);
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric);`);
  // The appointment list reads the columns these migrations add.
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  await db.exec(`INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Другая клиника');
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримов Алишер'), (101, 1, 'Юсупова Нигора'), (102, 1, 'Азимов Бобур'),
      (103, 1, 'Рахимов Жасур'), (104, 1, 'Ким Ольга'), (105, 1, 'Без записей'), (200, 2, 'Чужой пациент');
    INSERT INTO doctors(id, clinic_id, full_name) VALUES (10, 1, 'Алиева Дилноза'), (11, 1, 'Юсупов Тимур'), (20, 2, 'Чужой врач');
    INSERT INTO services(id, clinic_id, name, price) VALUES (3, 1, 'Приём', 100000);
    INSERT INTO appointments(clinic_id, patient_id, doctor_id, service_id, start_at, end_at, status, deleted_at) VALUES
      -- 100: the later visit belongs to another doctor
      (1, 100, 10, 3, '2026-01-10 09:00:00', '2026-01-10 09:30:00', 'completed', NULL),
      (1, 100, 11, 3, '2026-03-05 00:30:00', '2026-03-05 01:00:00', 'completed', NULL),
      -- 101: a future booking counts
      (1, 101, 10, 3, '2026-02-01 10:00:00', '2026-02-01 10:30:00', 'completed', NULL),
      (1, 101, 10, 3, '2099-05-01 11:00:00', '2099-05-01 11:30:00', 'scheduled', NULL),
      -- 102: a cancelled visit counts
      (1, 102, 10, 3, '2026-02-02 10:00:00', '2026-02-02 10:30:00', 'completed', NULL),
      (1, 102, 10, 3, '2026-04-04 12:00:00', '2026-04-04 12:30:00', 'cancelled', NULL),
      -- 103: the later visit is deleted
      (1, 103, 11, 3, '2026-02-03 10:00:00', '2026-02-03 10:30:00', 'no_show', NULL),
      (1, 103, 11, 3, '2026-06-06 16:00:00', '2026-06-06 16:30:00', 'completed', now()),
      -- 104: the only visit is deleted
      (1, 104, 10, 3, '2026-07-07 10:00:00', '2026-07-07 10:30:00', 'completed', now()),
      -- another clinic; its second row reuses patient id 100 on purpose
      (2, 200, 20, 3, '2026-08-08 10:00:00', '2026-08-08 10:30:00', 'completed', NULL),
      (2, 100, 20, 3, '2099-12-31 10:00:00', '2099-12-31 10:30:00', 'scheduled', NULL);`);
  const app = express();
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

describe("GET /api/appointments/last-visits", () => {
  it("returns the latest start per patient: any status, future ones included, deleted ones skipped", async () => {
    const res = await get("reception", "/last-visits");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { patientId: 100, lastVisitAt: "2026-03-05 00:30:00" },
      { patientId: 101, lastVisitAt: "2099-05-01 11:00:00" },
      { patientId: 102, lastVisitAt: "2026-04-04 12:00:00" },
      { patientId: 103, lastVisitAt: "2026-02-03 10:00:00" },
    ]);
  });

  it.each(["doctor", "nurse"] as const)("counts only the visits of the %s's own doctor", async (who) => {
    const res = await get(who, "/last-visits");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { patientId: 100, lastVisitAt: "2026-01-10 09:00:00" },
      { patientId: 101, lastVisitAt: "2099-05-01 11:00:00" },
      { patientId: 102, lastVisitAt: "2026-04-04 12:00:00" },
    ]);
  });

  it("refuses a doctor account without a doctor profile exactly as the appointment list does", async () => {
    const lastVisits = await get("unlinkedDoctor", "/last-visits");
    expect(lastVisits.status).toBe(403);
    expect(lastVisits).toEqual(await get("unlinkedDoctor", "/"));
  });

  it("reads only the caller's clinic", async () => {
    expect((await get("otherClinic", "/last-visits")).body).toEqual([
      { patientId: 100, lastVisitAt: "2099-12-31 10:00:00" },
      { patientId: 200, lastVisitAt: "2026-08-08 10:00:00" },
    ]);
  });

  it.each(["reception", "cashier", "doctor", "nurse"] as const)(
    "gives a %s the dates the Patients page used to compute from the full appointment list",
    async (who) => {
      const list = await get(who, "/");
      const fromList = new Map<number, string>();
      for (const row of list.body) {
        const current = fromList.get(row.patientId);
        if (!current || row.startAt > current) fromList.set(row.patientId, row.startAt);
      }
      expect(fromList.size).toBeGreaterThan(0);

      const lastVisits = await get(who, "/last-visits");
      expect(lastVisits.status).toBe(200);
      expect(new Map(lastVisits.body.map((row: any) => [row.patientId, row.lastVisitAt]))).toEqual(fromList);
    }
  );
});
