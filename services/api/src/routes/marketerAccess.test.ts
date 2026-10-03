import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../config/env", () => ({
  env: {
    nodeEnv: "test", isProduction: false, allowDevBootstrap: false, jwtSecret: "isolated-marketer-access-tests-only",
    dataProvider: "postgres", reportsTimezone: "Asia/Tashkent", corsOrigins: [],
  },
}));
vi.mock("../config/database", () => ({
  dbPool: {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: () => pool.connect(),
  },
}));
// The "@/..." alias of tsconfig is not known to vitest; no OpenAI client is created in tests.
vi.mock("@/lib/openai", () => ({ hasOpenAI: false, openai: null }));
// The real root router with the real container: every repository talks to PGlite through the mocked pool.
import { rootRouter } from "./index";
import { errorHandler } from "../middleware/errorHandler";
import { signAccessToken } from "../utils/jwt";
import { PostgresUsersRepository } from "../repositories/postgres/PostgresUsersRepository";
import { runWithClinicContext } from "../tenancy/clinicContext";
import type { UserRole } from "../auth/permissions";

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

const users = {
  platformAdmin: { userId: 1, clinicId: 1, role: "superadmin" },
  reception: { userId: 2, clinicId: 1, role: "reception" },
  marketer: { userId: 3, clinicId: 1, role: "marketer" },
  clinicAdmin: { userId: 4, clinicId: 2, role: "superadmin" },
  foreignMarketer: { userId: 5, clinicId: 2, role: "marketer" },
} as const satisfies Record<string, { userId: number; clinicId: number; role: UserRole }>;
type Who = keyof typeof users;
let server: Server;
let root: string;

const tokenOf = (who: Who) => signAccessToken({ username: who, ...users[who] });
const call = async (token: string, path: string, method = "GET", body?: unknown) => {
  const res = await fetch(`${root}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const as = (who: Who, path: string, method = "GET", body?: unknown) => call(tokenOf(who), path, method, body);
const clinicCount = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM clinics")).rows[0].n);

beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigserial primary key, name text not null, slug text, logo_url text, primary_color text,
      subscription_status text, subscription_ends_at timestamptz);
    CREATE TABLE users(id bigserial primary key, clinic_id bigint not null, username text not null, password_hash text not null default 'x',
      full_name text, role text not null, is_active boolean default true, is_platform_admin boolean not null default false,
      doctor_id bigint, last_login_at timestamptz, failed_login_attempts integer default 0, locked_until timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz default now(), deleted_at timestamptz);`);
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
  await db.exec(`TRUNCATE users, clinics RESTART IDENTITY;
    INSERT INTO clinics (name, slug, subscription_status, subscription_ends_at) VALUES
      ('Клиника Камилова', 'kamilovs', 'trialing', '2099-01-01T00:00:00Z'),
      ('Вторая клиника', 'second', 'active', NULL);
    INSERT INTO users (id, clinic_id, username, full_name, role, is_platform_admin) VALUES
      (1, 1, 'platformAdmin', 'Владелец', 'superadmin', TRUE),
      (2, 1, 'reception', 'Ресепшен', 'reception', FALSE),
      (3, 1, 'marketer', 'Таргетолог', 'marketer', FALSE),
      (4, 2, 'clinicAdmin', 'Админ второй клиники', 'superadmin', FALSE),
      (5, 2, 'foreignMarketer', 'Чужой таргетолог', 'marketer', FALSE);
    SELECT setval(pg_get_serial_sequence('users', 'id'), 100);`);
});
const clinicOf = async (username: string) =>
  (await db.query<{ clinic_id: number }>("SELECT clinic_id FROM users WHERE username = $1", [username])).rows.map((row) => Number(row.clinic_id));

