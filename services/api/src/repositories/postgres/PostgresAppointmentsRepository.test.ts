import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("../../config/database", () => ({ dbPool: {
  query: (sql: string, params?: unknown[]) => db.query(sql, params),
  connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release: () => {} }),
} }));
import { PostgresAppointmentsRepository } from "./PostgresAppointmentsRepository";
import { runWithClinicContext } from "../../tenancy/clinicContext";

const db = new PGlite();
const repo = new PostgresAppointmentsRepository();
beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigint primary key);
    CREATE TABLE patients(id bigint primary key);
    CREATE TABLE users(id bigint primary key);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
      price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text,
      cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
      created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE services(id bigint primary key, clinic_id bigint, name text, price numeric);
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric, created_by bigint);
    INSERT INTO clinics VALUES(1),(2); INSERT INTO patients VALUES(1); INSERT INTO services VALUES(3,1,'Приём',100000);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../../../packages/database/migrations/033_call_center_daily_workflow.sql"), "utf8"));
}, 30000);
afterAll(() => db.close());

describe("appointment recommended return date SQL", () => {
  it("round-trips a calendar date on create, read, update and clearing without timezone shifts", async () => {
    await db.exec("SET TIME ZONE 'America/New_York'");
    await runWithClinicContext(1, async () => {
      const saved = await repo.create({ patientId: 1, doctorId: 2, serviceId: 3, price: 100000, startAt: "2099-08-27 10:00:00", endAt: "2099-08-27 10:30:00", status: "completed", diagnosis: null, treatment: null, notes: null, recommendedReturnDate: "2099-09-10" });
      expect(saved.recommendedReturnDate).toBe("2099-09-10");
      expect((await repo.findById(saved.id))?.recommendedReturnDate).toBe("2099-09-10");
      expect((await repo.update(saved.id, { recommendedReturnDate: "2099-10-01" }))?.recommendedReturnDate).toBe("2099-10-01");
      expect((await repo.update(saved.id, { recommendedReturnDate: null }))?.recommendedReturnDate).toBeNull();
    });
  });
  it("does not update a return date in another clinic", async () => {
    const rows = await db.query<{ id: number }>("INSERT INTO appointments(clinic_id,patient_id,doctor_id,service_id,start_at,end_at,status) VALUES(1,1,2,3,'2099-11-01 10:00:00+00','2099-11-01 10:30:00+00','completed') RETURNING id");
    expect(await runWithClinicContext(2, () => repo.update(Number(rows.rows[0].id), { recommendedReturnDate: "2099-10-01" }))).toBeNull();
  });
});
