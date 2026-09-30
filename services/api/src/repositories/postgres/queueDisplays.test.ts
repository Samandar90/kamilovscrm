import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({
  env: { isProduction: false, jwtSecret: "isolated-queue-display-tests-only", dataProvider: "postgres", reportsTimezone: "Asia/Tashkent" },
}));
vi.mock("../../container", () => ({
  services: {
    get queue() { return queueSvc; },
    get queueDisplays() { return displaysSvc; },
  },
}));
vi.mock("../../config/database", () => ({
  dbPool: {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: () => pool.connect(),
  },
}));
import { PostgresQueueRepository } from "./PostgresQueueRepository";
import { PostgresQueueDisplaysRepository } from "./PostgresQueueDisplaysRepository";
import { QueueService } from "../../services/queueService";
import { QueueDisplaysService } from "../../services/queueDisplaysService";
import { hashDisplayCode, normalizeDisplayCode } from "../../services/queue/displayCode";
import { queueRouter } from "../../routes/queueRoutes";
import { publicRouter } from "../../routes/publicRoutes";
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
// Fixed clock: 2026-09-30 11:00 in Tashkent.
const clock = () => new Date("2026-09-30T06:00:00Z");
const queueRepo = new PostgresQueueRepository(pool);
const queueSvc = new QueueService(queueRepo, "Asia/Tashkent", clock);
const displaysSvc = new QueueDisplaysService(new PostgresQueueDisplaysRepository(pool), queueRepo, "Asia/Tashkent", clock);

type Role = "superadmin" | "manager" | "reception";
const users: Record<string, { userId: number; role: Role; clinicId?: number }> = {
  admin: { userId: 1, role: "superadmin" },
  reception: { userId: 2, role: "reception" },
  manager: { userId: 3, role: "manager" },
  foreignAdmin: { userId: 4, role: "superadmin", clinicId: 2 },
};
let server: Server;
let root: string;

