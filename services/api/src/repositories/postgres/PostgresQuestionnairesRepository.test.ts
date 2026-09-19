import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-questionnaire-tests-only" } }));
vi.mock("../../container", () => ({ services: { get questionnaires() { return svc; } } }));
vi.mock("../../config/database", () => ({ dbPool: { query: (sql: string, params?: unknown[]) => pool.query(sql, params) } }));
import { PostgresQuestionnairesRepository } from "./PostgresQuestionnairesRepository";
import { PostgresAppointmentsRepository } from "./PostgresAppointmentsRepository";
import { QuestionnairesService } from "../../services/questionnairesService";
import { questionnairesRouter } from "../../routes/questionnairesRoutes";
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
const svc = new QuestionnairesService(
  new PostgresQuestionnairesRepository(pool, "Asia/Tashkent"),
  new PostgresAppointmentsRepository()
);

type Role = "superadmin" | "manager" | "reception" | "doctor" | "nurse" | "cashier" | "operator";
const users: Record<string, { userId: number; role: Role; doctorId?: number | null; nurseDoctorId?: number | null; clinicId?: number }> = {
  manager: { userId: 1, role: "manager" },
  reception: { userId: 2, role: "reception" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  otherDoctor: { userId: 4, role: "doctor", doctorId: 11 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
  cashier: { userId: 6, role: "cashier" },
  operator: { userId: 7, role: "operator" },
  foreignManager: { userId: 8, role: "manager", clinicId: 2 },
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

const intakeQuestions = [
  { id: "complaints", label: "Жалобы", type: "textarea", required: true },
  { id: "allergy", label: "Есть аллергия?", type: "yes_no", required: false },
  { id: "blood", label: "Группа крови", type: "single_choice", options: ["I", "II", "III", "IV"] },
  { id: "chronic", label: "Хронические болезни", type: "multi_choice", options: ["Диабет", "Астма", "Гипертония"] },
  { id: "weight", label: "Вес, кг", type: "number" },
  { id: "lastVisit", label: "Последний визит", type: "date" },
];
const createTemplate = async (who: keyof typeof users = "manager", extra: Record<string, unknown> = {}) =>
  http(who, "/templates", "POST", { title: "Первичная анкета", questions: intakeQuestions, ...extra });

beforeAll(async () => {
  await db.exec(`CREATE TABLE clinics(id bigint primary key);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz, created_by_doctor_id bigint);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text, deleted_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, full_name text);
    CREATE TABLE appointments(id bigint primary key, clinic_id bigint not null, patient_id bigint, doctor_id bigint, deleted_at timestamptz);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../../../packages/database/migrations/034_patient_questionnaires.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/questionnaires", questionnairesRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/questionnaires`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE patient_questionnaires, questionnaire_templates, appointments, users, doctors, patients, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics VALUES (1), (2);
    INSERT INTO patients VALUES (100,1,'Анна Каримова','998901111111',null,null),(101,1,'Бобур 100%_','998902222222',null,null),
      (102,1,'Архив',null,now(),null),(200,2,'Чужой пациент',null,null,null),(103,1,'Новая пациентка','998903333333',null,10);
    INSERT INTO doctors VALUES (10,1,'Др. Алиева',null),(11,1,'Др. Юсупов',null),(20,2,'Чужой врач',null);
    INSERT INTO users VALUES (1,1,'Менеджер'),(2,1,'Регистратура'),(3,1,'Алиева'),(4,1,'Юсупов'),(5,1,'Медсестра');
    INSERT INTO appointments VALUES (500,1,100,10,null),(501,1,101,11,null);`);
});

describe("questionnaire templates", () => {
  it("lets a manager build a template and rejects malformed questions", async () => {
    const created = await createTemplate("manager", { doctorId: 11, description: "  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Первичная анкета", description: null, doctorId: 11, doctorName: "Др. Юсупов", active: true, usageCount: 0 });
    expect(created.body.questions[1]).toEqual({ id: "allergy", label: "Есть аллергия?", type: "yes_no", required: false });

    const bad = (questions: unknown) => http("manager", "/templates", "POST", { title: "X", questions });
    expect((await bad([])).status).toBe(400);
    expect((await bad([{ id: "a", label: "Выбор", type: "single_choice", options: ["Один"] }])).status).toBe(400);
    expect((await bad([{ id: "a", label: "Выбор", type: "multi_choice", options: ["Да", "да"] }])).status).toBe(400);
    expect((await bad([{ id: "a", label: "A", type: "text" }, { id: "a", label: "B", type: "text" }])).status).toBe(400);
    expect((await bad([{ id: "a b", label: "A", type: "text" }])).status).toBe(400);
    expect((await bad([{ id: "a", label: "A", type: "file" }])).status).toBe(400);
    expect((await http("manager", "/templates", "POST", { title: "X", doctorId: 20, questions: intakeQuestions })).status).toBe(404);
  });

  it("binds a doctor's template to that doctor and lets doctors edit only their own", async () => {
    const own = await createTemplate("doctor", { doctorId: 11 });
    expect(own.body).toMatchObject({ doctorId: 10, createdBy: 3 });
    const general = await createTemplate("manager");

    expect((await http("otherDoctor", `/templates/${own.body.id}`, "PUT", { title: "Чужая", questions: intakeQuestions })).status).toBe(403);
    expect((await http("doctor", `/templates/${general.body.id}`, "PUT", { title: "Общая", questions: intakeQuestions })).status).toBe(403);
    const renamed = await http("doctor", `/templates/${own.body.id}`, "PUT", { title: "Моя анкета", doctorId: null, questions: intakeQuestions });
    expect(renamed.body).toMatchObject({ title: "Моя анкета", doctorId: 10 });
    expect((await http("manager", `/templates/${own.body.id}`, "PUT", { title: "Проверено", questions: intakeQuestions })).status).toBe(200);
  });

  it("restricts template management and hides inactive templates from filling roles", async () => {
    for (const who of ["reception", "nurse", "cashier"] as const) {
      expect((await createTemplate(who)).status).toBe(403);
    }
    const tpl = await createTemplate("manager");
    await http("manager", `/templates/${tpl.body.id}`, "PUT", { title: "Старая", questions: intakeQuestions, active: false });
    expect((await http("reception", "/templates?includeInactive=true")).body).toEqual([]);
    expect((await http("manager", "/templates?includeInactive=true")).body).toHaveLength(1);
    expect((await http("manager", "/templates")).body).toEqual([]);
    expect((await http("cashier", "/templates")).status).toBe(403);
    expect((await http("operator", "/templates")).status).toBe(403);
  });
});

describe("filled questionnaires", () => {
  it("validates answers against the template, normalizes them and snapshots the questions", async () => {
    const tpl = await createTemplate();
    const fill = (answers: unknown) => http("reception", "/", "POST", { patientId: 100, templateId: tpl.body.id, answers });

    expect((await fill({ allergy: true })).status).toBe(400);
    expect((await fill({ complaints: "Боль", blood: "V" })).status).toBe(400);
    expect((await fill({ complaints: "Боль", chronic: ["Рак"] })).status).toBe(400);
    expect((await fill({ complaints: "Боль", lastVisit: "2026-02-30" })).status).toBe(400);
    expect((await fill({ complaints: "Боль", unknown: "x" })).status).toBe(400);
    expect((await fill({ complaints: "Боль", allergy: "да" })).status).toBe(400);

    const saved = await fill({ complaints: "  Боль в спине  ", allergy: false, chronic: ["Гипертония", "Диабет", "Диабет"], weight: "72,5", blood: "", lastVisit: null });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ patientName: "Анна Каримова", title: "Первичная анкета", doctorId: null, createdByName: "Регистратура", questionCount: 6, answeredCount: 4 });
    expect(saved.body.answers).toEqual({ complaints: "Боль в спине", allergy: false, chronic: ["Диабет", "Гипертония"], weight: 72.5 });

    await http("manager", `/templates/${tpl.body.id}`, "PUT", { title: "Новая версия", questions: [{ id: "other", label: "Другое", type: "text", required: true }] });
    const reread = await http("doctor", `/${saved.body.id}`);
    expect(reread.body.title).toBe("Первичная анкета");
    expect(reread.body.questions).toHaveLength(6);
    const edited = await http("nurse", `/${saved.body.id}`, "PUT", { answers: { complaints: "Уже лучше" } });
    expect(edited.body).toMatchObject({ answers: { complaints: "Уже лучше" }, updatedByName: "Медсестра" });
    expect((await http("nurse", `/${saved.body.id}`, "PUT", { answers: { other: "x" } })).status).toBe(400);
  });

  it("ties doctors to their own visits and records the doctor context", async () => {
    const tpl = await createTemplate();
    const byDoctor = (who: keyof typeof users, patientId: number, appointmentId?: number) =>
      http(who, "/", "POST", { patientId, templateId: tpl.body.id, appointmentId, answers: { complaints: "Боль" } });

    expect((await byDoctor("doctor", 101, 501)).status).toBe(403);
    expect((await byDoctor("doctor", 101)).status).toBe(403);
    expect((await byDoctor("nurse", 101)).status).toBe(403);
    expect((await byDoctor("doctor", 100, 501)).status).toBe(400);
    expect((await byDoctor("doctor", 100, 500)).body).toMatchObject({ doctorId: 10, appointmentId: 500, doctorName: "Др. Алиева", patientPhone: null });
    expect((await byDoctor("doctor", 103)).body).toMatchObject({ doctorId: 10, patientName: "Новая пациентка" });
    expect((await byDoctor("nurse", 100)).body).toMatchObject({ doctorId: 10, appointmentId: null });
    expect((await byDoctor("reception", 101, 501)).body).toMatchObject({ doctorId: 11, patientPhone: "998902222222" });
  });

  it("refuses unknown, archived and foreign patients and inactive templates", async () => {
    const tpl = await createTemplate();
    const fill = (patientId: number, templateId = tpl.body.id) =>
      http("reception", "/", "POST", { patientId, templateId, answers: { complaints: "Боль" } });
    expect((await fill(102)).status).toBe(404);
    expect((await fill(200)).status).toBe(404);
    expect((await fill(999)).status).toBe(404);
    await http("manager", `/templates/${tpl.body.id}`, "PUT", { title: "Старая", questions: intakeQuestions, active: false });
    expect((await fill(100)).status).toBe(404);
  });

  it("searches the shared base by patient, template, doctor and clinic date with escaped patterns", async () => {
    const intake = await createTemplate();
    const dental = await createTemplate("doctor", { title: "Стоматология" });
    await http("reception", "/", "POST", { patientId: 100, templateId: intake.body.id, answers: { complaints: "Боль" } });
    await http("otherDoctor", "/", "POST", { patientId: 101, templateId: dental.body.id, answers: { complaints: "Зуб" } });
    await http("doctor", "/", "POST", { patientId: 100, templateId: dental.body.id, answers: { complaints: "Десна" } });
    // 2026-03-01 21:30 UTC is already March 2nd in Tashkent.
    await db.exec(`UPDATE patient_questionnaires SET created_at = '2026-03-01T21:30:00Z' WHERE id = 1`);

    const ids = async (query: string, who: keyof typeof users = "otherDoctor") => {
      const res = await http(who, `/${query}`);
      return { ids: res.body.items.map((item: { id: number }) => item.id), total: res.body.total };
    };
    expect(await ids("")).toEqual({ ids: [3, 2, 1], total: 3 });
    expect(await ids("?search=%25_")).toEqual({ ids: [2], total: 1 });
    expect(await ids("?search=Каримова")).toEqual({ ids: [3, 1], total: 2 });
    expect(await ids("?search=стомат")).toEqual({ ids: [3, 2], total: 2 });
    expect(await ids(`?templateId=${intake.body.id}`)).toEqual({ ids: [1], total: 1 });
    expect(await ids("?doctorId=10&patientId=100")).toEqual({ ids: [3], total: 1 });
    expect(await ids("?dateFrom=2026-03-02&dateTo=2026-03-02")).toEqual({ ids: [1], total: 1 });
    expect(await ids("?limit=1&offset=1")).toEqual({ ids: [2], total: 3 });
    expect((await http("doctor", "/?dateFrom=2026-03-03&dateTo=2026-03-01")).status).toBe(400);
    expect((await http("doctor", "/?limit=500")).status).toBe(400);
    expect(await ids("", "foreignManager")).toEqual({ ids: [], total: 0 });
    expect((await http("foreignManager", "/1")).status).toBe(404);
  });

  it("limits deletion to managers and hides deleted questionnaires", async () => {
    const tpl = await createTemplate();
    const saved = await http("reception", "/", "POST", { patientId: 100, templateId: tpl.body.id, answers: { complaints: "Боль" } });
    expect((await http("doctor", `/${saved.body.id}`, "DELETE")).status).toBe(403);
    expect((await http("manager", `/${saved.body.id}`, "DELETE")).status).toBe(200);
    expect((await http("doctor", `/${saved.body.id}`)).status).toBe(404);
    expect((await http("manager", `/${saved.body.id}`, "DELETE")).status).toBe(404);
    expect((await http("manager", "/templates")).body[0]).toMatchObject({ usageCount: 0 });
    expect((await http("cashier", "/")).status).toBe(403);
    expect((await http("operator", `/${saved.body.id}`)).status).toBe(403);
  });

  it("lets every doctor read the shared base without contacts, but write only for own patients", async () => {
    const tpl = await createTemplate();
    const saved = await http("reception", "/", "POST", { patientId: 101, templateId: tpl.body.id, answers: { complaints: "Боль" } });
    const list = await http("doctor", "/");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ patientName: "Бобур 100%_", patientPhone: null });
    expect((await http("doctor", `/${saved.body.id}`)).body).toMatchObject({ answers: { complaints: "Боль" }, patientPhone: null });
    expect((await http("doctor", `/${saved.body.id}`, "PUT", { answers: { complaints: "Чужая правка" } })).status).toBe(403);
    expect((await http("otherDoctor", `/${saved.body.id}`, "PUT", { answers: { complaints: "Лучше" } })).body).toMatchObject({ answers: { complaints: "Лучше" } });
    expect((await http("manager", `/${saved.body.id}`)).body.patientPhone).toBe("998902222222");
  });
});
