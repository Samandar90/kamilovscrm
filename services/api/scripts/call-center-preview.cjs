/* Local, disposable UI preview. No .env, pg connection, production token, or persistent database.
 * Run: node services/api/scripts/call-center-preview.cjs
 * Accounts: admin / preview, operator / preview, operator2 / preview.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const express = require("express");
const cors = require("cors");

if (process.env.NODE_ENV === "production") throw new Error("Preview must never run in production");
const src = path.resolve(__dirname, "../src");
const migrations = path.resolve(__dirname, "../../../packages/database/migrations");
const db = new PGlite(); // Memory only: deliberately no database URL or filesystem path.
let gate = Promise.resolve();
async function acquire() {
  const previous = gate;
  let release;
  gate = new Promise(resolve => { release = resolve; });
  await previous;
  return release;
}
const pool = {
  async query(sql, values) { const release = await acquire(); try { return await db.query(sql, values); } finally { release(); } },
  async connect() { const release = await acquire(); return { query: (sql, values) => db.query(sql, values), release }; },
};
const previewEnv = { isProduction: false, dataProvider: "postgres", reportsTimezone: "Asia/Tashkent", jwtSecret: "synthetic-local-call-center-preview-only" };
let services;
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename,
  });
  module._compile(result.outputText, filename);
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved === path.join(src, "config/env.ts")) return { env: previewEnv };
  if (resolved === path.join(src, "config/database.ts")) return { dbPool: pool };
  if (resolved === path.join(src, "container/index.ts")) return { services };
  return originalLoad.apply(this, arguments);
};

async function main() {
  await db.exec(`CREATE TABLE clinics(id bigint primary key);
    CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text, active boolean default true, deleted_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, full_name text, role text, is_active boolean default true, deleted_at timestamptz);
    CREATE TABLE appointments(id bigint primary key, clinic_id bigint not null, patient_id bigint, doctor_id bigint, start_at timestamptz, status text, deleted_at timestamptz);`);
  for (const filename of ["031_call_reminders.sql", "032_call_center_workspace.sql", "033_call_center_daily_workflow.sql"]) await db.exec(fs.readFileSync(path.join(migrations, filename), "utf8"));
  await db.exec(`INSERT INTO clinics VALUES(1),(2);
    INSERT INTO doctors(id,clinic_id,full_name) VALUES(1,1,'Дилшод Каримов'),(2,1,'Нилуфар Ахмедова'),(9,2,'Чужой врач');
    INSERT INTO users(id,clinic_id,full_name,role) VALUES(1,1,'Администратор','superadmin'),(2,1,'Саида — оператор','operator'),(3,1,'Мадина — оператор','operator'),(9,2,'Чужой оператор','operator');
    INSERT INTO patients(id,clinic_id,full_name,phone) VALUES
      (1,1,'Анна Петрова','+998 90 111 22 33'),(2,1,'Жамшид Рахимов','+998 91 222 33 44'),
      (3,1,'Зебо Юлдашева','+998 93 333 44 55'),(4,1,'Бекзод Алиев',null),
      (5,1,'Малика Усманова','+998 94 555 66 77'),(6,1,'Рустам Саидов','+998 97 666 77 88'),(99,2,'Чужой пациент','+998 99 999 99 99');
    INSERT INTO patients(id,clinic_id,full_name,phone) SELECT id,1,'Пациент тестовый '||lpad(id::text,2,'0'),'+998 90 700 '||id||' 00' FROM generate_series(7,38) id;
    INSERT INTO appointments(id,clinic_id,patient_id,doctor_id,start_at,status,deleted_at) VALUES
      (101,1,1,1,((now() AT TIME ZONE 'Asia/Tashkent')-interval '130 days') AT TIME ZONE 'UTC','completed',null),
      (102,1,2,2,((now() AT TIME ZONE 'Asia/Tashkent')-interval '5 days') AT TIME ZONE 'UTC','completed',null),
      (103,1,3,2,((now() AT TIME ZONE 'Asia/Tashkent')-interval '4 days') AT TIME ZONE 'UTC','completed',null),
      (105,1,5,1,((now() AT TIME ZONE 'Asia/Tashkent')-interval '1 day') AT TIME ZONE 'UTC','completed',null),
      (106,1,6,1,((now() AT TIME ZONE 'Asia/Tashkent')-interval '190 days') AT TIME ZONE 'UTC','completed',null),
      (202,1,2,2,((date_trunc('day',now() AT TIME ZONE 'Asia/Tashkent'))+interval '1 day 11 hours') AT TIME ZONE 'UTC','confirmed',null);
    UPDATE appointments SET recommended_return_date=(now() AT TIME ZONE 'Asia/Tashkent')::date+3 WHERE id=101;
    INSERT INTO call_center_patient_preferences(clinic_id,patient_id,do_not_call,preferred_language,updated_by) VALUES
      (1,2,false,'uz',1),(1,7,true,'ru',1);
    INSERT INTO call_center_tasks(clinic_id,patient_id,campaign,episode_key,status,due_at,attempts,assigned_to) VALUES
      (1,3,'followup','visit:103','callback',now()-interval '30 minutes',1,2),
      (1,6,'recall','visit:106','done',null,1,2);
    INSERT INTO call_contact_attempts(clinic_id,task_id,patient_id,patient_name,campaign,outcome,note,called_at,called_by,called_by_name,callback_at,request_id) VALUES
      (1,1,3,'Зебо Юлдашева','followup','callback','Попросила перезвонить после работы',now()-interval '2 hours',2,'Саида — оператор',now()-interval '30 minutes','preview-callback-1'),
      (1,2,6,'Рустам Саидов','recall','contacted','Обсудили повторный визит; запись оформит регистратура',now()-interval '1 day',2,'Саида — оператор',null,'preview-contact-2');`);

  const { PostgresCallCenterWorkspaceRepository } = require(path.join(src, "repositories/postgres/PostgresCallCenterWorkspaceRepository.ts"));
  const { CallCenterWorkspaceService } = require(path.join(src, "services/callCenterWorkspaceService.ts"));
  const { PostgresCallCenterRepository } = require(path.join(src, "repositories/postgres/PostgresCallCenterRepository.ts"));
  const { CallCenterService } = require(path.join(src, "services/callCenterService.ts"));
  services = { callCenterWorkspace: new CallCenterWorkspaceService(new PostgresCallCenterWorkspaceRepository(pool, previewEnv.reportsTimezone)), callCenter: new CallCenterService(new PostgresCallCenterRepository()) };
  const { callCenterRouter } = require(path.join(src, "routes/callCenterRoutes.ts"));
  const { errorHandler } = require(path.join(src, "middleware/errorHandler.ts"));
  const { requireAuth } = require(path.join(src, "middleware/authMiddleware.ts"));
  const { signAccessToken } = require(path.join(src, "utils/jwt.ts"));
  const users = [
    { id: 1, username: "admin", fullName: "Администратор", role: "superadmin" },
    { id: 2, username: "operator", fullName: "Саида — оператор", role: "operator" },
    { id: 3, username: "operator2", fullName: "Мадина — оператор", role: "operator" },
  ].map(user => ({ ...user, clinicId: 1, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" }));
  const app = express();
  app.use(cors({ origin: /^http:\/\/(localhost|127\.0\.0\.1):\d+$/ }));
  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true, syntheticPreview: true }));
  app.post("/api/auth/login", (req, res) => {
    const user = users.find(item => item.username === req.body.username);
    if (!user || req.body.password !== "preview") return res.status(401).json({ error: "Preview credentials: admin / preview or operator / preview" });
    return res.json({ user, accessToken: signAccessToken({ userId: user.id, clinicId: 1, username: user.username, role: user.role }) });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => res.json(users.find(user => user.id === req.auth.userId)));
  app.post("/api/auth/logout", (_req, res) => res.json({ success: true }));
  app.get(["/api/clinic/me", "/api/clinic/me/meta", "/api/meta"], requireAuth, (_req, res) => res.json({ id: 1, name: "Тестовая клиника · локальное демо", slug: "preview", logoUrl: "/logo.png", primaryColor: "#5F43C6", subscriptionStatus: "active" }));
  app.use("/api/call-center", callCenterRouter);
  app.use(errorHandler);
  const server = app.listen(4400, "127.0.0.1", () => console.log("Synthetic call-center preview: http://127.0.0.1:4400 — admin/preview, operator/preview, operator2/preview. Memory only; Ctrl+C discards data."));
  server.on("error", error => { console.error(error); process.exitCode = 1; });
  const stop = () => server.close(() => db.close().then(() => process.exit(0)));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