describe("POST /api/clinics", () => {
  it("is open to the platform admin only", async () => {
    const body = { name: "Новая клиника", slug: "new-clinic" };
    expect((await as("marketer", "/clinics", "POST", body)).status).toBe(403);
    expect((await as("clinicAdmin", "/clinics", "POST", body)).status).toBe(403);
    expect((await as("reception", "/clinics", "POST", body)).status).toBe(403);
    expect(await clinicCount()).toBe(2);

    const created = await as("platformAdmin", "/clinics", "POST", body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Новая клиника", slug: "new-clinic" });
    expect(await clinicCount()).toBe(3);
  });
});

describe("clinic of a new user", () => {
  const body = { username: "target2", password: "secret1", full_name: "Новый таргетолог", role: "marketer" };

  it("is the creator's clinic, not clinic 1", async () => {
    const created = await as("clinicAdmin", "/users", "POST", body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ username: "target2", role: "marketer", clinicId: 2, doctorId: null });
    expect(await clinicOf("target2")).toEqual([2]);
  });

  it("cannot be chosen in the request body", async () => {
    expect((await as("clinicAdmin", "/users", "POST", { ...body, clinic_id: 1 })).status).toBe(403);
    expect(await clinicOf("target2")).toEqual([]);
    expect((await as("clinicAdmin", "/users", "POST", { ...body, clinic_id: 2 })).status).toBe(201);
    expect(await clinicOf("target2")).toEqual([2]);
  });

  it("falls back to the request's clinic in the repository and never to clinic 1", async () => {
    const repository = new PostgresUsersRepository();
    const data = { username: "direct", password: "hash", fullName: "Напрямую", role: "marketer" as const };
    const created = await runWithClinicContext(2, () => repository.create(data));
    expect(created.clinicId).toBe(2);
    await expect(repository.create({ ...data, username: "nocontext" })).rejects.toMatchObject({ status: 401 });
    expect(await clinicOf("nocontext")).toEqual([]);
  });
});

describe("superadmin of another clinic", () => {
  it("cannot switch on, rename, delete or reset the password of a marketer of clinic 1", async () => {
    await db.exec("UPDATE users SET is_active = false WHERE id = 3");
    const before = (await db.query("SELECT * FROM users WHERE id = 3")).rows;

    expect((await as("clinicAdmin", "/users/3/toggle-active", "PATCH")).status).toBe(404);
    expect((await as("clinicAdmin", "/users/3/password", "PATCH", { password: "secret2" })).status).toBe(404);
    expect((await as("clinicAdmin", "/users/3", "PUT", { full_name: "Чужое имя", is_active: true })).status).toBe(404);
    expect((await as("clinicAdmin", "/users/3", "DELETE")).status).toBe(404);
    expect((await db.query("SELECT * FROM users WHERE id = 3")).rows).toEqual(before);

    // The owner of clinic 1 still manages the same account.
    const toggled = await as("platformAdmin", "/users/3/toggle-active", "PATCH");
    expect(toggled.status).toBe(200);
    expect(toggled.body).toMatchObject({ id: 3, isActive: true });
  });
});

