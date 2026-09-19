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

describe("replacing appointment service lines SQL", () => {
  const booking = { patientId: 1, doctorId: 2, serviceId: 3, price: 100000, endAt: "2099-12-01 10:30:00", status: "scheduled" as const, diagnosis: null, treatment: null, notes: null };
  const lineRows = async (appointmentId: number) =>
    (await db.query<{ service_id: string; price: string; quantity: string; created_by: string | null }>(
      "SELECT service_id, price, quantity, created_by FROM appointment_services WHERE appointment_id = $1 ORDER BY id",
      [appointmentId]
    )).rows.map(row => [Number(row.service_id), Number(row.price), Number(row.quantity), row.created_by == null ? null : Number(row.created_by)]);

  beforeAll(async () => {
    // Wall-clock timestamps round-trip only when the DB session and Node share a zone, as in production.
    await db.exec(`SET TIME ZONE '${Intl.DateTimeFormat().resolvedOptions().timeZone}'`);
    await db.exec(`CREATE TABLE invoices(id bigserial primary key, clinic_id bigint, appointment_id bigint, status text, deleted_at timestamptz);
      INSERT INTO services VALUES (4,1,'УЗИ',150000),(5,1,'Анализ',50000);`);
  });

  it("swaps lines atomically, syncs the primary service and keeps authors of kept lines", async () => {
    await runWithClinicContext(1, async () => {
      const saved = await repo.create({ ...booking, startAt: "2099-12-01 10:00:00", serviceLines: [{ serviceId: 3 }, { serviceId: 4, price: 150000 }] });
      await db.query("UPDATE appointment_services SET created_by = 7 WHERE appointment_id = $1 AND service_id = 4", [saved.id]);
      const updated = await repo.replaceServiceLines(saved.id, [{ serviceId: 4, price: 150000, quantity: 1 }, { serviceId: 5, price: 50000, quantity: 2 }], { endAt: "2099-12-01 11:15:00", updatedBy: 9 });
      expect(updated).toMatchObject({ serviceId: 4, price: 150000, endAt: "2099-12-01 11:15:00" });
      expect(updated?.services).toEqual([{ serviceId: 4, name: "УЗИ", price: 150000 }, { serviceId: 5, name: "Анализ", price: 50000 }]);
      expect(await lineRows(saved.id)).toEqual([[4, 150000, 1, 7], [5, 50000, 2, 9]]);
    });
  });

  it("refuses while an active invoice exists and leaves the lines untouched", async () => {
    await runWithClinicContext(1, async () => {
      const saved = await repo.create({ ...booking, startAt: "2099-12-02 10:00:00" });
      await db.query("INSERT INTO invoices(clinic_id, appointment_id, status) VALUES (1, $1, 'issued')", [saved.id]);
      await expect(repo.replaceServiceLines(saved.id, [{ serviceId: 4, price: 150000, quantity: 1 }], { updatedBy: 9 })).rejects.toMatchObject({ status: 409 });
      expect(await lineRows(saved.id)).toEqual([[3, 100000, 1, null]]);
      await db.query("UPDATE invoices SET status = 'cancelled' WHERE appointment_id = $1", [saved.id]);
      expect(await repo.replaceServiceLines(saved.id, [{ serviceId: 4, price: 150000, quantity: 1 }], { updatedBy: 9 })).toMatchObject({ serviceId: 4, endAt: booking.endAt });
    });
  });

  it("does not touch an appointment of another clinic", async () => {
    const saved = await runWithClinicContext(1, () => repo.create({ ...booking, startAt: "2099-12-03 10:00:00" }));
    expect(await runWithClinicContext(2, () => repo.replaceServiceLines(saved.id, [{ serviceId: 4, price: 1, quantity: 1 }], { updatedBy: 9 }))).toBeNull();
    expect(await lineRows(saved.id)).toEqual([[3, 100000, 1, null]]);
  });
});