const staff = async (who: keyof typeof users, path: string, method = "GET", body?: unknown) => {
  const token = signAccessToken({ clinicId: 1, username: who, ...users[who] } as never);
  const res = await fetch(`${root}/api/queue${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};
// The TV sends no Authorization header at all.
const tv = async (code: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${root}/api/public/queue-display/${encodeURIComponent(code)}`, { headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: JSON.parse(text) as any };
};
const createDisplay = async (body: Record<string, unknown> = {}) => {
  const res = await staff("admin", "/displays", "POST", { name: "Холл 1", ...body });
  expect(res.status).toBe(201);
  return res.body as { display: { id: number }; code: string };
};

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
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/queue", queueRouter);
  app.use("/api/public", publicRouter);
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
  // start_at literals are clinic wall-clock, written exactly like the app writes them (session TZ = Node TZ).
  await db.exec(`TRUNCATE queue_displays, queue_counters, appointments, doctors, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics VALUES (1, '  Клиника Камилова  ', 'active', NULL), (2, 'Чужая клиника', 'active', NULL);
    INSERT INTO users VALUES (1, 1), (2, 1), (3, 1), (4, 2);
    INSERT INTO patients VALUES
      (100, 1, 'Каримов Алишер Бахтиёрович', '+998901111111', NULL),
      (101, 1, 'Юсупова Дилноза', '+998902222222', NULL),
      (102, 1, 'Ахмедов Бобур', '+998903333333', NULL),
      (103, 1, 'Тошматова Малика', '+998904444444', NULL),
      (104, 1, 'Эргашев Жасур', '+998905555555', NULL),
      (105, 1, 'Норова Севара', '+998906666666', NULL),
      (106, 1, 'Холматов Азиз', '+998907777777', NULL),
      (107, 1, 'Саидова Гулноза', '+998908888888', NULL),
      (108, 1, 'Мирзаев Шерзод', '+998909999999', NULL),
      (200, 2, 'Чужой Пациент', '+998900000000', NULL);
    INSERT INTO doctors (id, clinic_id, full_name, specialty, room, queue_prefix) VALUES
      (10, 1, 'Алиева Нигора', 'Терапевт', '5', 'К'),
      (11, 1, 'Юсупов Рустам', 'Кардиолог', '3', NULL),
      (12, 1, 'Рахимова Лола', 'Невролог', NULL, 'Н'),
      (20, 2, 'Чужой Врач', 'Хирург', '1', 'Х');
    INSERT INTO appointments (id, clinic_id, patient_id, doctor_id, start_at, end_at, status,
        queue_number, queue_prefix, queue_date, queue_issued_at, queue_called_at, queue_call_count) VALUES
      (1000, 1, 100, 10, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'in_consultation', 1, 'К', '2026-09-30', '2026-09-30T04:00:00Z', '2026-09-30T05:10:00Z', 1),
      (1001, 1, 101, 10, '2026-09-30 10:30:00', '2026-09-30 11:00:00', 'arrived', 2, 'К', '2026-09-30', '2026-09-30T04:05:00Z', '2026-09-30T05:40:00Z', 2),
      (1002, 1, 102, 10, '2026-09-30 11:00:00', '2026-09-30 11:30:00', 'arrived', 3, 'К', '2026-09-30', '2026-09-30T04:10:00Z', NULL, 0),
      (1003, 1, 103, 10, '2026-09-30 11:30:00', '2026-09-30 12:00:00', 'arrived', 4, 'К', '2026-09-30', '2026-09-30T04:15:00Z', NULL, 0),
      (1004, 1, 104, 10, '2026-09-30 12:00:00', '2026-09-30 12:30:00', 'arrived', 5, 'К', '2026-09-30', '2026-09-30T04:20:00Z', NULL, 0),
      (1005, 1, 105, 10, '2026-09-30 12:30:00', '2026-09-30 13:00:00', 'arrived', 6, 'К', '2026-09-30', '2026-09-30T04:25:00Z', NULL, 0),
      (1006, 1, 106, 10, '2026-09-30 13:00:00', '2026-09-30 13:30:00', 'arrived', 7, 'К', '2026-09-30', '2026-09-30T04:30:00Z', NULL, 0),
      (1007, 1, 107, 10, '2026-09-30 13:30:00', '2026-09-30 14:00:00', 'arrived', 8, 'К', '2026-09-30', '2026-09-30T04:35:00Z', NULL, 0),
      (1008, 1, 108, 10, '2026-09-30 14:00:00', '2026-09-30 14:30:00', 'cancelled', 9, 'К', '2026-09-30', '2026-09-30T04:40:00Z', '2026-09-30T05:50:00Z', 1),
      (1100, 1, 102, 11, '2026-09-30 09:00:00', '2026-09-30 09:30:00', 'arrived', 1, NULL, '2026-09-30', '2026-09-30T04:00:00Z', '2026-09-30T05:30:00Z', 1),
      (1101, 1, 103, 11, '2026-09-30 09:30:00', '2026-09-30 10:00:00', 'arrived', 2, NULL, '2026-09-30', '2026-09-30T04:01:00Z', '2026-09-30T05:55:00Z', 1),
      (1200, 1, 104, 12, '2026-09-29 10:00:00', '2026-09-29 10:30:00', 'arrived', 1, 'Н', '2026-09-29', '2026-09-29T04:00:00Z', '2026-09-29T05:00:00Z', 1),
      (2000, 2, 200, 20, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 1, 'Х', '2026-09-30', '2026-09-30T04:00:00Z', '2026-09-30T05:45:00Z', 1);`);
});

