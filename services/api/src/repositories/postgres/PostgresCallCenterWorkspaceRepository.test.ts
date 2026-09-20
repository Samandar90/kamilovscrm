import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, dataProvider: "postgres", jwtSecret: "isolated-call-center-tests-only" } }));
vi.mock("../../config/database", () => ({ dbPool: { query: (sql: string, params?: unknown[]) => db.query(sql, params) } }));
vi.mock("../../container", () => ({ services: { get callCenterWorkspace() { return svc; }, get callCenter() { return new CallCenterService(new PostgresCallCenterRepository()); } } }));
import { PostgresCallCenterWorkspaceRepository } from "./PostgresCallCenterWorkspaceRepository";
import { PostgresCallCenterRepository } from "./PostgresCallCenterRepository";
import { CallCenterWorkspaceService } from "../../services/callCenterWorkspaceService";
import { CallCenterService } from "../../services/callCenterService";
import { callCenterRouter } from "../../routes/callCenterRoutes";
import { errorHandler } from "../../middleware/errorHandler";
import { signAccessToken } from "../../utils/jwt";
import { DEFAULT_WORKSPACE_SETTINGS } from "../interfaces/callCenterWorkspaceTypes";
import { runWithClinicContext } from "../../tenancy/clinicContext";

const db = new PGlite();
// PGlite has one connection: serialize pool checkout as a real connection pool would.
let gate = Promise.resolve();
async function acquire() {
  const previous = gate;
  let release!: () => void;
  gate = new Promise<void>(done => { release = done; });
  await previous;
  return release;
}
const pool = {
  async query(sql: string, params?: unknown[]) { const release = await acquire(); try { return await db.query(sql, params); } finally { release(); } },
  async connect() { const release = await acquire(); return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release }; },
};
const repo = new PostgresCallCenterWorkspaceRepository(pool, "Asia/Tashkent");
const svc = new CallCenterWorkspaceService(repo);
const auth = { userId: 1, clinicId: 1, username: "operator", role: "operator" as const };
const inClinic = <T>(fn: () => T) => runWithClinicContext(1, fn);
const claim = (patientId = 1, campaign = "base", episodeKey = `patient:${patientId}`) => inClinic(() => svc.claim(auth, { patientId, campaign, episodeKey }));
const list = (segment = "base", extra = {}) => inClinic(() => svc.workspace(auth, { segment, ...extra }));
const attempt = (taskId: number, outcome: string, requestId: string, callbackAt?: string) => inClinic(() => svc.attempt(auth, { taskId, outcome, requestId, callbackAt, note: "Звонок" }));
const openSettings = { ...DEFAULT_WORKSPACE_SETTINGS, workStart: "00:00", workEnd: "23:59" };
// SQL uses noon in a deterministic clinic day; JS callback instants use the same clock.
const fixedNow = "2026-08-28T07:00:00.000Z";
let server: Server;
let baseUrl: string;
const http = (path: string, method = "GET", body?: unknown, role: "operator" | "superadmin" | "doctor" | null = "operator") => fetch(`${baseUrl}${path}`, {
  method, headers: { "Content-Type": "application/json", ...(role ? { Authorization: `Bearer ${signAccessToken({ ...auth, role })}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(async () => {
  await db.exec(`CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE SQL STABLE AS $$ SELECT '2026-08-28T07:00:00Z'::timestamptz $$;
    SET search_path=public,pg_catalog;`);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(fixedNow));
  await db.exec(`CREATE TABLE clinics(id bigint primary key);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text, active boolean default true, deleted_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, full_name text, role text, is_active boolean default true, deleted_at timestamptz);
    CREATE TABLE appointments(id bigint primary key, clinic_id bigint not null, patient_id bigint, doctor_id bigint, start_at timestamptz, status text, deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/031_call_reminders.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/032_call_center_workspace.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/call-center", callCenterRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(done => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/call-center`;
}, 30000);
beforeEach(async () => {
  await db.exec(`TRUNCATE call_contact_attempts, call_patient_leases, call_center_tasks, call_center_settings, appointments, patients, users, doctors, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics VALUES (1), (2);
    INSERT INTO patients VALUES (1,1,'Анна','998901111111',null),(2,1,'Без визитов',null,null),(3,2,'Чужой','998902222222',null),(4,1,'Удален',null,now()),(5,1,'Записан','998905555555',null);
    INSERT INTO doctors(id,clinic_id,full_name) VALUES (1,1,'Доктор'),(2,2,'Чужой врач');
    INSERT INTO users(id,clinic_id,full_name,role) VALUES (1,1,'Оператор','operator'),(2,1,'Второй','operator'),(3,2,'Чужой','operator'),(4,1,'Врач','doctor');
    INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status,deleted_at) VALUES (10,1,1,1,((now() at time zone 'Asia/Tashkent') - interval '100 days') at time zone 'UTC','completed',null),
      (11,1,5,1,((now() at time zone 'Asia/Tashkent') + interval '12 hours') at time zone 'UTC','confirmed',null),
      (12,1,5,1,((now() at time zone 'Asia/Tashkent') - interval '100 days') at time zone 'UTC','completed',null);`);
  await inClinic(() => repo.saveSettings(openSettings));
});
afterAll(async () => { if (server) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); await db.close(); vi.restoreAllMocks(); });

describe("workspace real PostgreSQL queries", () => {
  it("defaults to a prioritized deduplicated daily queue and bounds old followups to archive", async () => {
    await db.exec("UPDATE appointments SET start_at=((now() AT TIME ZONE 'Asia/Tashkent')-interval '5 days') AT TIME ZONE 'UTC' WHERE id=12");
    const daily = await inClinic(() => svc.workspace(auth, {}));
    expect(daily.items.map(p => [p.patientId, p.reason])).toEqual([[5, "reminder"], [1, "recall"]]);
    expect(daily.dailyProgress).toEqual({ completed: 0, pending: 2 });
    expect((await list("followup")).items.map(p => p.patientId)).toEqual([5]);
    expect((await list("archive")).items.map(p => p.patientId)).toEqual([1]);
    await db.exec("UPDATE appointments SET start_at=((now() AT TIME ZONE 'Asia/Tashkent')-interval '14 days') AT TIME ZONE 'UTC' WHERE id=12");
    expect((await list("followup")).total).toBe(1);
    await db.exec("UPDATE appointments SET start_at=((now() AT TIME ZONE 'Asia/Tashkent')-interval '15 days') AT TIME ZONE 'UTC' WHERE id=12");
    expect((await list("followup")).total).toBe(0);
  });
  it("prioritizes recommended returns and does not fall back to recall while a recommendation is later", async () => {
    await db.exec("UPDATE appointments SET recommended_return_date=(now() AT TIME ZONE 'Asia/Tashkent')::date+8 WHERE id=10");
    expect((await list("recall")).total).toBe(0);
    await db.exec("UPDATE appointments SET recommended_return_date=(now() AT TIME ZONE 'Asia/Tashkent')::date+7 WHERE id=10");
    expect((await list("today")).items.find(p => p.patientId === 1)).toMatchObject({ reason: "recommended_return", recommendedReturnDate: "2026-09-04" });
    await db.exec("INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status) VALUES(14,1,1,1,'2026-08-29T12:00:00Z','scheduled')");
    expect((await list("recall")).total).toBe(0);
    await db.exec("UPDATE appointments SET status='cancelled' WHERE id=14");
    expect((await list("recall")).total).toBe(1);
    await db.exec("INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status) VALUES(15,1,1,1,'2026-08-27T12:00:00Z','completed')");
    expect((await list("recall")).total).toBe(0);
  });
  it("does not surface another campaign today after a patient was already contacted", async () => {
    await db.exec("UPDATE appointments SET start_at=((now() AT TIME ZONE 'Asia/Tashkent')-interval '5 days') AT TIME ZONE 'UTC' WHERE id=12");
    const { taskId } = await claim(5, "reminder", "appointment:11");
    await attempt(taskId, "confirmed", "daily-completed-1");
    const daily = await list("today");
    expect(daily.items.map(p => p.patientId)).toEqual([1]);
    expect(daily.dailyProgress).toEqual({ completed: 1, pending: 1 });
    expect((await list("followup")).items[0]).toMatchObject({ patientId: 5, contactBlockReason: "cooldown" });
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'");
    expect((await list("today")).items.map(p => p.patientId).sort()).toEqual([1,5]);
  });
  it("preserves the recommendation calendar date with the production pg DATE parser in Asia/Tashkent", async () => {
    await db.exec("UPDATE appointments SET recommended_return_date='2026-09-04' WHERE id=10");
    const pgDatePool = {
      ...pool,
      async query(sql: string, params?: unknown[]) {
        const result = await pool.query(sql, params);
        for (const field of result.fields.filter(field => field.dataTypeID === 1082)) {
          for (const raw of result.rows) {
            const row = raw as Record<string, unknown>;
            if (row[field.name] == null) continue;
            // A separate Node process makes its timezone deterministic on all test runners.
            // PGlite dates are UTC; production pg parses DATE as local midnight instead.
            const value = row[field.name] instanceof Date ? (row[field.name] as Date).toISOString().slice(0,10) : String(row[field.name]);
            const parsed = execFileSync(process.execPath, ["-e", "process.stdout.write(require('pg').types.getTypeParser(1082, 'text')(process.argv[1]).toISOString())", value], {
              cwd: resolve(__dirname, "../../.."), env: { ...process.env, TZ: "Asia/Tashkent" }, encoding: "utf8",
            });
            row[field.name] = new Date(parsed);
          }
        }
        return result;
      },
    };
    const pgService = new CallCenterWorkspaceService(new PostgresCallCenterWorkspaceRepository(pgDatePool, "Asia/Tashkent"));
    const workspace = await inClinic(() => pgService.workspace(auth, { segment: "today" }));
    expect(workspace.items.find(p => p.patientId === 1)).toMatchObject({ recommendedReturnDate: "2026-09-04", reason: "recommended_return" });
  });
  it("validates complete preferences through HTTP and excludes DNC only from working queues", async () => {
    const prefs = { doNotCall: true, preferredLanguage: "uz", preferredCallStart: "10:00", preferredCallEnd: "15:00" };
    expect((await http("/patients/1/preferences", "PUT", prefs, "doctor")).status).toBe(403);
    expect((await http("/patients/3/preferences", "PUT", prefs)).status).toBe(404);
    for (const patch of [{ preferredCallEnd: null }, { preferredCallStart: "9:00" }, { preferredCallStart: "15:00" }, { preferredLanguage: "en" }, { doNotCall: "true" }]) {
      expect((await http("/patients/1/preferences", "PUT", { ...prefs, ...patch })).status).toBe(400);
    }
    expect((await http("/patients/1/preferences", "PUT", {})).status).toBe(400);
    const response = await http("/patients/1/preferences", "PUT", prefs);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(prefs);
    expect((await list()).items.find(p => p.patientId === 1)).toMatchObject({ contactPreferences: prefs, contactBlockReason: "do_not_call" });
    expect((await list("recall")).total).toBe(0);
    expect((await list("archive")).items.find(p => p.patientId === 1)?.contactBlockReason).toBe("do_not_call");
    await expect(claim()).rejects.toMatchObject({ status: 409, message: "do_not_call" });
    await expect(claim(2)).rejects.toMatchObject({ status: 409, message: "no_phone" });
    await http("/patients/1/preferences", "PUT", { ...prefs, doNotCall: false, preferredCallStart: "13:00", preferredCallEnd: "14:00" });
    await expect(claim()).rejects.toMatchObject({ status: 409, message: "outside_hours" });
    await http("/patients/1/preferences", "PUT", { ...prefs, doNotCall: false });
    expect((await claim()).taskId).toBeGreaterThan(0);
    await inClinic(() => repo.saveSettings({ ...openSettings, workEnd: "11:00" }));
    await expect(claim()).rejects.toMatchObject({ status: 409, message: "outside_hours" });
  });
  it("suppresses competing campaigns for pending callbacks and refuses calls before their time", async () => {
    const { taskId } = await claim(1, "recall", "visit:10");
    await attempt(taskId, "callback", "daily-callback-1", "2026-08-28T09:00:00Z");
    const today = await list("today");
    expect(today.items.filter(p => p.patientId === 1)).toMatchObject([{ reason: "callback", contactBlockReason: "cooldown" }]);
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '3 hours'");
    await expect(claim()).rejects.toMatchObject({ status: 409, message: "callback_scheduled" });
    await expect(claim(1, "recall", "visit:10")).rejects.toMatchObject({ status: 409, message: "callback_scheduled" });
    expect((await list("today")).items.find(p => p.patientId === 1)?.contactBlockReason).toBe("callback_scheduled");
    await db.exec("UPDATE call_center_tasks SET due_at=now()-interval '1 minute'");
    expect((await list("today")).items[0]).toMatchObject({ patientId: 1, reason: "callback", contactBlockReason: null });
    await expect(claim()).rejects.toMatchObject({ status: 409, message: "callback_scheduled" });
    expect(await claim(1, "recall", "visit:10")).toEqual({ taskId });
  });
  it("enforces rolling cooldown and clinic-day limits across campaigns while keeping retries idempotent", async () => {
    const { taskId } = await claim();
    const saved = await attempt(taskId, "contacted", "guard-contact-1");
    await expect(claim(1, "recall", "visit:10")).rejects.toMatchObject({ status: 409, message: "cooldown" });
    await http("/patients/1/preferences", "PUT", { doNotCall: true, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null });
    expect(await attempt(taskId, "contacted", "guard-contact-1")).toEqual(saved);
    await http("/patients/1/preferences", "PUT", { doNotCall: false, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null });
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '3 hours'");
    await inClinic(() => repo.saveSettings({ ...openSettings, maxCallsPerDay: 1 }));
    await expect(claim(1, "recall", "visit:10")).rejects.toMatchObject({ status: 409, message: "daily_limit" });
    const progress = (await list("today", { search: "does-not-exist" })).dailyProgress;
    expect(progress.completed).toBe(1);
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'");
    expect((await claim(1, "recall", "visit:10")).taskId).toBeGreaterThan(0);
  });
  it("rechecks changed DNC and global limits before an attempt under the patient lock", async () => {
    const { taskId } = await claim();
    await http("/patients/1/preferences", "PUT", { doNotCall: true, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null });
    await expect(attempt(taskId, "contacted", "changed-dnc-1")).rejects.toMatchObject({ status: 409, message: "do_not_call" });
    expect((await inClinic(() => svc.history(auth, {}))).total).toBe(0);
    await http("/patients/1/preferences", "PUT", { doNotCall: false, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null });
    await db.exec("INSERT INTO call_contact_attempts(clinic_id,task_id,patient_id,patient_name,campaign,outcome,called_by,called_by_name,request_id) VALUES(1,1,1,'Анна','base','contacted',2,'Второй','other-contact-1')");
    await expect(attempt(taskId, "contacted", "changed-limit-1")).rejects.toMatchObject({ status: 409, message: "cooldown" });
  });
  it("uses a guarded base conversation for manual archive work", async () => {
    const archived = (await list("archive")).items.find(p => p.patientId === 1)!;
    expect(archived).toMatchObject({ reason: "followup", campaign: "base", episodeKey: "patient:1" });
    const { taskId } = await claim(archived.patientId, archived.campaign, archived.episodeKey);
    await attempt(taskId, "contacted", "archive-manual-1");
    expect((await list("archive")).items.find(p => p.patientId === 1)).toMatchObject({ taskId, status: "done", contactBlockReason: "cooldown" });
  });
  it("serializes concurrent claims and preference changes and replays concurrent attempts once", async () => {
    const claims = await Promise.allSettled([
      claim(), inClinic(() => svc.claim({ ...auth, userId: 2 }, { patientId: 1, campaign: "recall", episodeKey: "visit:10" })),
    ]);
    expect(claims.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    if (claims[0].status !== "fulfilled") throw new Error("First claim should succeed");
    const taskId = claims[0].value.taskId;
    const saved = await Promise.all([attempt(taskId, "contacted", "concurrent-attempt-1"), attempt(taskId, "contacted", "concurrent-attempt-1")]);
    expect(saved[0]).toEqual(saved[1]);
    expect((await inClinic(() => svc.history(auth, {}))).total).toBe(1);
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'");
    const preferences = { doNotCall: true, preferredLanguage: null, preferredCallStart: null, preferredCallEnd: null };
    const race = await Promise.allSettled([inClinic(() => svc.savePreferences(auth, 1, preferences)), claim()]);
    expect(race[0]).toMatchObject({ status: "fulfilled", value: preferences });
    expect(race[1]).toMatchObject({ status: "rejected", reason: { status: 409, message: "do_not_call" } });
  });
  it("merges old stored settings without dropping existing custom values", async () => {
    await db.query("UPDATE call_center_settings SET settings=$1::jsonb WHERE clinic_id=1", [JSON.stringify({ ...openSettings, followupMaxDays: undefined, returnLeadDays: undefined, maxCallsPerDay: undefined, minContactIntervalMinutes: undefined, script: "Существующий скрипт", followupDays: 30 })]);
    const settings = await inClinic(() => repo.getSettings());
    expect(settings).toMatchObject({ script: "Существующий скрипт", followupDays: 30, followupMaxDays: 30, returnLeadDays: 7, maxCallsPerDay: 3, minContactIntervalMinutes: 120 });
  });
  it("serves the actual HTTP contract with authentication, role checks and durable outcomes", async () => {
    expect((await http("/workspace", "GET", undefined, null)).status).toBe(401);
    expect((await http("/workspace", "GET", undefined, "doctor")).status).toBe(403);
    expect((await http("/settings", "PUT", DEFAULT_WORKSPACE_SETTINGS)).status).toBe(403);
    expect((await http("/preview", "POST", DEFAULT_WORKSPACE_SETTINGS)).status).toBe(403);
    expect((await http("/settings")).status).toBe(200);
    expect((await http("/settings", "PUT", DEFAULT_WORKSPACE_SETTINGS, "superadmin")).status).toBe(200);
    expect(await (await http("/preview", "POST", DEFAULT_WORKSPACE_SETTINGS, "superadmin")).json()).toMatchObject({ base: 3, recall: 1 });
    const workspace = await (await http("/workspace?segment=base")).json() as { total: number; pageSize: number };
    expect(workspace).toMatchObject({ total: 3, pageSize: 30 });
    const claimed = await http("/claim", "POST", { patientId: 1, campaign: "base", episodeKey: "patient:1" });
    expect(claimed.status).toBe(200);
    const { taskId } = await claimed.json() as { taskId: number };
    expect((await http("/assign", "POST", { taskId, operatorId: 2 })).status).toBe(403);
    expect((await http("/assign", "POST", { taskId, operatorId: 2 }, "superadmin")).status).toBe(200);
    expect((await http("/attempts", "POST", { taskId, outcome: "contacted", requestId: "http-attempt-1", note: "Принято" })).status).toBe(200);
    expect(await (await http("/history?patientId=1")).json()).toMatchObject({ total: 1, items: [{ outcome: "contacted", note: "Принято" }] });
    expect((await http("/release", "POST", { patientId: 1 })).status).toBe(200);
    expect((await http("/rules")).status).toBe(200);
    expect((await http("/mark", "POST", { appointmentId: 11, daysBefore: 1, outcome: "confirmed" })).status).toBe(410);
    expect((await db.query("SELECT * FROM call_reminder_logs")).rows).toHaveLength(0);
  });
  it("does not let the legacy mark endpoint write a foreign appointment", async () => {
    await db.exec(`INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status,deleted_at) VALUES (30,2,3,2,now(),'scheduled',null)`);
    await expect(inClinic(() => new PostgresCallCenterRepository().mark({ appointmentId: 30, daysBefore: 1, outcome: "confirmed", note: null, calledBy: 1 }))).rejects.toMatchObject({ status: 404 });
    expect((await db.query("SELECT * FROM call_reminder_logs")).rows).toHaveLength(0);
  });
  it("includes all existing patients without requiring future appointments; scopes counts and campaigns", async () => {
    const base = await list();
    expect(base.total).toBe(3);
    expect(base.items.map(p => p.patientId).sort()).toEqual([1,2,5]);
    expect(base.counts).toEqual({ base: 3, recall: 1, followup: 0, reminder: 1, callbacks: 0, today: 2, archive: 2 });
    expect((await list("recall")).items[0]).toMatchObject({ patientId: 1, episodeKey: "visit:10", visitsCount: 1 });
    expect((await list("reminder")).items[0]).toMatchObject({ patientId: 5, episodeKey: "appointment:11" });
    expect((await list("base", { search: "Без" })).total).toBe(1);
  });
  it("treats zero reminder days as remaining appointments today and includes the configured last calendar day", async () => {
    // Freeze the SQL clock relative to the fixture: 23:59 today remains future until the day's final minute.
    await db.exec(`UPDATE appointments SET start_at=((date_trunc('day',now() AT TIME ZONE 'Asia/Tashkent')+interval '1 day'-interval '1 millisecond') AT TIME ZONE 'UTC') WHERE id=11`);
    const zero = await inClinic(() => svc.preview({ ...auth, role: "superadmin" }, { ...DEFAULT_WORKSPACE_SETTINGS, reminderDays: 0 }));
    expect(zero.reminder).toBe(1);
    await db.exec(`UPDATE appointments SET start_at=((date_trunc('day',now() AT TIME ZONE 'Asia/Tashkent')+interval '2 days'-interval '1 millisecond') AT TIME ZONE 'UTC') WHERE id=11`);
    const one = await inClinic(() => svc.preview({ ...auth, role: "superadmin" }, { ...DEFAULT_WORKSPACE_SETTINGS, reminderDays: 1 }));
    expect(one.reminder).toBe(1);
  });
  it("rejects foreign patients and stale episodes without creating tasks", async () => {
    await expect(claim(3)).rejects.toMatchObject({ status: 404 });
    await expect(claim(1, "recall", "visit:999")).rejects.toMatchObject({ status: 409 });
    expect((await db.query("SELECT * FROM call_center_tasks")).rows).toHaveLength(0);
  });
  it("leases a patient exclusively across campaigns, renews own lease and only releases own lease", async () => {
    const first = await claim();
    expect(await claim()).toEqual(first);
    const other = { ...auth, userId: 2 };
    await expect(inClinic(() => svc.claim(other, { patientId: 1, campaign: "recall", episodeKey: "visit:10" }))).rejects.toMatchObject({ status: 409 });
    await inClinic(() => svc.release(other, { patientId: 1 }));
    await expect(inClinic(() => svc.claim(other, { patientId: 1, campaign: "base", episodeKey: "patient:1" }))).rejects.toMatchObject({ status: 409 });
    await inClinic(() => svc.release(auth, { patientId: 1 }));
    expect(await inClinic(() => svc.claim(other, { patientId: 1, campaign: "base", episodeKey: "patient:1" }))).toEqual(first);
  });
  it("rejects expired leases and allows another operator to take over", async () => {
    const { taskId } = await claim();
    await db.exec("UPDATE call_patient_leases SET expires_at=now()-interval '1 second'");
    await expect(attempt(taskId, "contacted", "expired-1")).rejects.toMatchObject({ status: 409 });
    const other = { ...auth, userId: 2 };
    await inClinic(() => svc.claim(other, { patientId: 1, campaign: "base", episodeKey: "patient:1" }));
    await expect(attempt(taskId, "contacted", "expired-2")).rejects.toMatchObject({ status: 409 });
    expect((await inClinic(() => svc.history(auth, {}))).total).toBe(0);
  });
  it("does not let delayed cleanup of an old task release a newer same-patient lease", async () => {
    const old = await claim();
    const current = await claim(1, "recall", "visit:10");
    expect(current.taskId).not.toBe(old.taskId);
    await inClinic(() => svc.release(auth, { patientId: 1, taskId: old.taskId }));
    await expect(inClinic(() => svc.claim({ ...auth, userId: 2 }, { patientId: 1, campaign: "base", episodeKey: "patient:1" }))).rejects.toMatchObject({ status: 409 });
    expect((await attempt(current.taskId, "contacted", "current-lease-1")).outcome).toBe("contacted");
  });
  it("includes legacy reminder history while excluding foreign appointment and patient joins", async () => {
    const { taskId } = await claim();
    const current = await attempt(taskId, "contacted", "new-history-1");
    await db.exec(`INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status,deleted_at) VALUES (30,2,3,2,now(),'scheduled',null),(31,1,3,1,now(),'scheduled',null);
      INSERT INTO call_reminder_logs(clinic_id,appointment_id,days_before,outcome,note,called_by,called_at) VALUES
        (1,11,1,'rescheduled','Старая запись',1,now()-interval '1 day'),
        (2,30,1,'cancelled','Чужой журнал',3,now()),
        (1,30,2,'cancelled','Ошибочная клиника записи',1,now()),
        (1,31,1,'cancelled','Чужой пациент',1,now());`);
    const history = await inClinic(() => svc.history(auth, {}));
    expect(history.total).toBe(2);
    expect(history.items[0]).toEqual(current);
    expect(history.items[1]).toMatchObject({ patientId: 5, patientName: "Записан", campaign: "reminder", outcome: "rescheduled", note: "Старая запись", calledByName: "Оператор", callbackAt: null });
    expect(history.items[1].id).toBeLessThan(0);
    expect((await inClinic(() => svc.history(auth, { patientId: 5 }))).total).toBe(1);
    expect((await inClinic(() => svc.history(auth, { patientId: 1 }))).total).toBe(1);
  });
  it("isolates settings, history, attempts and assignment across clinics", async () => {
    const { taskId } = await claim();
    await attempt(taskId, "contacted", "request-1");
    await inClinic(() => svc.saveSettings({ ...auth, role: "superadmin" }, { ...DEFAULT_WORKSPACE_SETTINGS, recallEnabled: false }));
    const foreign = { ...auth, userId: 3, clinicId: 2 };
    await runWithClinicContext(2, async () => {
      expect((await svc.getSettings(foreign)).recallEnabled).toBe(true);
      expect((await svc.history(foreign, {})).total).toBe(0);
      await expect(svc.history(foreign, { patientId: 1 })).rejects.toMatchObject({ status: 404 });
      await expect(svc.attempt(foreign, { taskId, outcome: "contacted", requestId: "request-1" })).rejects.toMatchObject({ status: 404 });
      await expect(svc.assign({ ...foreign, role: "superadmin" }, { taskId, operatorId: null })).rejects.toMatchObject({ status: 404 });
    });
  });
  it("does not mutate history snapshots or appointment scheduling on a call outcome", async () => {
    const before = (await db.query("SELECT * FROM appointments ORDER BY id")).rows;
    const { taskId } = await claim(5, "reminder", "appointment:11");
    await attempt(taskId, "confirmed", "request-1");
    await db.exec("UPDATE patients SET full_name='Новое имя' WHERE id=5; UPDATE users SET full_name='Новый оператор' WHERE id=1");
    expect((await inClinic(() => svc.history(auth, { patientId: 5 }))).items[0]).toMatchObject({ patientName: "Записан", calledByName: "Оператор", outcome: "confirmed" });
    expect((await db.query("SELECT * FROM appointments ORDER BY id")).rows).toEqual(before);
    expect((await list("reminder")).total).toBe(0);
  });
  it("pages patients with stable ordering and treats search wildcards literally", async () => {
    await db.exec("INSERT INTO patients(id,clinic_id,full_name) SELECT id,1,'Тест ' || id FROM generate_series(20,55) id");
    expect((await list()).items).toHaveLength(30);
    const second = await list("base", { page: 2 });
    expect(second.total).toBe(39);
    expect(second.items).toHaveLength(9);
    expect((await list("base", { page: 3 })).items).toHaveLength(0);
    expect((await list("base", { search: "%" })).total).toBe(0);
  });
  it("appends attempts once, requires valid lease and keeps immutable history", async () => {
    const { taskId } = await claim();
    const saved = await attempt(taskId, "contacted", "request-1");
    expect(await attempt(taskId, "contacted", "request-1")).toEqual(saved);
    await expect(attempt(taskId, "declined", "request-1")).rejects.toMatchObject({ status: 409 });
    await expect(attempt(taskId, "declined", "request-2")).rejects.toMatchObject({ status: 409 });
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '3 hours'");
    await claim();
    await attempt(taskId, "declined", "request-2");
    const history = await inClinic(() => svc.history(auth, { patientId: 1 }));
    expect(history.total).toBe(2);
    expect(history.items.map(a => a.outcome)).toEqual(["declined", "contacted"]);
    expect((await list()).items.find(p => p.patientId === 1)?.status).toBe("done");
  });
  it.each(["contacted", "no_answer"])("starts a fresh base call cycle after terminal outcome %s without deleting history", async outcome => {
    const { taskId } = await claim();
    const previousAttempts = outcome === "no_answer" ? 3 : 1;
    for (let n = 1; n <= previousAttempts; n++) {
      if (n > 1) { await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'; UPDATE call_center_tasks SET due_at=now()-interval '1 minute'"); await claim(); }
      await attempt(taskId, outcome, `base-old-${n}`);
    }
    await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'; UPDATE call_center_tasks SET due_at=now()-interval '1 minute'");
    expect(await claim()).toEqual({ taskId });
    expect((await list()).items.find(p => p.patientId === 1)).toMatchObject({ status: "new", attempts: 0, dueAt: null });
    expect((await inClinic(() => svc.history(auth, { patientId: 1 }))).total).toBe(previousAttempts);
    await attempt(taskId, "no_answer", "base-new-1");
    expect((await list()).items.find(p => p.patientId === 1)).toMatchObject({ status: "callback", attempts: 1 });
    expect((await inClinic(() => svc.history(auth, { patientId: 1 }))).total).toBe(previousAttempts + 1);
  });
  it("replays an idempotent callback after its scheduled time but rejects a new past callback", async () => {
    const { taskId } = await claim();
    await expect(attempt(taskId, "callback", "invalid-time-1", "2001-01-01T10:00:00Z")).rejects.toMatchObject({ status: 400 });
    const now = Date.now();
    const callbackAt = new Date(now + 60000).toISOString();
    const saved = await attempt(taskId, "callback", "callback-time-1", callbackAt);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 120000);
    try { expect(await attempt(taskId, "callback", "callback-time-1", callbackAt)).toEqual(saved); }
    finally { clock.mockReturnValue(Date.parse(fixedNow)); }
  });
  it("logically closes recall callbacks while a booking is active and restores them on cancellation", async () => {
    const { taskId } = await claim(1, "recall", "visit:10");
    const callbackAt = new Date(Date.now() + 86400000).toISOString();
    await attempt(taskId, "callback", "request-1", callbackAt);
    await db.exec(`INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status,deleted_at) VALUES (13,1,1,1,((now() at time zone 'Asia/Tashkent') + interval '2 days') at time zone 'UTC','scheduled',null)`);
    await inClinic(() => svc.saveSettings({ ...auth, role: "superadmin" }, { ...DEFAULT_WORKSPACE_SETTINGS, recallEnabled: false }));
    expect((await list("recall")).total).toBe(0);
    expect((await list("callbacks")).total).toBe(0);
    await expect(claim(1, "recall", "visit:10")).rejects.toMatchObject({ status: 409 });
    expect((await inClinic(() => svc.history(auth, {}))).total).toBe(1);
    await db.exec("UPDATE appointments SET status='cancelled' WHERE id=13");
    expect((await list("callbacks")).items[0]).toMatchObject({ taskId, dueAt: callbackAt, campaign: "recall" });

  });
  it("retries unanswered calls until the configured attempt limit", async () => {
    await db.exec("UPDATE appointments SET start_at=((now() AT TIME ZONE 'Asia/Tashkent')-interval '5 days') AT TIME ZONE 'UTC' WHERE id IN (10,12)");
    const { taskId } = await claim(1, "followup", "visit:10");
    for (let n = 1; n <= 3; n++) {
      if (n > 1) { await db.exec("UPDATE call_contact_attempts SET called_at=now()-interval '1 day'; UPDATE call_center_tasks SET due_at=now()-interval '1 minute'"); await claim(1, "followup", "visit:10"); }
      await attempt(taskId, "no_answer", `request-${n}`);
    }
    expect((await list("callbacks")).total).toBe(0);
    expect((await list("followup")).items.map(p => p.patientId)).toEqual([5]);
    const done = await list("followup", { status: "done" });
    expect(done.items[0]).toMatchObject({ patientId: 1, status: "exhausted", attempts: 3 });
    await expect(claim(1, "followup", "visit:10")).rejects.toMatchObject({ status: 409 });
  });
  it("previews without saving and rejects foreign/invalid assignees", async () => {
    const preview = await inClinic(() => svc.preview({ ...auth, role: "superadmin" }, { ...DEFAULT_WORKSPACE_SETTINGS, recallDays: 200 }));
    expect(preview.recall).toBe(0);
    expect((await list()).counts.recall).toBe(1);
    const { taskId } = await claim();
    for (const operatorId of [3,4]) await expect(inClinic(() => svc.assign({ ...auth, role: "superadmin" }, { taskId, operatorId }))).rejects.toMatchObject({ status: 400 });
    await inClinic(() => svc.assign({ ...auth, role: "superadmin" }, { taskId, operatorId: 2 }));
    expect((await list("base", { operatorId: 2 })).items[0]).toMatchObject({ taskId, assignedTo: 2, assignedToName: "Второй" });
  });
});
