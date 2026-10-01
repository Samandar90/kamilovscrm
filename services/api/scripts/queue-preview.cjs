/* Local, disposable preview of the electronic queue and the TV screen. No .env, pg connection, production token or persistent database.
 * Run:     node services/api/scripts/queue-preview.cjs           → API on http://127.0.0.1:4401 until Ctrl+C
 *          node services/api/scripts/queue-preview.cjs --smoke   → HTTP self-check of the seeded day, then exit (code 0 = OK)
 * Web:     $env:VITE_API_URL='http://127.0.0.1:4401'; npm run dev --prefix apps/web -- --host 127.0.0.1 --port 5175 --strictPort
 * Accounts (password "preview"): admin (superadmin), reception, doctor (Каримов · кабинет 3 · К), nurse (при Усмановой · кабинет 5 · У), manager.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");
const express = require("express");
const cors = require("cors");

if (process.env.NODE_ENV === "production") throw new Error("Preview must never run in production");
const PORT = 4401;
const WEB = "http://127.0.0.1:5175";
const CLINIC_TIME_ZONE = "Asia/Tashkent";
const SMOKE = process.argv.includes("--smoke");
const src = path.resolve(__dirname, "../src");
const migrations = path.resolve(__dirname, "../migrations");
const db = new PGlite(); // Memory only: deliberately no database URL or filesystem path.

// PGlite has ONE connection: a transaction (connect → BEGIN … COMMIT → release) holds it and every other request waits on the gate.
// Queries sent by the SAME request while it holds the connection run directly: e.g. PostgresServicesRepository.create reloads the new
// service through dbPool before it releases its client, so with a plain gate that request would wait for itself forever.
const connectionOwner = new AsyncLocalStorage();
let gate = Promise.resolve();
async function acquire() {
  const previous = gate;
  let release;
  gate = new Promise(resolve => { release = resolve; });
  await previous;
  return release;
}
const pool = {
  async query(sql, values) {
    if (connectionOwner.getStore()?.holding) return db.query(sql, values);
    const release = await acquire();
    try { return await db.query(sql, values); } finally { release(); }
  },
  async connect() {
    const release = await acquire();
    const owner = connectionOwner.getStore();
    if (owner) owner.holding = true;
    let released = false;
    return {
      query: (sql, values) => db.query(sql, values),
      release: () => { if (released) return; released = true; if (owner) owner.holding = false; release(); },
    };
  },
};
const previewEnv = { isProduction: false, dataProvider: "postgres", reportsTimezone: CLINIC_TIME_ZONE, clinicDisplayName: "Тестовая клиника", jwtSecret: "synthetic-local-queue-preview-only" };
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
  if (resolved === path.join(src, "container/index.ts")) return { get services() { return services; } };
  return originalLoad.apply(this, arguments);
};

// Wall-clock slots of today's visits: [appointment id, patient id, doctor id, "HH:MM"]. Doctor 9, patient 99 and visit 901 belong to clinic 2.
const VISITS = [
  [101, 1, 1, "08:00"], [102, 2, 1, "08:30"], [103, 3, 1, "09:00"], [104, 4, 1, "09:30"], [105, 5, 1, "10:00"], [106, 6, 1, "10:30"], [107, 7, 1, "11:00"],
  [201, 8, 2, "09:00"], [202, 9, 2, "09:30"], [203, 10, 2, "10:00"], [204, 11, 2, "10:30"],
  [301, 12, 3, "09:00"], [302, 4, 3, "11:00"], [303, 14, 3, "11:30"],
  [401, 13, 4, "10:00"],
  [901, 99, 9, "10:00"],
];
const plus30 = hhmm => { const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + 30; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

async function createDatabase(day, yesterday) {
  // start_at holds clinic wall-clock time; it round-trips only when the DB session and Node share a zone (as in production).
  await db.exec(`SET TIME ZONE '${Intl.DateTimeFormat().resolvedOptions().timeZone}'`);
  await db.exec(`CREATE TABLE clinics(id bigint primary key, name text, subscription_status text default 'active', subscription_ends_at timestamptz);
    CREATE TABLE users(id bigint primary key, clinic_id bigint not null, full_name text, role text);
    CREATE TABLE patients(id bigserial primary key, clinic_id bigint not null, full_name text, phone text, gender text, birth_date date, source text,
      notes text, created_by_doctor_id bigint, created_by_user_id bigint, created_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE doctors(id bigserial primary key, clinic_id bigint not null, full_name text, specialty text default '', percent numeric default 0,
      phone text, birth_date date, active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE services(id bigserial primary key, clinic_id bigint not null, name text, price numeric default 0, duration integer default 30,
      active boolean default true, created_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE doctor_services(doctor_id bigint not null, service_id bigint not null);
    CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
      price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text default 'draft',
      cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
      created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric default 1,
      created_by bigint, created_at timestamptz default now());
    CREATE TABLE invoices(id bigserial primary key, clinic_id bigint, appointment_id bigint, status text, deleted_at timestamptz);
    CREATE TABLE invoice_items(id bigserial primary key, invoice_id bigint);
    CREATE TABLE payments(id bigserial primary key, invoice_id bigint);
    CREATE TABLE cash_register_entries(id bigserial primary key, payment_id bigint);`);
  for (const filename of ["033_call_center_daily_workflow.sql", "035_electronic_queue.sql"]) await db.exec(fs.readFileSync(path.join(migrations, filename), "utf8"));
  await db.exec(`INSERT INTO clinics(id, name) VALUES (1, 'Тестовая клиника'), (2, 'Чужая клиника');
    INSERT INTO users(id, clinic_id, full_name, role) VALUES (1, 1, 'Администратор', 'superadmin'), (2, 1, 'Регистратура', 'reception'),
      (3, 1, 'Каримов Дилшод Рустамович', 'doctor'), (4, 1, 'Медсестра Усмановой', 'nurse'), (5, 1, 'Менеджер', 'manager'), (9, 2, 'Чужая регистратура', 'reception');
    INSERT INTO doctors(id, clinic_id, full_name, specialty, room, queue_prefix) VALUES
      (1, 1, 'Каримов Дилшод Рустамович', 'Кардиолог', '3', 'К'), (2, 1, 'Усманова Малика Бахтиёровна', 'Уролог', '5', 'У'),
      (3, 1, 'Назарова Дилноза Анваровна', 'Невролог', '7', 'Н'), (4, 1, 'Юлдашев Бекзод Олимович', 'Педиатр', NULL, NULL),
      (9, 2, 'Чужой Врач Тестович', 'Хирург', '1', 'Х');
    INSERT INTO services(id, clinic_id, name, price, duration) VALUES (1, 1, 'Консультация кардиолога', 150000, 30), (2, 1, 'Консультация уролога', 150000, 30),
      (3, 1, 'Консультация невролога', 150000, 30), (4, 1, 'Приём педиатра', 100000, 30), (9, 2, 'Осмотр хирурга', 100000, 30);
    INSERT INTO doctor_services(doctor_id, service_id) VALUES (1, 1), (2, 2), (3, 3), (4, 4), (9, 9);
    INSERT INTO patients(id, clinic_id, full_name, phone, gender) VALUES
      (1, 1, 'Алиев Сардор Бахтиёрович', '+998 90 111 22 33', 'male'), (2, 1, 'Юсупова Мадина Рустамовна', '+998 91 222 33 44', 'female'),
      (3, 1, 'Рахимов Тимур Алишерович', '+998 93 333 44 55', 'male'), (4, 1, 'Ким Ольга Викторовна', '+998 94 444 55 66', 'female'),
      (5, 1, 'Турсунов Бобур Шухратович', '+998 95 555 66 77', 'male'), (6, 1, 'Абдуллаева Зебо Камоловна', '+998 97 666 77 88', 'female'),
      (7, 1, 'Иванов Сергей Петрович', '+998 98 777 88 99', 'male'), (8, 1, 'Хасанова Гулноза Анваровна', '+998 99 888 99 00', 'female'),
      (9, 1, 'Мирзаев Жасур Олимович', '+998 90 123 45 67', 'male'), (10, 1, 'Петрова Анна Сергеевна', '+998 91 234 56 78', 'female'),
      (11, 1, 'Эргашев Азиз Фарходович', '+998 93 345 67 89', 'male'), (12, 1, 'Садыкова Лола Икромовна', '+998 94 456 78 90', 'female'),
      (13, 1, 'Норматов Улугбек Тахирович', '+998 95 567 89 01', 'male'), (14, 1, 'Ли Виктор', '+998 97 678 90 12', 'male'),
      (15, 1, 'Сайфуллаев Отабек Равшанович', '+998 90 135 79 24', 'male'), (16, 1, 'Бекмуратова Нодира Шавкатовна', '+998 91 246 80 35', 'female'),
      (99, 2, 'Чужой Пациент Тестович', '+998 99 999 99 99', 'male');
    INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status) VALUES
      ${VISITS.map(([id, patientId, doctorId, time]) => `(${id}, ${doctorId === 9 ? 2 : 1}, ${patientId}, ${doctorId}, ${doctorId}, ${doctorId === 4 || doctorId === 9 ? 100000 : 150000}, '${day} ${time}:00', '${day} ${plus30(time)}:00', 'scheduled')`).join(",\n      ")};
    -- Marked «Пришёл» before this release, so they have no number: the «Выдать номер» cases (304 today, 108 yesterday).
    INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status) VALUES
      (304, 1, 15, 3, 3, 150000, '${day} 12:00:00', '${day} 12:30:00', 'arrived'),
      (108, 1, 16, 1, 1, 150000, '${yesterday} 15:00:00', '${yesterday} 15:30:00', 'arrived');
    INSERT INTO appointment_services(appointment_id, service_id, price, quantity) SELECT id, service_id, price, 1 FROM appointments ORDER BY id;
    SELECT setval(pg_get_serial_sequence('patients', 'id'), 1000);
    SELECT setval(pg_get_serial_sequence('doctors', 'id'), 1000);
    SELECT setval(pg_get_serial_sequence('services', 'id'), 1000);
    SELECT setval(pg_get_serial_sequence('appointments', 'id'), 1000);`);
}

const admin = { userId: 1, clinicId: 1, username: "admin", role: "superadmin" };
const reception = { userId: 2, clinicId: 1, username: "reception", role: "reception" };
const foreignReception = { userId: 9, clinicId: 2, username: "foreign", role: "reception" };

/** Today's queue built through the real services (status transitions issue the numbers), so the stand shows real behaviour. */
async function seedQueue(runWithClinicContext) {
  const move = async (auth, id, status) => {
    if (!(await services.appointments.update(auth, id, { status }))) throw new Error(`Seed: appointment ${id} → ${status} failed`);
  };
  const callNext = async (doctorId, expectedId) => {
    const { entry } = await services.queue.callNext(reception, doctorId);
    if (entry?.appointmentId !== expectedId) throw new Error(`Seed: call-next of doctor ${doctorId} returned ${entry?.appointmentId}, expected ${expectedId}`);
  };
  await runWithClinicContext(1, async () => {
    await move(reception, 107, "confirmed");
    // Arrival order sets the numbers: К-01…К-05, У-01…У-03, Н-01…Н-02, 01 (doctor without a letter).
    for (const id of [101, 102, 201, 103, 301, 104, 202, 105, 401, 203, 302]) await move(reception, id, "arrived");
    await callNext(1, 101); await move(reception, 101, "in_consultation"); await move(reception, 101, "completed");
    await callNext(1, 102); await move(reception, 102, "in_consultation");
    await callNext(1, 103); await move(reception, 103, "no_show");
    await callNext(2, 201);
  });
  await runWithClinicContext(2, () => move(foreignReception, 901, "arrived"));
  return runWithClinicContext(1, async () => ({
    hall: await services.queueDisplays.create(admin, { name: "Холл, 1 этаж", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true }),
    corridor: await services.queueDisplays.create(admin, { name: "Коридор: кабинет 3 и педиатр", doctorIds: [1, 4], showNames: false, language: "ru", voiceEnabled: true }),
  }));
}