describe("queue display management (superadmin only)", () => {
  it("forbids every display endpoint to reception and manager", async () => {
    const { display } = await createDisplay();
    for (const who of ["reception", "manager"] as const) {
      expect((await staff(who, "/displays")).status).toBe(403);
      expect((await staff(who, "/displays", "POST", { name: "Холл 2" })).status).toBe(403);
      expect((await staff(who, `/displays/${display.id}`, "PATCH", { name: "Холл 3" })).status).toBe(403);
      expect((await staff(who, `/displays/${display.id}/rotate-code`, "POST")).status).toBe(403);
      expect((await staff(who, `/displays/${display.id}`, "DELETE")).status).toBe(403);
    }
    expect((await staff("admin", "/displays")).body).toHaveLength(1);
  });

  it("returns the code once on create and stores only its hash", async () => {
    const created = await staff("admin", "/displays", "POST", { name: "  Холл 1  " });
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    expect(created.body.display).toEqual({
      id: expect.any(Number), name: "Холл 1", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
      createdAt: expect.any(String), updatedAt: expect.any(String),
    });

    const stored = await db.query<{ token_hash: string; created_by: number }>("SELECT token_hash, created_by FROM queue_displays");
    const canonical = normalizeDisplayCode(created.body.code) as string;
    expect(stored.rows).toEqual([{ token_hash: hashDisplayCode(canonical), created_by: 1 }]);

    const list = await staff("admin", "/displays");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([created.body.display]);
    const listed = JSON.stringify(list.body);
    expect(listed).not.toContain(canonical);
    expect(listed).not.toContain(created.body.code);
    expect(listed).not.toContain(hashDisplayCode(canonical));
    expect(listed).not.toContain("token");

    expect((await staff("foreignAdmin", "/displays")).body).toEqual([]);
  });

  it("validates display input", async () => {
    const bad = async (body: Record<string, unknown>) => staff("admin", "/displays", "POST", body);
    expect((await bad({ name: "   " })).status).toBe(400);
    expect((await bad({})).status).toBe(400);
    expect((await bad({ name: "x".repeat(101) })).status).toBe(400);
    expect((await bad({ name: "Холл", language: "en" })).status).toBe(400);
    expect((await bad({ name: "Холл", showNames: "yes" })).status).toBe(400);
    expect((await bad({ name: "Холл", voiceEnabled: 1 })).status).toBe(400);
    expect((await bad({ name: "Холл", doctorIds: "10" })).status).toBe(400);
    expect((await bad({ name: "Холл", doctorIds: [10, 0] })).status).toBe(400);
    const unknownDoctor = await bad({ name: "Холл", doctorIds: [10, 999] });
    expect(unknownDoctor).toEqual({ status: 400, body: { error: "Неизвестный врач в списке экрана" } });
    expect((await bad({ name: "Холл", doctorIds: [20] })).body).toEqual({ error: "Неизвестный врач в списке экрана" });
    expect((await staff("admin", "/displays")).body).toEqual([]);

    const ok = await bad({ name: "x".repeat(100), doctorIds: [11, 10, 11], showNames: false, language: "ru", voiceEnabled: false });
    expect(ok.status).toBe(201);
    expect(ok.body.display).toMatchObject({ doctorIds: [11, 10], showNames: false, language: "ru", voiceEnabled: false });
    expect((await bad({ name: "Все врачи", doctorIds: [] })).body.display.doctorIds).toBeNull();
  });

  it("patches only the fields that are sent", async () => {
    const { display } = await createDisplay({ doctorIds: [10], language: "ru" });
    const patched = await staff("admin", `/displays/${display.id}`, "PATCH", { showNames: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ id: display.id, name: "Холл 1", doctorIds: [10], showNames: false, language: "ru", voiceEnabled: true });

    const renamed = await staff("admin", `/displays/${display.id}`, "PATCH", { name: " Регистратура ", doctorIds: null });
    expect(renamed.body).toMatchObject({ name: "Регистратура", doctorIds: null, showNames: false, language: "ru" });

    expect((await staff("admin", `/displays/${display.id}`, "PATCH", { language: "de" })).status).toBe(400);
    expect((await staff("admin", `/displays/${display.id}`, "PATCH", { doctorIds: [20] })).status).toBe(400);
    expect(await staff("admin", "/displays/999", "PATCH", { name: "Нет" })).toEqual({ status: 404, body: { error: "Экран не найден" } });
    // Display ids are not validated in the router: a non-numeric id is simply a screen that does not exist.
    expect(await staff("admin", "/displays/abc", "PATCH", { name: "Нет" })).toEqual({ status: 404, body: { error: "Экран не найден" } });
    expect((await staff("foreignAdmin", `/displays/${display.id}`, "PATCH", { name: "Чужой" })).status).toBe(404);
  });

  it("rotates the code: the old one stops working, the new one works", async () => {
    const created = await createDisplay();
    expect((await tv(created.code)).status).toBe(200);

    const rotated = await staff("admin", `/displays/${created.display.id}/rotate-code`, "POST");
    expect(rotated.status).toBe(200);
    expect(rotated.body.display.id).toBe(created.display.id);
    expect(rotated.body.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(rotated.body.code).not.toBe(created.code);

    expect((await tv(created.code)).status).toBe(404);
    expect((await tv(rotated.body.code)).status).toBe(200);
    expect((await staff("admin", "/displays/999/rotate-code", "POST")).status).toBe(404);
    expect((await staff("foreignAdmin", `/displays/${created.display.id}/rotate-code`, "POST")).status).toBe(404);
  });

  it("deletes (revokes) a display so its code stops working", async () => {
    const created = await createDisplay();
    expect((await staff("foreignAdmin", `/displays/${created.display.id}`, "DELETE")).status).toBe(404);

    const removed = await staff("admin", `/displays/${created.display.id}`, "DELETE");
    expect(removed).toEqual({ status: 200, body: { success: true, id: created.display.id } });
    expect((await tv(created.code)).status).toBe(404);
    expect((await staff("admin", "/displays")).body).toEqual([]);
    expect((await staff("admin", `/displays/${created.display.id}`, "DELETE")).status).toBe(404);
    expect((await staff("admin", `/displays/${created.display.id}`, "PATCH", { name: "Снова" })).status).toBe(404);
  });
});

describe("public queue display endpoint", () => {
  it("answers 404 for malformed and unknown codes and accepts any spelling of a valid one", async () => {
    expect(await tv("abc").then((r) => [r.status, r.body])).toEqual([404, { error: "Экран не найден" }]);
    expect((await tv("22222-22222")).status).toBe(404);
    expect((await tv("11111-11111")).status).toBe(404);

    const { code } = await createDisplay();
    expect((await tv(code.replace("-", "").toLowerCase())).status).toBe(200);
    expect((await tv(` ${code.slice(0, 5)} ${code.slice(6)} `)).status).toBe(200);
  });

  it("answers 403 when the clinic subscription is suspended or expired", async () => {
    const { code } = await createDisplay();
    await db.exec("UPDATE clinics SET subscription_status = 'suspended' WHERE id = 1");
    expect(await tv(code).then((r) => [r.status, r.body])).toEqual([403, { error: "Подписка клиники неактивна" }]);

    await db.exec("UPDATE clinics SET subscription_status = 'expired' WHERE id = 1");
    expect((await tv(code)).status).toBe(403);

    // Clock is 2026-09-30T06:00Z: an end date one second earlier blocks, a later one does not.
    await db.exec("UPDATE clinics SET subscription_status = 'active', subscription_ends_at = '2026-09-30T05:59:59Z' WHERE id = 1");
    expect((await tv(code)).status).toBe(403);
    await db.exec("UPDATE clinics SET subscription_status = 'trialing', subscription_ends_at = '2026-10-15T00:00:00Z' WHERE id = 1");
    expect((await tv(code)).status).toBe(200);
  });

  it("returns today's queue of the display's clinic with masked names and no private data", async () => {
    const { code } = await createDisplay();
    const res = await tv(code);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).toEqual({
      serverTime: "2026-09-30T06:00:00.000Z",
      timeZone: "Asia/Tashkent",
      clinicName: "Клиника Камилова",
      display: { name: "Холл 1", language: "uz_ru", voiceEnabled: true, showNames: true },
      cabinets: [
        {
          doctorId: 11, doctorName: "Юсупов Рустам", specialty: "Кардиолог", room: "3",
          current: { code: "02", name: "Малика Т.", state: "called" },
          waiting: [], waitingCount: 0,
        },
        {
          doctorId: 10, doctorName: "Алиева Нигора", specialty: "Терапевт", room: "5",
          current: { code: "К-01", name: "Алишер К.", state: "serving" },
          waiting: [
            { code: "К-03", name: "Бобур А." },
            { code: "К-04", name: "Малика Т." },
            { code: "К-05", name: "Жасур Э." },
            { code: "К-06", name: "Севара Н." },
            { code: "К-07", name: "Азиз Х." },
          ],
          waitingCount: 6,
        },
      ],
      recentCalls: [
        { key: "1101:1", code: "02", number: 2, name: "Малика Т.", room: "3", doctorName: "Юсупов Рустам", calledAt: "2026-09-30T05:55:00.000Z" },
        { key: "1001:2", code: "К-02", number: 2, name: "Дилноза Ю.", room: "5", doctorName: "Алиева Нигора", calledAt: "2026-09-30T05:40:00.000Z" },
        { key: "1100:1", code: "01", number: 1, name: "Бобур А.", room: "3", doctorName: "Юсупов Рустам", calledAt: "2026-09-30T05:30:00.000Z" },
        { key: "1000:1", code: "К-01", number: 1, name: "Алишер К.", room: "5", doctorName: "Алиева Нигора", calledAt: "2026-09-30T05:10:00.000Z" },
      ],
    });
    // Nothing private leaks: no phones, surnames, patronymics, ids of patients/appointments, other clinics or yesterday.
    for (const forbidden of ["+998", "Каримов", "Бахтиёрович", "Юсупова", "patientId", "appointmentId", "phone", "Чужой", "Рахимова", "1200:"]) {
      expect(res.text).not.toContain(forbidden);
    }
  });

  it("shows only the configured doctors, keeps an empty configured cabinet and hides names when asked", async () => {
    const { code } = await createDisplay({ doctorIds: [12, 10], showNames: false, language: "ru", voiceEnabled: false });
    const res = await tv(code);
    expect(res.status).toBe(200);
    expect(res.body.display).toEqual({ name: "Холл 1", language: "ru", voiceEnabled: false, showNames: false });
    expect(res.body.cabinets.map((c: { doctorId: number }) => c.doctorId)).toEqual([10, 12]);
    expect(res.body.cabinets[0].current).toEqual({ code: "К-01", name: null, state: "serving" });
    expect(res.body.cabinets[0].waiting[0]).toEqual({ code: "К-03", name: null });
    expect(res.body.cabinets[1]).toEqual({
      doctorId: 12, doctorName: "Рахимова Лола", specialty: "Невролог", room: null, current: null, waiting: [], waitingCount: 0,
    });
    expect(res.body.recentCalls.map((c: { key: string }) => c.key)).toEqual(["1001:2", "1000:1"]);
    expect(res.body.recentCalls.every((c: { name: string | null }) => c.name === null)).toBe(true);
    expect(res.text).not.toContain("Алишер");
  });

  it("is rate limited per client IP, preferring CF-Connecting-IP", async () => {
    const { code } = await createDisplay();
    const first = await tv(code, { "cf-connecting-ip": "203.0.113.7" });
    expect(first.headers.get("ratelimit-policy")).toBe("300;w=60");
    expect(first.headers.get("ratelimit-limit")).toBe("300");
    expect(first.headers.get("ratelimit-remaining")).toBe("299");
    const second = await tv(code, { "cf-connecting-ip": "203.0.113.7" });
    expect(second.headers.get("ratelimit-remaining")).toBe("298");
    const otherTv = await tv(code, { "cf-connecting-ip": "198.51.100.9" });
    expect(otherTv.headers.get("ratelimit-remaining")).toBe("299");
    // The limiter runs before the handler, so failures count too and carry the headers.
    const missing = await tv("22222-22222", { "cf-connecting-ip": "198.51.100.9" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("ratelimit-remaining")).toBe("298");
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });
});
