import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-doctor-room-tests-only" } }));
vi.mock("../../container", () => ({ services: { get doctors() { return doctorsService; } } }));
// The repository uses the global dbPool, including dbPool.connect() transactions: the mock needs BOTH methods.
vi.mock("../../config/database", () => ({ dbPool: {
  query: (sql: string, params?: unknown[]) => pool.query(sql, params),
  connect: () => pool.connect(),
} }));
import { PostgresDoctorsRepository } from "./PostgresDoctorsRepository";
import { DoctorsService } from "../../services/doctorsService";
import type { IServicesRepository } from "../interfaces/IServicesRepository";
import { doctorsRouter } from "../../routes/doctorsRoutes";
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
const repo = new PostgresDoctorsRepository();
// serviceIds are always [] in these tests, so the services repository is never asked.
const doctorsService = new DoctorsService(repo, { findById: async () => null } as unknown as IServicesRepository);
const inClinic = <T>(fn: () => Promise<T>) => runWithClinicContext(1, fn);
const newDoctor = { name: "Др. Алиева", speciality: "Терапевт", percent: 10, phone: null, birth_date: null, active: true };

let server: Server;
let baseUrl: string;
const http = async (role: "superadmin" | "reception", path: string, method = "GET", body?: unknown) => {
  const token = signAccessToken({ userId: 1, clinicId: 1, username: role, role });
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  // Same stubs as the queue tests, except doctors.id is BIGSERIAL: the repository INSERT does not pass an id.
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text, subscription_status text, subscription_ends_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    CREATE TABLE doctors(id bigserial primary key, clinic_id bigint not null, full_name text, specialty text default '', percent numeric default 0,
      phone text, birth_date date, active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
      price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text default 'draft',
      cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
      created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE services(id bigint primary key, clinic_id bigint, name text, active boolean default true, deleted_at timestamptz);
    CREATE TABLE doctor_services(doctor_id bigint, service_id bigint);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/doctors", doctorsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/doctors`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE doctor_services, services, doctors, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Чужая');`);
});

describe("PostgresDoctorsRepository room and queue letter", () => {
  it("creates a doctor with room and letter and reads them back from findById and findAll", async () => {
    await inClinic(async () => {
      const created = await repo.create({ ...newDoctor, room: "12", queuePrefix: "К" });
      expect(created).toMatchObject({ name: "Др. Алиева", room: "12", queuePrefix: "К" });
      expect(await repo.findById(created.id)).toMatchObject({ room: "12", queuePrefix: "К" });
      expect((await repo.findAll()).find((doctor) => doctor.id === created.id)).toMatchObject({ room: "12", queuePrefix: "К" });
    });
  });

  it("returns null for both fields when they were not set", async () => {
    await inClinic(async () => {
      const created = await repo.create({ ...newDoctor });
      expect(created).toMatchObject({ room: null, queuePrefix: null });
      expect(await repo.findById(created.id)).toMatchObject({ room: null, queuePrefix: null });
    });
  });

  it("updates only the fields that were sent", async () => {
    await inClinic(async () => {
      const created = await repo.create({ ...newDoctor, room: "12", queuePrefix: "К" });
      expect(await repo.update(created.id, { room: "14" })).toMatchObject({ name: "Др. Алиева", room: "14", queuePrefix: "К" });
      expect(await repo.update(created.id, { queuePrefix: null })).toMatchObject({ room: "14", queuePrefix: null });
      expect(await repo.update(created.id, { name: "Др. Алиева Н." })).toMatchObject({ room: "14", queuePrefix: null });
      expect(await repo.findById(created.id)).toMatchObject({ name: "Др. Алиева Н.", room: "14", queuePrefix: null });
    });
  });

  it("does not update a doctor of another clinic", async () => {
    const created = await inClinic(() => repo.create({ ...newDoctor, room: "12" }));
    expect(await runWithClinicContext(2, () => repo.update(created.id, { room: "99" }))).toBeNull();
    expect(await inClinic(() => repo.findById(created.id))).toMatchObject({ room: "12" });
  });
});

describe("doctors HTTP API room and queue letter", () => {
  it("validates, upper-cases and stores the letter through the router", async () => {
    const created = await http("superadmin", "", "POST", { ...newDoctor, room: " 7 ", queue_prefix: "т" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ room: "7", queuePrefix: "Т" });

    const roomOnly = await http("superadmin", `/${created.body.id}`, "PUT", { room: "8" });
    expect(roomOnly.status).toBe(200);
    expect(roomOnly.body).toMatchObject({ room: "8", queuePrefix: "Т" });

    expect(await http("superadmin", `/${created.body.id}`, "PUT", { queuePrefix: "12" }))
      .toEqual({ status: 400, body: { error: "Field 'queuePrefix' must be a single letter" } });
    expect(await http("superadmin", `/${created.body.id}`, "PUT", { room: "x".repeat(21) }))
      .toEqual({ status: 400, body: { error: "Field 'room' must be a string up to 20 characters" } });

    const list = await http("reception", "");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ id: created.body.id, room: "8", queuePrefix: "Т" })]);
    expect((await http("reception", `/${created.body.id}`)).body).toMatchObject({ room: "8", queuePrefix: "Т" });
  });
});