async function smokeTest(base, displays) {
  let passed = 0;
  const check = (name, ok, detail) => {
    if (!ok) throw new Error(`[smoke] FAIL ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    passed += 1;
    console.log(`[smoke] ok  ${name}`);
  };
  const tokens = {};
  const call = async (who, route, method = "GET", body) => {
    if (who && !tokens[who]) {
      const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: who, password: "preview" }) });
      tokens[who] = (await login.json()).accessToken;
    }
    const headers = { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) };
    const res = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null, cacheControl: res.headers.get("cache-control"), rateLimitPolicy: res.headers.get("ratelimit-policy") };
  };
  const codes = entries => entries.map(entry => entry.code);

  const today = await call("reception", "/api/queue/today");
  check("reception sees 4 cabinets ordered by room (3, 5, 7, no room)", today.status === 200 && JSON.stringify(today.body.doctors.map(d => d.doctorId)) === "[1,2,3,4]", today.body);
  const [cardio, uro, neuro, pediatric] = today.body.doctors;
  check("кабинет 3: К-02 serving, К-04/К-05 waiting, К-03 missed, 1 done",
    cardio.serving?.code === "К-02" && JSON.stringify(codes(cardio.waiting)) === '["К-04","К-05"]' && JSON.stringify(codes(cardio.missed)) === '["К-03"]' && cardio.doneCount === 1, cardio);
  check("кабинет 5: У-01 called, then У-02, У-03 waiting", JSON.stringify(uro.waiting.map(e => [e.code, e.state])) === '[["У-01","called"],["У-02","waiting"],["У-03","waiting"]]', uro.waiting);
  check("кабинет 7: Н-01, Н-02; doctor without room/letter: 01", JSON.stringify(codes(neuro.waiting)) === '["Н-01","Н-02"]' && pediatric.room === null && JSON.stringify(codes(pediatric.waiting)) === '["01"]', [neuro.waiting, pediatric]);

  const hall = await call(null, `/api/public/queue-display/${displays.hall.code}`);
  check("public TV state needs no token and is not cached", hall.status === 200 && hall.cacheControl === "no-store" && hall.body.clinicName === "Тестовая клиника" && hall.body.cabinets.length === 4, { status: hall.status, cacheControl: hall.cacheControl });
  check("TV shows masked names and the current patient per cabinet",
    hall.body.cabinets[0].current?.code === "К-02" && hall.body.cabinets[0].current?.name === "Мадина Ю." && hall.body.cabinets[1].current?.state === "called" && hall.body.cabinets[1].current?.name === "Гулноза Х.", hall.body.cabinets.slice(0, 2));
  check("TV payload has no full names, patient ids or other clinics", !/Юсупова|Рустамовна|patientId|Чужой|phone/.test(hall.text), hall.text.slice(0, 300));
  check("latest call on the TV is У-01", hall.body.recentCalls[0]?.code === "У-01", hall.body.recentCalls);
  const corridor = await call(null, `/api/public/queue-display/${displays.corridor.code}`);
  check("filtered TV: rooms 3 and «—», ru only, names hidden",
    corridor.status === 200 && JSON.stringify(corridor.body.cabinets.map(c => c.room)) === '["3",null]' && corridor.body.display.language === "ru" && corridor.body.cabinets[0].current?.name === null, corridor.body);

  const arrived = await call("reception", "/api/appointments/106", "PUT", { status: "arrived" });
  check("«Отметить приход» issues К-06", arrived.status === 200 && arrived.body.queueCode === "К-06", arrived.body);
  const next = await call("reception", "/api/queue/doctors/1/call-next", "POST");
  check("«Вызвать следующего» calls К-04", next.status === 200 && next.body.entry?.code === "К-04" && next.body.entry?.state === "called", next.body);
  const afterCall = await call(null, `/api/public/queue-display/${displays.hall.code}`);
  check("TV sees the new call first; its key is date:doctor:number:count", afterCall.body.recentCalls[0]?.code === "К-04" && /^\d{4}-\d{2}-\d{2}:1:4:1$/.test(afterCall.body.recentCalls[0]?.key ?? ""), afterCall.body.recentCalls[0]);
  const ticket = await call("reception", "/api/queue/appointments/106/ticket");
  check("ticket К-06: кабинет 3, 2 ahead", ticket.status === 200 && ticket.body.code === "К-06" && ticket.body.room === "3" && ticket.body.aheadCount === 2 && ticket.body.clinicName === "Тестовая клиника", ticket.body);
  const back = await call("reception", "/api/appointments/103", "PUT", { status: "arrived" });
  check("missed К-03 returns to the end of the queue as К-07", back.status === 200 && back.body.queueCode === "К-07", back.body);
  // The seed already called this visit once as К-03; the new number restarts the call count, yet the TV must see a NEW key.
  const recall = await call("reception", "/api/queue/appointments/103/call", "POST");
  const afterReturn = await call(null, `/api/public/queue-display/${displays.hall.code}`);
  const seenKeys = new Set([...hall.body.recentCalls, ...afterCall.body.recentCalls].map(item => item.key));
  check("returned К-07 is announced on the TV as a new call", recall.status === 200 && afterReturn.body.recentCalls[0]?.code === "К-07" && !seenKeys.has(afterReturn.body.recentCalls[0]?.key), { recall: recall.body, latest: afterReturn.body.recentCalls[0], seen: [...seenKeys] });
  const issued = await call("reception", "/api/queue/appointments/304/issue", "POST");
  check("«Выдать номер» gives Н-03 to a visit marked «Пришёл» without a number", issued.status === 200 && issued.body.entry?.code === "Н-03" && issued.body.entry?.state === "waiting", issued.body);
  const lateIssue = await call("reception", "/api/queue/appointments/108/issue", "POST");
  check("«Выдать номер» refuses yesterday's visit", lateIssue.status === 409 && lateIssue.body.error === "Запись не на сегодня", lateIssue.body);

  const doctorDay = await call("doctor", "/api/queue/today");
  check("doctor sees only own queue", doctorDay.status === 200 && JSON.stringify(doctorDay.body.doctors.map(d => d.doctorId)) === "[1]", doctorDay.body);
  check("doctor cannot call another doctor's queue", (await call("doctor", "/api/queue/doctors/2/call-next", "POST")).status === 403, "expected 403");
  const nurseDay = await call("nurse", "/api/queue/today");
  check("nurse sees her doctor's queue", nurseDay.status === 200 && JSON.stringify(nurseDay.body.doctors.map(d => d.doctorId)) === "[2]", nurseDay.body);
  check("manager can read but not call", (await call("manager", "/api/queue/today")).status === 200 && (await call("manager", "/api/queue/doctors/1/call-next", "POST")).status === 403, "expected 200 then 403");
  const unknown = await call(null, "/api/public/queue-display/XXXXX-XXXXX");
  check("unknown TV code → 404 JSON, not cached, rate-limited", unknown.status === 404 && unknown.body?.error === "Экран не найден" && unknown.cacheControl === "no-store" && unknown.rateLimitPolicy === "300;w=60", { status: unknown.status, body: unknown.body, cacheControl: unknown.cacheControl, rateLimitPolicy: unknown.rateLimitPolicy });
  const list = await call("admin", "/api/queue/displays");
  check("superadmin lists 2 screens", list.status === 200 && list.body.length === 2, list.body);
  console.log(`[smoke] ${passed} checks passed`);
}

async function main() {
  const { clinicToday, addDays } = require(path.join(src, "services/queue/queueRules.ts"));
  const day = clinicToday(CLINIC_TIME_ZONE, new Date());
  await createDatabase(day, addDays(day, -1));

  const { runWithClinicContext } = require(path.join(src, "tenancy/clinicContext.ts"));
  const { PostgresAppointmentsRepository } = require(path.join(src, "repositories/postgres/PostgresAppointmentsRepository.ts"));
  const { PostgresDoctorsRepository } = require(path.join(src, "repositories/postgres/PostgresDoctorsRepository.ts"));
  const { PostgresPatientsRepository } = require(path.join(src, "repositories/postgres/PostgresPatientsRepository.ts"));
  const { PostgresServicesRepository } = require(path.join(src, "repositories/postgres/PostgresServicesRepository.ts"));
  const { PostgresQueueRepository } = require(path.join(src, "repositories/postgres/PostgresQueueRepository.ts"));
  const { PostgresQueueDisplaysRepository } = require(path.join(src, "repositories/postgres/PostgresQueueDisplaysRepository.ts"));
  const { AppointmentsService } = require(path.join(src, "services/appointmentsService.ts"));
  const { DoctorsService } = require(path.join(src, "services/doctorsService.ts"));
  const { PatientsService } = require(path.join(src, "services/patientsService.ts"));
  const { ServicesService } = require(path.join(src, "services/servicesService.ts"));
  const { QueueService } = require(path.join(src, "services/queueService.ts"));
  const { QueueDisplaysService } = require(path.join(src, "services/queueDisplaysService.ts"));
  const appointmentsRepository = new PostgresAppointmentsRepository();
  const doctorsRepository = new PostgresDoctorsRepository();
  const servicesRepository = new PostgresServicesRepository();
  const queueRepository = new PostgresQueueRepository(pool);
  services = {
    appointments: new AppointmentsService(appointmentsRepository, CLINIC_TIME_ZONE),
    doctors: new DoctorsService(doctorsRepository, servicesRepository),
    patients: new PatientsService(new PostgresPatientsRepository(), appointmentsRepository),
    services: new ServicesService(servicesRepository),
    queue: new QueueService(queueRepository, CLINIC_TIME_ZONE),
    queueDisplays: new QueueDisplaysService(new PostgresQueueDisplaysRepository(pool), queueRepository, CLINIC_TIME_ZONE),
  };
  const displays = await connectionOwner.run({ holding: false }, () => seedQueue(runWithClinicContext));

  const { appointmentsRouter } = require(path.join(src, "routes/appointmentsRoutes.ts"));
  const { doctorsRouter } = require(path.join(src, "routes/doctorsRoutes.ts"));
  const { patientsRouter } = require(path.join(src, "routes/patientsRoutes.ts"));
  const { servicesRouter } = require(path.join(src, "routes/servicesRoutes.ts"));
  const { queueRouter } = require(path.join(src, "routes/queueRoutes.ts"));
  const { publicRouter } = require(path.join(src, "routes/publicRoutes.ts"));
  const { errorHandler } = require(path.join(src, "middleware/errorHandler.ts"));
  const { requireAuth } = require(path.join(src, "middleware/authMiddleware.ts"));
  const { signAccessToken } = require(path.join(src, "utils/jwt.ts"));
  const users = [
    { id: 1, username: "admin", fullName: "Администратор", role: "superadmin" },
    { id: 2, username: "reception", fullName: "Регистратура", role: "reception" },
    { id: 3, username: "doctor", fullName: "Каримов Дилшод Рустамович", role: "doctor", doctorId: 1 },
    { id: 4, username: "nurse", fullName: "Медсестра Усмановой", role: "nurse", nurseDoctorId: 2 },
    { id: 5, username: "manager", fullName: "Менеджер", role: "manager" },
  ].map(user => ({ doctorId: null, nurseDoctorId: null, ...user, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" }));

  const app = express();
  app.use(cors({ origin: /^http:\/\/(localhost|127\.0\.0\.1):\d+$/ }));
  app.use(express.json());
  // After express.json(): body parsing finishes in the socket's async context, so the per-request store must start here.
  app.use((_req, _res, next) => connectionOwner.run({ holding: false }, next));
  app.get("/api/health", (_req, res) => res.json({ ok: true, syntheticPreview: true, day }));
  app.post("/api/auth/login", (req, res) => {
    const user = users.find(item => item.username === req.body?.username);
    if (!user || req.body.password !== "preview") return res.status(401).json({ error: "Стенд: admin, reception, doctor, nurse или manager, пароль preview" });
    const accessToken = signAccessToken({ userId: user.id, clinicId: 1, username: user.username, role: user.role, doctorId: user.doctorId, nurseDoctorId: user.nurseDoctorId });
    return res.json({ user, accessToken });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => res.json(users.find(user => user.id === req.auth.userId)));
  app.post("/api/auth/logout", (_req, res) => res.json({ success: true, message: "ok" }));
  app.get("/api/clinic/me", requireAuth, (_req, res) => res.json({ id: 1, name: "Тестовая клиника", slug: "preview", logoUrl: "/logo.png", primaryColor: "#5F43C6", subscriptionStatus: "active", subscriptionDaysLeft: null }));
  app.get("/api/meta/clinic", requireAuth, (_req, res) => res.json({ clinicName: "Тестовая клиника", receiptFooter: "", reportsTimezone: CLINIC_TIME_ZONE }));
  app.get("/api/invoices", requireAuth, (_req, res) => res.json([]));
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/doctors", doctorsRouter);
  app.use("/api/patients", patientsRouter);
  app.use("/api/services", servicesRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/public", publicRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Этот раздел на стенде очереди не реализован" }));
  app.use(errorHandler);

  const server = app.listen(PORT, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  // No process.exit(): on Windows it can abort with a libuv assertion (UV_HANDLE_CLOSING) while fetch sockets close; let the loop drain.
  const stop = code => { process.exitCode = code; server.close(); server.closeAllConnections(); db.close().catch(() => {}); };
  console.log(`Queue preview API: http://127.0.0.1:${PORT} · clinic day ${day} (${CLINIC_TIME_ZONE}) · memory only, Ctrl+C discards data.`);
  console.log(`Accounts (password "preview"): admin, reception, doctor (Каримов · кабинет 3 · К), nurse (при Усмановой · кабинет 5 · У), manager.`);
  console.log(`Web: $env:VITE_API_URL='http://127.0.0.1:${PORT}'; npm run dev --prefix apps/web -- --host 127.0.0.1 --port 5175 --strictPort`);
  console.log(`TV «${displays.hall.display.name}» (all doctors, uz+ru, names): ${WEB}/tv/${displays.hall.code}`);
  console.log(`TV «${displays.corridor.display.name}» (2 doctors, ru, no names): ${WEB}/tv/${displays.corridor.code}`);
  if (SMOKE) {
    try { await smokeTest(`http://127.0.0.1:${PORT}`, displays); stop(0); } catch (error) { console.error(error.message); stop(1); }
    return;
  }
  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
}
main().catch(error => { console.error(error); process.exitCode = 1; db.close().catch(() => {}); });