describe("marketer account is checked on every request", () => {
  it("loses access at once when the account is switched off, with the same token", async () => {
    const token = tokenOf("marketer");
    const me = await call(token, "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: 3, role: "marketer", clinicId: 1 });
    expect((await call(token, "/clinic/me")).status).toBe(200);

    await db.exec("UPDATE users SET is_active = false WHERE id = 3");
    expect(await call(token, "/auth/me")).toEqual({ status: 401, body: { error: "Invalid or expired token" } });
    expect((await call(token, "/clinic/me")).status).toBe(401);
    expect((await call(token, "/platform/access")).status).toBe(401);
    // A guarded router answers 401 too: the account check runs before the role check.
    expect((await call(token, "/patients")).status).toBe(401);

    await db.exec("UPDATE users SET is_active = true WHERE id = 3");
    expect((await call(token, "/auth/me")).status).toBe(200);
  });

  it.each([
    ["deleted", "UPDATE users SET deleted_at = now() WHERE id = 3"],
    ["given another role", "UPDATE users SET role = 'reception' WHERE id = 3"],
    ["moved to another clinic", "UPDATE users SET clinic_id = 2 WHERE id = 3"],
  ])("loses access when the account is %s", async (_label, sql) => {
    const token = tokenOf("marketer");
    expect((await call(token, "/clinic/me")).status).toBe(200);
    await db.exec(sql);
    expect((await call(token, "/clinic/me")).status).toBe(401);
    // Staff and the other clinic's marketer are not affected.
    expect((await as("reception", "/clinic/me")).status).toBe(200);
    expect((await as("foreignMarketer", "/clinic/me")).status).toBe(200);
  });

  it("does not check staff tokens against the database", async () => {
    await db.exec("UPDATE users SET is_active = false WHERE id = 2");
    expect((await as("reception", "/clinic/me")).status).toBe(200);
  });
});

describe("GET /api/clinic/me", () => {
  const subscriptionKeys = (body: Record<string, unknown>) => Object.keys(body).filter((key) => key.startsWith("subscription"));

  it("gives a marketer the clinic's name and branding without the subscription", async () => {
    const res = await as("marketer", "/clinic/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, name: "Клиника Камилова", slug: "kamilovs", logoUrl: "/logo.png", primaryColor: "#6D28D9" });
    expect(subscriptionKeys(res.body)).toEqual([]);
  });

  it("still gives staff of the same clinic the three subscription fields", async () => {
    const res = await as("reception", "/clinic/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 1, name: "Клиника Камилова", subscriptionStatus: "trialing", subscriptionEndsAt: "2099-01-01T00:00:00.000Z",
    });
    expect(res.body.subscriptionDaysLeft).toBeGreaterThan(0);
    expect(subscriptionKeys(res.body).sort()).toEqual(["subscriptionDaysLeft", "subscriptionEndsAt", "subscriptionStatus"]);
  });

  it("gives a marketer of clinic 2 the name of clinic 2", async () => {
    const res = await as("foreignMarketer", "/clinic/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 2, name: "Вторая клиника" });
    expect(subscriptionKeys(res.body)).toEqual([]);
  });

  it("keeps the subscription out of the fallback answer for a marketer", async () => {
    // No clinic row: the controller answers with its built-in fallback object.
    await db.exec("DELETE FROM clinics WHERE id = 2");
    const res = await as("foreignMarketer", "/clinic/me");
    expect(res.status).toBe(200);
    expect(subscriptionKeys(res.body)).toEqual([]);
    await db.exec("DELETE FROM clinics WHERE id = 1");
    expect(subscriptionKeys((await as("reception", "/clinic/me")).body)).toHaveLength(3);
  });
});

describe("marketer on the data routers", () => {
  // One route per mount of routes/index.ts, plus the two requireAuth-only routes that sit behind a role check.
  it.each([
    ["GET", "/users"],
    ["GET", "/patients"],
    ["GET", "/doctors"],
    ["GET", "/appointments"],
    ["GET", "/services"],
    ["GET", "/invoices"],
    ["GET", "/payments"],
    ["GET", "/expenses"],
    ["GET", "/cash-register/shift/current"],
    ["GET", "/reports/summary"],
    ["GET", "/ai/messages"],
    ["GET", "/uzi-templates"],
    ["GET", "/attendance"],
    ["GET", "/call-center/workspace"],
    ["GET", "/questionnaires"],
    ["GET", "/queue/today"],
    ["GET", "/auth/audit-log"],
    ["GET", "/debug/ai"],
    ["POST", "/users"],
    ["POST", "/users/2/impersonate"],
  ])("%s /api%s answers 403", async (method, path) => {
    const res = await as("marketer", path, method, method === "POST" ? {} : undefined);
    expect(res.status).toBe(403);
  });

  it("the same router answers 200 to staff, so the 403 comes from the role", async () => {
    const res = await as("platformAdmin", "/users");
    expect(res.status).toBe(200);
    expect(res.body.map((user: { id: number }) => user.id).sort()).toEqual([1, 2, 3]);
  });
});
