import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-services-tests-only" } }));
vi.mock("../container", () => ({ services: { get services() { return svc; } } }));
import { ServicesService } from "./servicesService";
import { MockServicesRepository } from "../repositories/servicesRepository";
import { getMockDb } from "../repositories/mockDatabase";
import { servicesRouter } from "../routes/servicesRoutes";
import { errorHandler } from "../middleware/errorHandler";
import { signAccessToken } from "../utils/jwt";
import type { UserRole } from "../auth/permissions";

const svc = new ServicesService(new MockServicesRepository());
const createdAt = "2026-01-01T00:00:00.000Z";
const doctorAuth = { userId: 5, clinicId: 1, username: "doctor", role: "doctor" as UserRole, doctorId: 2 };
let server: Server;
let baseUrl: string;

const http = (path: string, method = "GET", body?: unknown, auth: Record<string, unknown> = doctorAuth) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signAccessToken(auth as never)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const links = () => getMockDb().doctorServices.map((link) => [link.doctorId, link.serviceId]).sort();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/services", servicesRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/services`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  const db = getMockDb();
  db.doctors = [
    { id: 2, name: "Врач", speciality: "Терапевт", percent: 10, active: true, createdAt },
    { id: 3, name: "Коллега", speciality: "Хирург", percent: 10, active: true, createdAt },
  ];
  db.services = [
    { id: 10, name: "Консультация", category: "consultation", price: 100000, duration: 30, active: true, createdAt },
    { id: 11, name: "УЗИ", category: "diagnostics", price: 150000, duration: 20, active: true, createdAt },
    { id: 12, name: "Архивная", category: "other", price: 1000, duration: 10, active: false, createdAt },
  ];
  db.doctorServices = [{ doctorId: 2, serviceId: 10 }, { doctorId: 3, serviceId: 11 }];
});

describe("doctor's own services", () => {
  it("lists own services separately from the active catalog the doctor can take on", async () => {
    getMockDb().doctorServices.push({ doctorId: 2, serviceId: 12 });
    const res = await http("/mine");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assigned: Array<{ id: number }>; available: Array<{ id: number }> };
    expect(body.assigned.map((s) => s.id).sort()).toEqual([10, 12]);
    expect(body.available.map((s) => s.id)).toEqual([11]);
  });

  it("adds an existing active service idempotently and refuses inactive or unknown ones", async () => {
    expect((await http("/mine", "POST", { serviceId: 11 })).status).toBe(200);
    expect((await http("/mine", "POST", { serviceId: 11 })).status).toBe(200);
    expect(links()).toEqual([[2, 10], [2, 11], [3, 11]]);
    expect((await http("/mine", "POST", { serviceId: 12 })).status).toBe(404);
    expect((await http("/mine", "POST", { serviceId: 999 })).status).toBe(404);
    expect((await http("/mine", "POST", { serviceId: "x" })).status).toBe(400);
  });

  it("creates a new active service linked only to the doctor, whatever the body claims", async () => {
    const res = await http("/mine/new", "POST", { name: " Массаж ", category: "treatment", price: 80000, duration: 40, active: false, doctorIds: [3] });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created).toMatchObject({ name: "Массаж", price: 80000, duration: 40, active: true, doctorIds: [2] });
    expect((await http("/mine/new", "POST", { name: "Без цены", category: "treatment", price: -1, duration: 40 })).status).toBe(400);
    expect((await http("/mine/new", "POST", { name: "", category: "treatment", price: 1, duration: 40 })).status).toBe(400);
  });

  it("removes only the doctor's own link", async () => {
    expect((await http("/mine/10", "DELETE")).status).toBe(200);
    expect((await http("/mine/11", "DELETE")).status).toBe(404);
    expect(links()).toEqual([[3, 11]]);
  });

  it("is available only to doctors and does not widen catalog management or shadow /:id", async () => {
    const admin = { ...doctorAuth, role: "superadmin", doctorId: null };
    for (const role of ["superadmin", "reception", "manager", "nurse"]) {
      expect((await http("/mine", "GET", undefined, { ...doctorAuth, role })).status).toBe(403);
    }
    expect((await http("/mine", "GET", undefined, { ...doctorAuth, doctorId: null })).status).toBe(403);
    expect((await http("/", "POST", { name: "X", category: "other", price: 1, duration: 10, active: true })).status).toBe(403);
    expect((await http("/11", "GET", undefined, admin)).status).toBe(200);
  });
});
