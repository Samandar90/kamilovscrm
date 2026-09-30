# Electronic Queue and TV Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every patient who arrives gets a number in the queue of their doctor. Staff call patients by number. A TV in the hall shows the queue of each cabinet and announces every call with a chime and an Uzbek + Russian voice.

**Architecture:**
- **Data.** The queue lives on the appointment record (`queue_number`, `queue_prefix`, `queue_date`, `queue_issued_at`, `queue_called_at`, `queue_call_count`). Appointment status stays the single source of truth: arrived = waiting or called, in_consultation = serving. An atomic per-doctor, per-day counter table issues numbers inside the same transaction as the arrival status change.
- **API.** A new staff router `/api/queue` serves day view, call, call-next, backfill issue, ticket and TV-screen management. A public, rate-limited `/api/public/queue-display/:code` serves one TV screen (masked names, today only). It resolves the clinic from the screen's hashed short code.
- **Web.** A staff Queue page polls every 5 s. The Appointments page gains the queue code and ticket printing. The TV page lives at `/tv/:code`, outside the authenticated app. It polls every 2 s and plays pre-generated Azure neural voice clips through Web Audio.

**Tech Stack:**
- API: Express 4, `pg`, TypeScript, vitest with PGlite (in-memory Postgres) for SQL/HTTP tests, express-rate-limit 8.
- Web: React 18, Vite 7, react-router 6, i18next (ru/uz), Tailwind 4 (staff UI only), react-test-renderer for component tests.
- Voice: a one-time Node script calling the Azure Speech REST API. The output is static mp3 files.

**Spec:** `docs/superpowers/specs/2026-09-30-electronic-queue-design.md` (approved). Task 14 appends the planning refinements to it as «Уточнения при планировании».

## Global Constraints

Every task implicitly includes these rules.

**Dependencies and data model**
- No new runtime or dev dependencies in `services/api` or `apps/web`.
- Branch `feat/electronic-queue`. One commit per task; end every commit message with the attribution trailer your session requires.
- Migration `services/api/migrations/035_electronic_queue.sql`:
  - It only adds things: `IF NOT EXISTS` everywhere, no `BEGIN`/`COMMIT`, no `CONCURRENTLY`.
  - Render applies it automatically on start (`db-migrate.cjs`). Never edit it after it is deployed.
  - Production schema was checked read-only on 2026-10-01: `doctors`, `appointments`, `clinics` and `users` have every column and primary key the migration relies on, and `appointments` has no slot-overlap exclusion constraint.

**Dates and times**
- `appointments.start_at` stores clinic WALL-CLOCK time as if it were UTC. The mapped `startAt` is `"YYYY-MM-DD HH:mm:ss"`.
- "Today" is always computed in JS with `clinicToday(env.reportsTimezone, now())`. Services get `timeZone` and a `now: () => Date` clock through their constructor.
- SQL day ranges use string literals cast to `::timestamptz`, the same way appointments are written. Never apply `AT TIME ZONE` to `start_at`.

**pg vs PGlite**
- Always convert with `Number(...)` for ids and counts.
- Select `DATE` columns as `to_char(col, 'YYYY-MM-DD')`.
- Map `bigint[]` with `.map(Number)`.
- Map instants with `new Date(v).toISOString()`.

**Clinic scoping and auth**
- Every staff query filters `clinic_id`. New queue repositories take `clinicId` explicitly.
- The public endpoint has no auth context. It resolves the clinic from the screen.
- RBAC: new module `queue` plus key `QUEUE_DISPLAY_MANAGE: ["superadmin"]`, mirrored in BOTH `services/api/src/auth/permissions.ts` and `apps/web/src/auth/permissions.ts`.
  - reception: read, create, update
  - doctor, nurse: read, update, own doctor only; another doctor → 403 «Можно работать только со своей очередью»
  - manager, director: read
  - superadmin: everything
- Errors are `throw new ApiError(status, "<Russian message>")` and the JSON shape is always `{ error }`.

**Planning refinements** (the main ones below; Task 14 records all 21 in the spec addendum «Уточнения при планировании»)
- `appointments.queue_prefix` snapshots the doctor's letter at issue time.
- `call` and `call-next` do not bump `updated_at`.
- The staff day view includes `missed` (no_show) entries with «Вернуть в очередь». `no_show → arrived` is allowed only for today's visits and skips slot-conflict checks.
- Responses carry `timeZone`.
- Voice phrases:
  - uz «Navbat raqami N. Xona raqami R.», fallback «… Qabulga marhamat.»
  - ru «Номер N. Пройдите в кабинет номер R.», fallback «… Пройдите на приём.»
  - A number above 999 gives the chime only. The letter is never spoken.

**Web UI**
- Staff UI texts go through i18n keys in BOTH `apps/web/src/locales/ru.json` and `uz.json`. `npm run check-i18n` enforces parity and runs as `prebuild`.
- The TV page and the printed ticket use bilingual constant strings.
- The TV page must work on Chromium ≥ 87 TV browsers:
  - Its own plain CSS file with the `qtv-` prefix and hex colours.
  - No Tailwind utilities, `oklch`, `color-mix`, `@layer`, `:has()` or container queries.
- The TV never sends auth. It uses a bare `fetch` with `cache: "no-store"` to `${VITE_API_URL}/api/public/queue-display/<code>`, and it renders outside `AuthProvider`.

**Secrets and safe testing**
- The Azure key never enters the repo. The voice script reads `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` from the shell only.
- Never test against production. `apps/web/.env` points at the PRODUCTION API. Manual checks use the PGlite preview stand (`services/api/scripts/queue-preview.cjs`, port 4401) with `VITE_API_URL=http://127.0.0.1:4401` set in the shell.

**Test harness**
- API tests: PGlite with a serialized one-connection pool. Mock `../../config/env`, `../../container` (getter) and `../../config/database` (with both `query` and `connect`).
- Inside a transaction use only the transaction `client`. Any pool query while a client is checked out deadlocks the gated test pool.
- Two pre-existing API suites import the real env. Run the full API suite with `JWT_SECRET=local-tests-only` if `services/api/.env` is absent.
- Web tests run in node with no DOM. Pure logic is tested directly. Components use react-test-renderer, `vi.stubGlobal("window", …)` and mocked `react-i18next`/API modules.

**Line endings**
- Working-tree files are CRLF (`core.autocrlf=true`), including both locale files.
- Edit them only with exact-snippet edits (the Edit tool). Never re-serialize JSON or rewrite whole files with a script.

**Commands**
- Run from the repo root in Git Bash.
- API: `cd services/api && npx vitest run <file>`, `npm test`, `npm run typecheck`.
- Web: `cd apps/web && npx vitest run <file>`, `npm test`, `npm run typecheck`, `npm run check-i18n`, `npm run build`.

## File Structure

**API (`services/api`)**

| File | Responsibility |
|---|---|
| `migrations/035_electronic_queue.sql` | Doctor room and letter; appointment queue columns; indexes (including the partial `idx_appointments_in_consultation_day`, because production has no `start_at` index); `queue_counters`; `queue_displays` |
| `src/repositories/interfaces/queueTypes.ts` | All queue and TV-screen types plus the `IQueueRepository` / `IQueueDisplaysRepository` interfaces |
| `src/services/queue/queueRules.ts` | Pure rules: `clinicToday`, `addDays`, `formatQueueCode`, `maskPatientName`, `compareCabinets`, `planQueueChange` |
| `src/services/queue/displayCode.ts` | Short screen codes: generate, normalize, format, sha256 hash |
| `src/services/queue/queueDay.ts` | Rows → per-doctor day view (`toQueueEntry`, `buildQueueDoctors`, `loadQueueDay`) |
| `src/services/queue/displayState.ts` | Day view → public TV state (masking, current, waiting, recent calls) |
| `src/repositories/postgres/queueAllocation.ts` | `allocateQueueNumber` counter upsert plus doctor-letter snapshot, run on the caller's transaction client |
| `src/repositories/postgres/PostgresQueueRepository.ts` | Day rows, doctors, call, call-next (`SKIP LOCKED`), backfill issue, ahead count, clinic name |
| `src/repositories/postgres/PostgresQueueDisplaysRepository.ts` | TV screens CRUD and lookup by token hash (joins `clinics` for name and subscription) |
| `src/services/queueService.ts` | Staff queue use cases with doctor scoping |
| `src/services/queueDisplaysService.ts` | Screen management (superadmin) and the public screen state |
| `src/controllers/queueController.ts` | Controllers for the staff queue, screens and public endpoints |
| `src/validators/queueValidators.ts` | Id param validation |
| `src/routes/queueRoutes.ts` | Staff router, mounted at `/api/queue` |
| `src/routes/publicRoutes.ts` | Public router, mounted at `/api/public` |
| `src/middleware/publicRateLimit.ts` | 300 requests/min per client IP (`CF-Connecting-IP` aware) |

API files modified:
- `middleware/errorHandler.ts` (unique-index message)
- `middleware/subscriptionMiddleware.ts` (reusable `getSubscriptionBlock`)
- `middleware/requestLogger.ts` (skips successful TV and staff queue polls; redacts the screen code in logged URLs)
- `auth/permissions.ts`
- doctors: `coreTypes`, `mockDatabase`, `PostgresDoctorsRepository`, `doctorsValidators`, `doctorsController`
- appointments: `coreTypes`, `IAppointmentsRepository`, `PostgresAppointmentsRepository`, Mock repository, `appointmentsService`
- `container/services.ts`
- `routes/index.ts`

API test files:
- New: `queueRules`, `displayCode`, `migration035`, `doctorsValidators`, `PostgresDoctorsRepository`, `appointmentsQueue`, `queueDay`, `PostgresQueueRepository`, `permissions`, `displayState`, `subscriptionMiddleware`, `requestLogger`, `queueDisplays`
- Updated: `PostgresAppointmentsRepository.test.ts`, `appointmentsService.test.ts`

Preview stand: `scripts/queue-preview.cjs`.

**Web (`apps/web`)**

| File | Responsibility |
|---|---|
| `src/modules/queue/api/queueTypes.ts` | Mirror of the API types |
| `src/modules/queue/api/queueApi.ts` | Staff client (stored token) |
| `src/modules/queue/api/publicQueueApi.ts` | Bare-fetch TV client that maps 404/403 to `not_found`/`inactive` |
| `src/modules/queue/components/QueueCodeBadge.tsx` | Queue code badge on appointment cards |
| `src/modules/queue/print/ticketHtml.ts`, `printTicket.ts` | 58 mm ticket HTML (pure) and hidden-iframe printing |
| `src/modules/queue/components/DisplaysPanel.tsx`, `DisplayFormModal.tsx` | TV screen management for superadmin |
| `src/modules/queue/pages/QueuePage.tsx`, `components/CabinetQueueCard.tsx`, `components/QueueEntryRow.tsx`, `hooks/usePolling.ts`, `utils/queueView.ts` | Staff Queue page |
| `src/modules/queue/tv/*` | TV logic and page (details below) |
| `src/modules/doctors/utils/queueFields.ts` | Room and letter input normalisation and validation |
| `src/modules/appointments/utils/queueIssue.ts`, `src/modules/dashboard/utils/arrivalToast.ts` | «Выдать номер» helper and the dashboard arrival notice text |
| `scripts/queueVoice.mjs`, `scripts/generate-queue-voice.mjs` | Azure voice clip generation, output to `public/queue-voice/{uz,ru}/<id>.mp3` |

The TV folder `src/modules/queue/tv/` holds:
- voice catalogue and phrases: `voiceClips.json`, `voicePhrases.ts`
- `callTracker.ts`, `tvLabels.ts`, `tvLayout.ts`, `audioTrim.ts`, `codeInput.ts`
- `tvPath.ts`, `tvTime.ts`, `tvDevice.ts`
- `useQueueDisplay.ts`, `announcer.ts`
- pages and routing: `TvLaunchPage.tsx`, `TvDisplayPage.tsx`, `TvApp.tsx`
- `tv.css`

Web files modified:
- `App.tsx` (TV switch outside `AuthProvider`)
- `auth/permissions.ts`, `auth/roleGroups.ts`
- `appointmentsFlowApi.ts`
- `DoctorsPage.tsx`
- `AppointmentsPage.tsx`, `AppointmentCard.tsx`, `AppointmentMobileCard.tsx`, `appointmentActions.ts` (queue code, «Талон», «Выдать номер»)
- `DashboardPage.tsx`, `dashboardApi.ts` (the arrival notice shows the issued number)
- `AppRouter.tsx`, `navigationConfig.tsx`, `MainLayout.tsx`
- `locales/ru.json`, `locales/uz.json`
- `vite.config.ts` (build target lowered for Chromium 87 TVs)
- `package.json`, `.gitignore`

**Docs:** `docs/queue.md` (staff guide, TV/printer setup, voice generation, preview stand), the spec addendum, and `HANDOFF.md`.

## Task Overview

| # | Task | App |
|---|---|---|
| 1 | Migration 035, queue types and pure queue helpers | API |
| 2 | Doctor room and queue letter | API |
| 3 | Queue numbers on arrival (appointments integration) | API |
| 4 | Queue staff API: day view, call, call-next, issue, ticket, plus permissions | API |
| 5 | TV screens: display management and the public queue endpoint | API |
| 6 | Web foundations: permissions, API clients, types, i18n namespace | Web |
| 7 | Doctor room and queue letter on the Doctors page | Web |
| 8 | Queue code on appointments, «Отметить приход» wording, ticket printing | Web |
| 9 | TV screens management panel (superadmin) | Web |
| 10 | Staff Queue page `/queue` (mounts the panel from Task 9) | Web |
| 11 | TV logic: voice catalogue, phrases, call tracking, labels, layout (pure) | Web |
| 12 | TV screen page `/tv`, `/tv/:code` | Web |
| 13 | Voice clip generation script (Azure neural TTS) | Web script |
| 14 | Local preview stand, docs, full verification, handoff | All |

Tasks run strictly in this order. Each task's steps assume every earlier task is complete. Every task ends with its app's full test suite and typecheck green.

---

### Task 1: Migration 035, queue types and pure queue helpers (API)

**Files:**
- Create: `services/api/migrations/035_electronic_queue.sql`
- Create: `services/api/src/repositories/interfaces/queueTypes.ts`
- Create: `services/api/src/services/queue/queueRules.ts`
- Create: `services/api/src/services/queue/displayCode.ts`
- Modify: `services/api/src/middleware/errorHandler.ts` (lines 33–35, inside `mapPostgresError`)
- Test: `services/api/src/services/queue/queueRules.test.ts`
- Test: `services/api/src/services/queue/displayCode.test.ts`
- Test: `services/api/src/repositories/postgres/migration035.test.ts`

**Interfaces:**
- Consumes: `AppointmentStatus` from `services/api/src/repositories/interfaces/coreTypes.ts` (existing); `ApiError`, `errorHandler` from `services/api/src/middleware/errorHandler.ts` (existing).
- Produces:
  - DB (migration 035): `doctors.room`, `doctors.queue_prefix`; `appointments.queue_number`, `appointments.queue_prefix`, `appointments.queue_date`, `appointments.queue_issued_at`, `appointments.queue_called_at`, `appointments.queue_call_count` (NOT NULL DEFAULT 0); unique index `ux_appointments_queue_ticket (doctor_id, queue_date, queue_number) WHERE queue_number IS NOT NULL`; partial indexes `idx_appointments_queue_day (clinic_id, queue_date, doctor_id) WHERE queue_number IS NOT NULL AND deleted_at IS NULL` and `idx_appointments_in_consultation_day (clinic_id, start_at) WHERE status = 'in_consultation' AND deleted_at IS NULL` (one per OR branch of Task 4's `listDayRows`); table `queue_counters (clinic_id, doctor_id, queue_date, last_number, PK (doctor_id, queue_date))`; table `queue_displays` + `idx_queue_displays_clinic`. Postgres names the CHECKs `doctors_room_check`, `doctors_queue_prefix_check`, `appointments_queue_number_check`, `queue_displays_name_check`, `queue_displays_language_check`, and the token unique `queue_displays_token_hash_key`.
  - `services/api/src/repositories/interfaces/queueTypes.ts`: `QueueDirective`, `QueueEntryState`, `QueueEntry`, `QueueDoctorDay`, `QueueToday`, `QueueTicket`, `QueueDayRow`, `QueueDoctorRow`, `QueueTarget`, `IQueueRepository`, `QueueDisplayLanguage`, `QueueDisplay`, `QueueDisplayInput`, `QueueDisplayWithCode`, `QueueDisplayLookup`, `IQueueDisplaysRepository`, `QueueDisplayCabinet`, `QueueDisplayCall`, `QueueDisplayState` (exactly contract §3).
  - `services/api/src/services/queue/queueRules.ts`: `clinicToday(timeZone: string, now: Date): string`, `addDays(day: string, n: number): string`, `formatQueueCode(prefix: string | null | undefined, queueNumber: number): string`, `maskPatientName(fullName: string | null | undefined): string`, `compareCabinets(a: { room: string | null; doctorName: string }, b: { room: string | null; doctorName: string }): number`, types `QueueSnapshot`, `QueueTargetState`, `planQueueChange(current: QueueSnapshot | null, next: QueueTargetState, today: string): QueueDirective`.
  - `services/api/src/services/queue/displayCode.ts`: `DISPLAY_CODE_ALPHABET`, `generateDisplayCode(): string`, `formatDisplayCode(canonical: string): string`, `normalizeDisplayCode(input: string): string | null`, `hashDisplayCode(canonical: string): string`.
  - `errorHandler`: a Postgres error with `constraint === "ux_appointments_queue_ticket"` becomes HTTP 409 `{ "error": "Номер очереди уже занят, повторите действие" }`.

Before you start (applies to Tasks 1 and 2):
- Run every command from the repo root in Git Bash. The repo has `core.autocrlf=true`, so existing files under `services/api` are checked out with CRLF line endings. Keep them CRLF when editing (the Edit tool does this; do not run a formatter that rewrites line endings). New files may be written with LF; git normalizes them.
- `npm test` in `services/api` also runs two older suites (`src/repositories/postgres/PostgresAppointmentsRepository.test.ts`, `src/utils/numbers/parseNumericInput.test.ts`) that import `config/env` without mocking it; `env.ts` throws `JWT_SECRET environment variable is required` unless `services/api/.env` (present on the dev PCs, never commit it) or the shell provides it. If you see that error, run `JWT_SECRET=local-tests-only npm test`. It is not caused by this task.
- Every new test that imports `middleware/errorHandler` (directly or through `tenancy/clinicContext`) must `vi.mock` the env module, because `errorHandler.ts` imports `config/env`.

- [ ] **Step 1: Write the failing test for the pure queue rules**

Create `services/api/src/services/queue/queueRules.test.ts`. The `planQueueChange` table covers every rule and combination of contract §2 (new appointment, arrival today/other day, idempotent re-arrival, number from another day, `no_show → arrived`, doctor change, date change, plain status changes).

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  clinicToday,
  compareCabinets,
  formatQueueCode,
  maskPatientName,
  planQueueChange,
  type QueueSnapshot,
  type QueueTargetState,
} from "./queueRules";

describe("clinicToday", () => {
  it.each([
    ["Asia/Tashkent", "2026-09-30T06:00:00Z", "2026-09-30"], // the fixed test clock: 11:00 in Tashkent
    ["Asia/Tashkent", "2026-09-30T18:59:59Z", "2026-09-30"], // 23:59:59 local — still today
    ["Asia/Tashkent", "2026-09-30T19:00:00Z", "2026-10-01"], // 00:00 local — the queue day turns over
    ["Asia/Tashkent", "2026-12-31T19:00:00Z", "2027-01-01"],
    ["UTC", "2026-09-30T23:59:59Z", "2026-09-30"],
    ["America/New_York", "2026-10-01T03:00:00Z", "2026-09-30"],
  ])("%s at %s → %s", (timeZone, instant, expected) => {
    expect(clinicToday(timeZone, new Date(instant))).toBe(expected);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-09-30", 0, "2026-09-30"],
    ["2026-09-30", 31, "2026-10-31"],
    ["2026-10-01", -1, "2026-09-30"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2028-02-28", 1, "2028-02-29"], // leap year
    ["2028-02-29", 1, "2028-03-01"],
    ["2027-02-28", 1, "2027-03-01"], // not a leap year
    ["2028-03-01", -1, "2028-02-29"],
  ])("%s + %d days → %s", (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected);
  });
});

describe("formatQueueCode", () => {
  it.each([
    ["К", 5, "К-05"],
    ["к", 5, "К-05"], // lower-case prefix is upper-cased
    ["A", 12, "A-12"],
    ["К", 123, "К-123"], // 3-digit numbers are not truncated
    [null, 7, "07"],
    [undefined, 12, "12"],
    ["", 7, "07"], // empty prefix → digits only
    ["  ", 100, "100"],
  ] as Array<[string | null | undefined, number, string]>)("(%s, %d) → %s", (prefix, queueNumber, expected) => {
    expect(formatQueueCode(prefix, queueNumber)).toBe(expected);
  });
});

describe("maskPatientName", () => {
  it.each([
    ["Каримова Анна Сергеевна", "Анна К."], // three words: surname name patronymic
    ["Каримова Анна", "Анна К."], // two words
    ["Анна", "Анна"], // one word stays as is
    ["  Каримова   Анна  Сергеевна ", "Анна К."], // extra spaces
    ["каримова анна", "анна К."], // the initial is upper-cased, the name is kept as typed
    ["Oʻrinboyeva Gulnoza", "Gulnoza O."], // U+02BB is not the first code point
    ["Gʻaniyev Toʻlqin Akmal oʻgʻli", "Toʻlqin G."], // U+02BB inside the shown name is kept
    ["ўринбоева Гулноза", "Гулноза Ў."], // Uzbek Cyrillic letter upper-cased
    ["𐐨ohnson John", "John 𐐀."], // astral first letter: Array.from, not charAt
    ["", ""],
    ["   ", ""],
    [null, ""],
    [undefined, ""],
  ] as Array<[string | null | undefined, string]>)("%j → %j", (fullName, expected) => {
    expect(maskPatientName(fullName)).toBe(expected);
  });
});

describe("compareCabinets", () => {
  it("orders numeric rooms ascending, then named rooms, then rooms not set; ties by doctor name", () => {
    const cabinets = [
      { room: null, doctorName: "Юсупов" },
      { room: "10", doctorName: "Алиева" },
      { room: "УЗИ", doctorName: "Бобуров" },
      { room: "2", doctorName: "Юсупов" },
      { room: "Лаборатория", doctorName: "Валиев" },
      { room: null, doctorName: "Абдуллаев" },
      { room: "2", doctorName: "Алиева" },
      { room: "3а", doctorName: "Ганиев" },
      { room: "9", doctorName: "Дадаев" },
    ];
    expect([...cabinets].sort(compareCabinets).map((c) => `${c.room ?? "—"}/${c.doctorName}`)).toEqual([
      "2/Алиева",
      "2/Юсупов",
      "9/Дадаев",
      "10/Алиева", // numeric, not string order ("10" < "9" as strings)
      "3а/Ганиев", // "3а" is not a number → named group
      "Лаборатория/Валиев",
      "УЗИ/Бобуров",
      "—/Абдуллаев",
      "—/Юсупов",
    ]);
  });

  it("returns 0 for the same room and doctor, and is antisymmetric", () => {
    const a = { room: "5", doctorName: "Алиева" };
    const b = { room: "Лаборатория", doctorName: "Алиева" };
    expect(compareCabinets(a, { ...a })).toBe(0);
    expect(Math.sign(compareCabinets(a, b))).toBe(-1);
    expect(Math.sign(compareCabinets(b, a))).toBe(1);
  });
});

describe("planQueueChange", () => {
  const TODAY = "2026-09-30";
  const TOMORROW = "2026-10-01";
  const YESTERDAY = "2026-09-29";
  const at = (day: string, time = "10:00:00") => `${day} ${time}`;
  const snap = (patch: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
    status: "scheduled", doctorId: 10, startAt: at(TODAY), queueNumber: null, queueDate: null, ...patch,
  });
  const target = (patch: Partial<QueueTargetState> = {}): QueueTargetState => ({
    status: "arrived", doctorId: 10, startAt: at(TODAY), ...patch,
  });
  const ISSUE = { kind: "issue", day: TODAY };
  const KEEP = { kind: "keep" };
  const CLEAR = { kind: "clear" };
  const numbered = { status: "arrived" as const, queueNumber: 3, queueDate: TODAY };

  it.each([
    // New appointment (current = null)
    ["new, arrived today → issue", null, target(), ISSUE],
    ["new, arrived on another day → keep (no numbers for other days)", null, target({ startAt: at(TOMORROW) }), KEEP],
    ["new, scheduled today → keep", null, target({ status: "scheduled" }), KEEP],
    ["new, in_consultation today → keep (no number when the doctor takes the patient directly)", null, target({ status: "in_consultation" }), KEEP],
    // Arrival today
    ["scheduled → arrived today → issue", snap(), target(), ISSUE],
    ["confirmed → arrived today → issue", snap({ status: "confirmed" }), target(), ISSUE],
    ["arrived without a number (pre-feature) → arrived today → issue", snap({ status: "arrived" }), target(), ISSUE],
    ["arrived with today's number, same doctor → keep (idempotent)", snap(numbered), target(), KEEP],
    ["arrived with today's number, time moved within today → keep", snap(numbered), target({ startAt: at(TODAY, "15:30:00") }), KEEP],
    ["number dated another day, arrived today → issue (!hasToday)", snap({ ...numbered, queueDate: YESTERDAY }), target(), ISSUE],
    ["number without a date, arrived today → issue (!hasToday)", snap({ ...numbered, queueDate: null }), target(), ISSUE],
    ["numbered yesterday, moved to today and arrived → issue beats clear", snap({ ...numbered, startAt: at(YESTERDAY), queueDate: YESTERDAY }), target(), ISSUE],
    // Return to queue: no_show → arrived
    ["no_show with today's number → arrived today → issue (new number at the end)", snap({ ...numbered, status: "no_show" }), target(), ISSUE],
    ["no_show without a number → arrived today → issue", snap({ status: "no_show" }), target(), ISSUE],
    ["no_show → arrived on another day → keep (the service rejects this earlier)", snap({ status: "no_show", startAt: at(TOMORROW) }), target({ startAt: at(TOMORROW) }), KEEP],
    // Doctor change
    ["arrived with today's number, doctor changed, still arrived today → issue", snap(numbered), target({ doctorId: 11 }), ISSUE],
    ["no number, doctor changed, arrived today → issue", snap(), target({ doctorId: 11 }), ISSUE],
    ["no number, doctor changed, arrived tomorrow → keep", snap({ startAt: at(TOMORROW) }), target({ doctorId: 11, startAt: at(TOMORROW) }), KEEP],
    ["numbered, doctor changed, status becomes scheduled → clear", snap(numbered), target({ doctorId: 11, status: "scheduled" }), CLEAR],
    ["numbered, in_consultation, doctor changed → clear", snap({ ...numbered, status: "in_consultation" }), target({ doctorId: 11, status: "in_consultation" }), CLEAR],
    ["no number, doctor changed, scheduled → keep (nothing to clear)", snap(), target({ doctorId: 11, status: "scheduled" }), KEEP],
    // Date change
    ["numbered, moved to tomorrow while arrived → clear", snap(numbered), target({ startAt: at(TOMORROW) }), CLEAR],
    ["numbered, completed, moved to another day → clear", snap({ ...numbered, status: "completed" }), target({ status: "completed", startAt: at(YESTERDAY) }), CLEAR],
    ["numbered, doctor and date changed → clear", snap(numbered), target({ doctorId: 11, startAt: at(TOMORROW) }), CLEAR],
    ["no number, moved to tomorrow → keep", snap(), target({ status: "scheduled", startAt: at(TOMORROW) }), KEEP],
    ["no number, arrived, moved from tomorrow to today with another doctor → issue", snap({ status: "arrived", startAt: at(TOMORROW) }), target({ doctorId: 11 }), ISSUE],
    // Status changes of a numbered appointment on the same doctor and day keep the number
    ["numbered → in_consultation → keep", snap(numbered), target({ status: "in_consultation" }), KEEP],
    ["numbered → completed → keep", snap({ ...numbered, status: "in_consultation" }), target({ status: "completed" }), KEEP],
    ["numbered → no_show → keep (shown as missed)", snap(numbered), target({ status: "no_show" }), KEEP],
    ["numbered → cancelled → keep (numbers are never reused)", snap(numbered), target({ status: "cancelled" }), KEEP],
    ["scheduled → confirmed today → keep", snap(), target({ status: "confirmed" }), KEEP],
    ["scheduled → arrived on another day → keep (closing past visits needs no number)", snap({ startAt: at(YESTERDAY) }), target({ startAt: at(YESTERDAY) }), KEEP],
  ] as Array<[string, QueueSnapshot | null, QueueTargetState, unknown]>)("%s", (_label, current, next, expected) => {
    expect(planQueueChange(current, next, TODAY)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/services/queue/queueRules.test.ts`
Expected: FAIL with `Error: Cannot find module './queueRules' imported from '.../src/services/queue/queueRules.test.ts'` (no tests run).

- [ ] **Step 3: Implement the queue types and the pure rules**

Create `services/api/src/repositories/interfaces/queueTypes.ts` (all of contract §3; later tasks only import from it):

```ts
import type { AppointmentStatus } from "./coreTypes";

/** What an appointment write must do with the queue fields (decided by `planQueueChange`). */
export type QueueDirective = { kind: "keep" } | { kind: "issue"; day: string } | { kind: "clear" };

export type QueueEntryState = "waiting" | "called" | "serving" | "missed" | "done";

export type QueueEntry = {
  appointmentId: number;
  doctorId: number;
  patientId: number;
  patientName: string;
  number: number | null;      // null only for "serving" without a ticket
  code: string | null;        // formatQueueCode(queuePrefix, number) or null
  state: QueueEntryState;
  startAt: string;            // wall clock "YYYY-MM-DD HH:mm:ss"
  issuedAt: string | null;    // ISO instant
  calledAt: string | null;    // ISO instant
  callCount: number;
};

export type QueueDoctorDay = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  prefix: string | null;
  serving: QueueEntry | null;  // in_consultation today (latest by updatedAt)
  waiting: QueueEntry[];       // status arrived (states waiting + called), by number asc
  missed: QueueEntry[];        // status no_show with today's number, by number asc
  doneCount: number;           // status completed with today's number
};

export type QueueToday = { date: string; timeZone: string; serverTime: string; doctors: QueueDoctorDay[] };

export type QueueTicket = {
  appointmentId: number; clinicName: string; code: string; number: number; doctorName: string; specialty: string;
  room: string | null; issuedAt: string; aheadCount: number; timeZone: string;
};

/** Repository row for one appointment in a queue day. */
export type QueueDayRow = {
  appointmentId: number; doctorId: number; patientId: number; patientName: string; status: AppointmentStatus;
  startAt: string; queueNumber: number | null; queuePrefix: string | null; queueDate: string | null;
  issuedAt: string | null; calledAt: string | null; callCount: number; updatedAt: string;
};
export type QueueDoctorRow = { id: number; name: string; specialty: string; room: string | null; prefix: string | null };
export type QueueTarget = {
  appointmentId: number; doctorId: number; status: AppointmentStatus; startAt: string;
  queueNumber: number | null; queueDate: string | null;
};

export interface IQueueRepository {
  /** Rows with (queue_date = day AND queue_number NOT NULL) OR (status = in_consultation AND start_at within day); excludes cancelled
   *  and deleted; optional doctor filter (null = all). Ordered by doctor_id, queue_number NULLS LAST, id. */
  listDayRows(clinicId: number, day: string, doctorIds: number[] | null): Promise<QueueDayRow[]>;
  getDayRow(clinicId: number, appointmentId: number): Promise<QueueDayRow | null>;
  listDoctors(clinicId: number, doctorIds: number[]): Promise<QueueDoctorRow[]>;
  findTarget(clinicId: number, appointmentId: number): Promise<QueueTarget | null>;
  /** Transaction: lock row FOR UPDATE; if status <> 'arrived' → ApiError 409; if already numbered for `day` → no-op; else allocate. */
  issue(clinicId: number, appointmentId: number, day: string): Promise<void>;
  /** Sets queue_called_at = now(), queue_call_count + 1 for an arrived row numbered on `day`; false if no row matched. */
  call(clinicId: number, appointmentId: number, day: string): Promise<boolean>;
  /** Calls the lowest-numbered arrived, never-called row of the doctor on `day` (FOR UPDATE SKIP LOCKED); returns its id or null. */
  callNext(clinicId: number, doctorId: number, day: string): Promise<number | null>;
  /** Arrived rows of the doctor on `day` with queue_number < number. */
  countAhead(clinicId: number, doctorId: number, day: string, queueNumber: number): Promise<number>;
  /** clinics.name trimmed, or "Клиника" when empty/missing. */
  clinicName(clinicId: number): Promise<string>;
}

export type QueueDisplayLanguage = "uz" | "ru" | "uz_ru";
export type QueueDisplay = {
  id: number; name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage;
  voiceEnabled: boolean; createdAt: string; updatedAt: string;
};
export type QueueDisplayInput = {
  name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage; voiceEnabled: boolean;
};
export type QueueDisplayWithCode = { display: QueueDisplay; code: string }; // code formatted "XXXXX-XXXXX", returned ONCE
export type QueueDisplayLookup = {
  display: QueueDisplay; clinicId: number; clinicName: string;
  subscriptionStatus: string | null; subscriptionEndsAt: string | null;
};

export interface IQueueDisplaysRepository {
  list(clinicId: number): Promise<QueueDisplay[]>;                         // revoked excluded, ordered by id
  create(clinicId: number, input: QueueDisplayInput, tokenHash: string, createdBy: number | null): Promise<QueueDisplay>;
  update(clinicId: number, id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay | null>; // bumps updated_at
  revoke(clinicId: number, id: number): Promise<boolean>;                  // sets revoked_at
  rotate(clinicId: number, id: number, tokenHash: string): Promise<QueueDisplay | null>;
  findByTokenHash(tokenHash: string): Promise<QueueDisplayLookup | null>; // NOT clinic scoped; excludes revoked; joins clinics
  existingDoctorIds(clinicId: number, doctorIds: number[]): Promise<number[]>;
}

export type QueueDisplayCabinet = {
  doctorId: number; doctorName: string; specialty: string; room: string | null;
  current: null | { code: string | null; name: string | null; state: "called" | "serving" };
  waiting: Array<{ code: string; name: string | null }>; // first 5 entries in state "waiting"
  waitingCount: number;                                   // all entries in state "waiting"
};
export type QueueDisplayCall = {
  key: string;            // `${appointmentId}:${callCount}`
  code: string; number: number; name: string | null; room: string | null; doctorName: string; calledAt: string;
};
export type QueueDisplayState = {
  serverTime: string; timeZone: string; clinicName: string;
  display: { name: string; language: QueueDisplayLanguage; voiceEnabled: boolean; showNames: boolean };
  cabinets: QueueDisplayCabinet[];
  recentCalls: QueueDisplayCall[]; // last 20 calls of the day (rows with calledAt and number, any status except cancelled), newest first
};
```

Create `services/api/src/services/queue/queueRules.ts`. Gotchas: `clinicToday` assembles the date from `formatToParts` because the `en-CA` `format()` pattern has differed between ICU versions; `addDays` does the arithmetic in `Date.UTC` so month/year/leap-day rollover is exact and no host time zone is involved; `maskPatientName` upper-cases only the initial (the shown first name stays as stored).

```ts
import type { AppointmentStatus } from "../../repositories/interfaces/coreTypes";
import type { QueueDirective } from "../../repositories/interfaces/queueTypes";

/** Calendar day "YYYY-MM-DD" of `now` in `timeZone` (Intl en-CA). */
export function clinicToday(timeZone: string, now: Date): string {
  // formatToParts instead of format(): the en-CA pattern has changed between ICU versions, the parts have not.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** "YYYY-MM-DD" + n days (UTC date arithmetic on the calendar string). */
export function addDays(day: string, n: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + n));
  return shifted.toISOString().slice(0, 10);
}

/** "К-05", "К-123", "07"; number padded to 2 digits; prefix upper-cased; null/empty prefix → digits only. */
export function formatQueueCode(prefix: string | null | undefined, queueNumber: number): string {
  const digits = String(queueNumber).padStart(2, "0");
  const letter = (prefix ?? "").trim().toUpperCase();
  return letter ? `${letter}-${digits}` : digits;
}

/** "Фамилия Имя Отчество" → "Имя Ф."; single word → as is; empty → "". Unicode-safe first letter (Array.from), upper-cased. */
export function maskPatientName(fullName: string | null | undefined): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  const initial = (Array.from(words[0])[0] ?? "").toUpperCase();
  return `${words[1]} ${initial}.`;
}

const NUMERIC_ROOM = /^\d+$/;

/** Sort key for cabinets: numeric rooms ascending first, then other rooms (localeCompare "ru"), then null rooms; ties by doctorName. */
export function compareCabinets(
  a: { room: string | null; doctorName: string },
  b: { room: string | null; doctorName: string }
): number {
  const rank = (room: string) => (room === "" ? 2 : NUMERIC_ROOM.test(room) ? 0 : 1);
  const roomA = (a.room ?? "").trim();
  const roomB = (b.room ?? "").trim();
  const byGroup = rank(roomA) - rank(roomB);
  if (byGroup !== 0) return byGroup;
  if (rank(roomA) === 0) {
    const byNumber = Number(roomA) - Number(roomB);
    if (byNumber !== 0) return byNumber;
  } else if (rank(roomA) === 1) {
    const byName = roomA.localeCompare(roomB, "ru");
    if (byName !== 0) return byName;
  }
  return a.doctorName.localeCompare(b.doctorName, "ru");
}

export type QueueSnapshot = { status: AppointmentStatus; doctorId: number; startAt: string; queueNumber: number | null; queueDate: string | null };
export type QueueTargetState = { status: AppointmentStatus; doctorId: number; startAt: string };

/**
 * Rules (current = null for a new appointment):
 *   isToday = next.startAt.slice(0,10) === today
 *   hasToday = current?.queueNumber != null && current.queueDate === today
 *   doctorChanged = current != null && current.doctorId !== next.doctorId
 *   dateChanged = current != null && current.startAt.slice(0,10) !== next.startAt.slice(0,10)
 *   if next.status === "arrived" && isToday:
 *       current?.status === "no_show" → issue; !hasToday → issue; doctorChanged → issue; else keep
 *   if current?.queueNumber != null && (doctorChanged || dateChanged) → clear
 *   else keep
 *   issue → { kind: "issue", day: today }
 */
export function planQueueChange(current: QueueSnapshot | null, next: QueueTargetState, today: string): QueueDirective {
  const isToday = next.startAt.slice(0, 10) === today;
  const hasToday = current != null && current.queueNumber != null && current.queueDate === today;
  const doctorChanged = current != null && current.doctorId !== next.doctorId;
  const dateChanged = current != null && current.startAt.slice(0, 10) !== next.startAt.slice(0, 10);

  if (next.status === "arrived" && isToday) {
    if (current?.status === "no_show" || !hasToday || doctorChanged) {
      return { kind: "issue", day: today };
    }
    return { kind: "keep" };
  }
  if (current != null && current.queueNumber != null && (doctorChanged || dateChanged)) {
    return { kind: "clear" };
  }
  return { kind: "keep" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/services/queue/queueRules.test.ts`
Expected: PASS — `Test Files 1 passed (1)`, `Tests 71 passed (71)`.

- [ ] **Step 5: Write the failing test for display codes**

Create `services/api/src/services/queue/displayCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DISPLAY_CODE_ALPHABET,
  formatDisplayCode,
  generateDisplayCode,
  hashDisplayCode,
  normalizeDisplayCode,
} from "./displayCode";

describe("DISPLAY_CODE_ALPHABET", () => {
  it("has 31 unique characters and no look-alikes", () => {
    expect(DISPLAY_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(DISPLAY_CODE_ALPHABET).size).toBe(31);
    for (const excluded of ["0", "1", "I", "L", "O"]) {
      expect(DISPLAY_CODE_ALPHABET).not.toContain(excluded);
    }
  });
});

describe("generateDisplayCode", () => {
  it("returns 10 characters from the alphabet only", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateDisplayCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    }
  });

  it("does not repeat over 200 samples", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateDisplayCode()));
    expect(codes.size).toBe(200);
  });

  it("round-trips through format and normalize", () => {
    const code = generateDisplayCode();
    expect(normalizeDisplayCode(formatDisplayCode(code))).toBe(code);
  });
});

describe("formatDisplayCode", () => {
  it("splits the canonical code 5 + 5 with a dash", () => {
    expect(formatDisplayCode("K7M2Q9XR4P")).toBe("K7M2Q-9XR4P");
  });
});

describe("normalizeDisplayCode", () => {
  it.each([
    ["K7M2Q9XR4P", "K7M2Q9XR4P"],
    ["K7M2Q-9XR4P", "K7M2Q9XR4P"], // dash from the formatted code
    ["k7m2q-9xr4p", "K7M2Q9XR4P"], // lower-case typed on a TV remote
    ["  K7M2Q 9XR4P  ", "K7M2Q9XR4P"], // spaces
    ["k7m2q_9xr4p\n", "K7M2Q9XR4P"], // any other separator is stripped too
  ])("accepts %j → %s", (input, expected) => {
    expect(normalizeDisplayCode(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["K7M2Q-9XR4", "9 characters"],
    ["K7M2Q-9XR4PP", "11 characters"],
    ["K7M2Q-9XR40", "excluded 0"],
    ["K7M2Q-9XR41", "excluded 1"],
    ["K7M2Q-9XR4I", "excluded I"],
    ["K7M2Q-9XR4L", "excluded L"],
    ["K7M2Q-9XR4O", "excluded O"],
    ["К7М2Q-9ХR4Р", "Cyrillic look-alikes are stripped, leaving 6 characters"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizeDisplayCode(input)).toBeNull();
  });
});

describe("hashDisplayCode", () => {
  it("is the sha256 hex of the canonical code and is stable", () => {
    expect(hashDisplayCode("K7M2Q9XR4P")).toBe("c0f0e382b4bf7b79193b8cc9c22a202247ffc424b81d8122e920ac1651b58833");
    expect(hashDisplayCode("K7M2Q9XR4P")).toBe(hashDisplayCode("K7M2Q9XR4P"));
    expect(hashDisplayCode("K7M2Q9XR4P")).not.toBe(hashDisplayCode("K7M2Q9XR4Q"));
    expect(hashDisplayCode(generateDisplayCode())).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/services/queue/displayCode.test.ts`
Expected: FAIL with `Error: Cannot find module './displayCode' imported from '.../src/services/queue/displayCode.test.ts'`.

- [ ] **Step 7: Implement the display code helpers**

Create `services/api/src/services/queue/displayCode.ts` (`crypto.randomInt` is uniform, unlike `randomBytes % 31`):

```ts
import { createHash, randomInt } from "node:crypto";

/** No look-alike characters (0/O, 1/I/L): the code is typed with a TV remote. 31 chars → 10 chars ≈ 49.5 bits. */
export const DISPLAY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars

const CODE_LENGTH = 10;

/** 10 random chars from the alphabet (crypto.randomInt). Returns canonical form (no dash). */
export function generateDisplayCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += DISPLAY_CODE_ALPHABET[randomInt(DISPLAY_CODE_ALPHABET.length)];
  }
  return code;
}

/** "K7M2Q9XR4P" → "K7M2Q-9XR4P". */
export function formatDisplayCode(canonical: string): string {
  return `${canonical.slice(0, 5)}-${canonical.slice(5)}`;
}

/** Uppercases, strips everything except [0-9A-Z]; returns canonical 10-char code or null if length != 10 or any char outside the alphabet. */
export function normalizeDisplayCode(input: string): string | null {
  const stripped = String(input ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (stripped.length !== CODE_LENGTH) return null;
  for (const char of stripped) {
    if (!DISPLAY_CODE_ALPHABET.includes(char)) return null;
  }
  return stripped;
}

/** sha256 hex of the canonical code. */
export function hashDisplayCode(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/services/queue/displayCode.test.ts`
Expected: PASS — `Tests 20 passed (20)`.

- [ ] **Step 9: Write the failing migration test (PGlite)**

Create `services/api/src/repositories/postgres/migration035.test.ts`. It builds the contract §1 stub tables (production has `clinics` and the `clinic_id` columns only through schema drift, so no earlier migration creates them), inserts one appointment BEFORE the migration to prove it is additive, applies 033 and then 035 twice. Gotchas: never pass explicit ids to a `bigserial` table in fixtures (the sequence does not advance and the next default id collides with `appointments_pkey`); `db.query` accepts one statement only, so migration files go through `db.exec`.

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Request, Response } from "express";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-migration-035-tests-only" } }));
import { errorHandler } from "../../middleware/errorHandler";

const db = new PGlite();
const migration = (file: string) => readFileSync(resolve(__dirname, "../../../migrations", file), "utf8");
const COUNTER_UPSERT = `INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number) VALUES ($1, $2, $3::date, 1)
  ON CONFLICT (doctor_id, queue_date) DO UPDATE SET last_number = queue_counters.last_number + 1 RETURNING last_number`;
const nextNumber = async (doctorId: number, day: string) =>
  Number((await db.query<{ last_number: number }>(COUNTER_UPSERT, [1, doctorId, day])).rows[0].last_number);
/** Resolves to the Postgres error (code + constraint) or null when the statement succeeds. */
const failure = async (sql: string, params?: unknown[]) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
};
let preExisting: { queue_number: number | null; queue_prefix: string | null; queue_call_count: number } | undefined;

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
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Чужая');
    INSERT INTO users(id, clinic_id) VALUES (1, 1);
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримова Анна');
    INSERT INTO doctors(id, clinic_id, full_name) VALUES (10, 1, 'Др. Алиева'), (11, 1, 'Др. Юсупов');
    INSERT INTO appointments(clinic_id, patient_id, doctor_id, start_at, end_at, status)
      VALUES (1, 100, 10, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived');`);
  await db.exec(migration("033_call_center_daily_workflow.sql"));
  await db.exec(migration("035_electronic_queue.sql"));
  // The runner applies each file once, but a failed deploy may retry it: 035 must be safe to run again.
  await db.exec(migration("035_electronic_queue.sql"));
  preExisting = (await db.query<{ queue_number: number | null; queue_prefix: string | null; queue_call_count: number }>(
    "SELECT queue_number, queue_prefix, queue_call_count FROM appointments WHERE id = 1"
  )).rows[0];
}, 30000);
afterAll(() => db.close());

describe("migration 035 electronic queue", () => {
  it("is additive: an appointment that existed before gets empty queue fields and a zero call count", () => {
    expect(preExisting).toEqual({ queue_number: null, queue_prefix: null, queue_call_count: 0 });
  });

  it("is idempotent: running it twice creates each constraint and index once", async () => {
    const constraints = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname LIKE 'doctors_room_check%' OR conname LIKE 'doctors_queue_prefix_check%'
         OR conname LIKE 'appointments_queue_number_check%' ORDER BY conname`
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "appointments_queue_number_check",
      "doctors_queue_prefix_check",
      "doctors_room_check",
    ]);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('ux_appointments_queue_ticket', 'idx_appointments_queue_day',
         'idx_appointments_in_consultation_day', 'idx_queue_displays_clinic') ORDER BY indexname`
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "idx_appointments_in_consultation_day",
      "idx_appointments_queue_day",
      "idx_queue_displays_clinic",
      "ux_appointments_queue_ticket",
    ]);
    // The two queue-day indexes serve the two OR branches of Task 4's listDayRows; their partial predicates must match it.
    const dayIndexes = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname IN ('idx_appointments_queue_day', 'idx_appointments_in_consultation_day') ORDER BY indexname"
    );
    expect(dayIndexes.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX idx_appointments_in_consultation_day ON public.appointments USING btree (clinic_id, start_at) WHERE ((status = 'in_consultation'::text) AND (deleted_at IS NULL))",
      "CREATE INDEX idx_appointments_queue_day ON public.appointments USING btree (clinic_id, queue_date, doctor_id) WHERE ((queue_number IS NOT NULL) AND (deleted_at IS NULL))",
    ]);
  });

  it("checks doctor room and queue letter", async () => {
    expect(await failure("UPDATE doctors SET room = '   ' WHERE id = 10")).toMatchObject({ code: "23514", constraint: "doctors_room_check" });
    expect(await failure("UPDATE doctors SET room = $1 WHERE id = 10", ["x".repeat(21)])).toMatchObject({ code: "23514" });
    expect(await failure("UPDATE doctors SET room = $1 WHERE id = 10", ["2".repeat(20)])).toBeNull();
    expect(await failure("UPDATE doctors SET queue_prefix = 'AB' WHERE id = 10")).toMatchObject({ code: "23514", constraint: "doctors_queue_prefix_check" });
    expect(await failure("UPDATE doctors SET queue_prefix = 'К', room = '12' WHERE id = 10")).toBeNull(); // Cyrillic letter: char_length 1
    expect(await failure("UPDATE doctors SET queue_prefix = NULL, room = NULL WHERE id = 11")).toBeNull();
  });

  it("checks appointment queue numbers and display settings", async () => {
    expect(await failure("UPDATE appointments SET queue_number = 0 WHERE id = 1")).toMatchObject({ code: "23514", constraint: "appointments_queue_number_check" });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash, language) VALUES (1, 'Холл', 'hash-en', 'en')"))
      .toMatchObject({ code: "23514", constraint: "queue_displays_language_check" });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash) VALUES (1, '   ', 'hash-blank')"))
      .toMatchObject({ code: "23514", constraint: "queue_displays_name_check" });
  });

  it("creates displays with defaults and a unique token hash", async () => {
    const created = await db.query<{ doctor_ids: number[] | null; show_names: boolean; language: string; voice_enabled: boolean; revoked_at: Date | null }>(
      "INSERT INTO queue_displays(clinic_id, name, token_hash, created_by) VALUES (1, 'Холл', 'hash-1', 1) RETURNING doctor_ids, show_names, language, voice_enabled, revoked_at"
    );
    expect(created.rows[0]).toEqual({ doctor_ids: null, show_names: true, language: "uz_ru", voice_enabled: true, revoked_at: null });
    expect(await failure("INSERT INTO queue_displays(clinic_id, name, token_hash) VALUES (1, 'Холл 2', 'hash-1')")).toMatchObject({ code: "23505" });
    const withDoctors = await db.query<{ doctor_ids: number[] }>(
      "INSERT INTO queue_displays(clinic_id, name, token_hash, doctor_ids) VALUES (1, 'Второй этаж', 'hash-2', $1::bigint[]) RETURNING doctor_ids",
      [[10, 11]]
    );
    expect(withDoctors.rows[0].doctor_ids.map(Number)).toEqual([10, 11]);
  });

  it("rejects a second appointment with the same doctor, day and number", async () => {
    const insert = (doctorId: number, queueNumber: number | null, day: string) =>
      failure("INSERT INTO appointments(clinic_id, patient_id, doctor_id, status, queue_number, queue_date) VALUES (1, 100, $1, 'arrived', $2, $3::date)", [doctorId, queueNumber, day]);
    expect(await insert(10, 1, "2026-09-30")).toBeNull();
    const duplicate = await insert(10, 1, "2026-09-30");
    expect(duplicate).toMatchObject({ code: "23505", constraint: "ux_appointments_queue_ticket" });
    expect(await insert(11, 1, "2026-09-30")).toBeNull(); // another doctor
    expect(await insert(10, 1, "2026-10-01")).toBeNull(); // another day
    expect(await insert(10, null, "2026-09-30")).toBeNull(); // rows without a number never collide
    expect(await insert(10, null, "2026-09-30")).toBeNull();

    // errorHandler turns the index violation into a readable 409 instead of the generic duplicate message.
    let status = 0;
    let body: unknown;
    const res = { status(code: number) { status = code; return this; }, json(payload: unknown) { body = payload; return this; } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    errorHandler(duplicate, {} as Request, res as unknown as Response, () => undefined);
    consoleError.mockRestore();
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Номер очереди уже занят, повторите действие" });
  });

  it("allocates counter numbers 1, 2, 3 per doctor and day independently", async () => {
    expect(await nextNumber(10, "2026-09-30")).toBe(1);
    expect(await nextNumber(10, "2026-09-30")).toBe(2);
    expect(await nextNumber(11, "2026-09-30")).toBe(1); // doctors are independent
    expect(await nextNumber(10, "2026-10-01")).toBe(1); // a new day starts at 1
    expect(await nextNumber(10, "2026-09-30")).toBe(3);
    expect(await failure(COUNTER_UPSERT, [1, 999, "2026-09-30"])).toMatchObject({ code: "23503" }); // unknown doctor
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/repositories/postgres/migration035.test.ts`
Expected: FAIL — the suite fails in `beforeAll` with `Error: ENOENT: no such file or directory, open '...\services\api\migrations\035_electronic_queue.sql'` (7 tests skipped).

- [ ] **Step 11: Create the migration**

Create `services/api/migrations/035_electronic_queue.sql` (contract §1 SQL, plus the partial index `idx_appointments_in_consultation_day` explained below the block, plus Russian comments in the style of 034; no `BEGIN`/`COMMIT` — `scripts/db-migrate.cjs` wraps each file in its own transaction; no `CONCURRENTLY`). `ADD COLUMN IF NOT EXISTS … CHECK (…)` skips the CHECK too when the column exists, so a second run does not create `doctors_room_check1`; the test asserts that.

```sql
-- Электронная очередь: номер у каждого врача на день, вызов на ТВ-экран. Только добавления.
-- Статусы записи остаются единственным источником правды: «Ждёт» = arrived без вызова, «Вызван» = arrived с вызовом,
-- «На приёме» = in_consultation. Миграция идемпотентна (IF NOT EXISTS везде), BEGIN/COMMIT ставит db-migrate.cjs.

-- Кабинет врача (показывается на ТВ и талоне) и необязательная буква очереди («К» → талон «К-05»).
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS room TEXT NULL
    CHECK (room IS NULL OR char_length(btrim(room)) BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL
    CHECK (queue_prefix IS NULL OR char_length(queue_prefix) = 1);

-- Номер в очереди врача на день (queue_date — календарный день клиники) и история вызова.
-- queue_prefix — снимок буквы врача на момент выдачи: напечатанный талон не меняется, если букву врача поменяют позже.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS queue_number INTEGER NULL CHECK (queue_number > 0),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL,
  ADD COLUMN IF NOT EXISTS queue_date DATE NULL,
  ADD COLUMN IF NOT EXISTS queue_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_called_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_call_count INTEGER NOT NULL DEFAULT 0;

-- Страховка от дублей поверх счётчика: один номер у врача в день выдаётся один раз.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_queue_ticket
  ON appointments (doctor_id, queue_date, queue_number)
  WHERE queue_number IS NOT NULL;
-- Очередь клиники на день (ТВ и страница «Очередь»): ветка «номер на этот день».
CREATE INDEX IF NOT EXISTS idx_appointments_queue_day
  ON appointments (clinic_id, queue_date, doctor_id)
  WHERE queue_number IS NOT NULL AND deleted_at IS NULL;
-- Вторая ветка того же запроса: «На приёме» с start_at в границах дня (в том числе без номера, если врач принял
-- пациента напрямую). Запрос выполняется при каждом опросе ТВ (2 с) и страницы «Очередь» (5 с), а в production
-- у appointments нет индекса по start_at (есть только pkey и индексы по clinic_id/created_by_doctor_id/обзвону).
-- С этим индексом обе ветки OR читаются через BitmapOr, без полного просмотра записей клиники.
CREATE INDEX IF NOT EXISTS idx_appointments_in_consultation_day
  ON appointments (clinic_id, start_at)
  WHERE status = 'in_consultation' AND deleted_at IS NULL;

-- Атомарный счётчик номеров: INSERT ... ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING.
-- Номера за день не переиспользуются: отмена записи счётчик не уменьшает.
CREATE TABLE IF NOT EXISTS queue_counters (
  clinic_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL REFERENCES doctors(id),
  queue_date DATE NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (doctor_id, queue_date)
);

-- ТВ-экраны клиники. Сам код экрана не хранится — только sha256 (hex); код показывается один раз.
-- doctor_ids NULL — все врачи, у кого сегодня есть очередь; удаление экрана — revoked_at.
CREATE TABLE IF NOT EXISTS queue_displays (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE,
  doctor_ids BIGINT[] NULL,
  show_names BOOLEAN NOT NULL DEFAULT TRUE,
  language TEXT NOT NULL DEFAULT 'uz_ru' CHECK (language IN ('uz', 'ru', 'uz_ru')),
  voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_displays_clinic
  ON queue_displays (clinic_id) WHERE revoked_at IS NULL;
```

Why `idx_appointments_in_consultation_day`: a read-only check of production on 2026-10-01 found only `appointments_pkey`, `idx_appointments_clinic_id`, `idx_appointments_created_by_doctor_id`, `idx_call_recommended_return` and `idx_call_workspace_appointments` on `appointments` (the `idx_appointments_doctor_start` of migration 006 is missing there). Task 4's `listDayRows` has a second OR branch, `status = 'in_consultation' AND start_at` inside the day, and it runs on every TV poll (2 s) and staff poll (5 s). No production index fits that branch, so without this partial index the branch reads far more of the clinic's rows than it returns. Informative only (no test asserts a plan, and PGlite statistics differ from production): PGlite 0.5.8 (PostgreSQL 18.3), 73 000 synthetic appointments, `ANALYZE`, the production indexes above, and the exact `listDayRows` SQL with the parameters `(1, '2026-09-30', '2026-09-30 00:00:00', '2026-10-01 00:00:00', NULL)`. `EXPLAIN` then chose:

```text
Bitmap Heap Scan on appointments a  (cost=9.38..288.73 rows=81 width=109)
  Recheck Cond: (((clinic_id = '1'::bigint) AND (queue_date = '2026-09-30'::date) AND (queue_number IS NOT NULL) AND (deleted_at IS NULL)) OR ((clinic_id = '1'::bigint) AND (start_at >= '2026-09-30 00:00:00+00'::timestamp with time zone) AND (start_at < '2026-10-01 00:00:00+00'::timestamp with time zone) AND (status = 'in_consultation'::text) AND (deleted_at IS NULL)))
  Filter: (status <> 'cancelled'::text)
  ->  BitmapOr  (cost=9.38..9.38 rows=90 width=0)
        ->  Bitmap Index Scan on idx_appointments_queue_day  (cost=0.00..5.19 rows=90 width=0)
              Index Cond: ((clinic_id = '1'::bigint) AND (queue_date = '2026-09-30'::date))
        ->  Bitmap Index Scan on idx_appointments_in_consultation_day  (cost=0.00..4.15 rows=1 width=0)
              Index Cond: ((clinic_id = '1'::bigint) AND (start_at >= '2026-09-30 00:00:00+00'::timestamp with time zone) AND (start_at < '2026-10-01 00:00:00+00'::timestamp with time zone))
```

The same plan came back with `enable_seqscan = off`. After `DROP INDEX idx_appointments_in_consultation_day`, the second branch fell back to a PostgreSQL 18 skip scan of `idx_call_workspace_appointments (clinic_id, patient_id, status, start_at DESC)`, costed at 1647.69 instead of 4.15 (whole query 2080 instead of 437).

- [ ] **Step 12: Run the test to see the remaining failure**

Run: `cd services/api && npx vitest run src/repositories/postgres/migration035.test.ts`
Expected: FAIL — `Tests 1 failed | 6 passed (7)`; the failing test is `rejects a second appointment with the same doctor, day and number`: expected `{ error: "Номер очереди уже занят, повторите действие" }`, received `{ error: "Duplicate value violates unique constraint: Key (doctor_id, queue_date, queue_number)=(10, 2026-09-30, 1) already exists." }`.

- [ ] **Step 13: Map the queue ticket constraint in the error handler**

In `services/api/src/middleware/errorHandler.ts` replace:

```ts
  if (err.constraint === "uq_invoices_active_appointment") {
    return new ApiError(409, "An active invoice for this appointment already exists");
  }
```

with:

```ts
  if (err.constraint === "uq_invoices_active_appointment") {
    return new ApiError(409, "An active invoice for this appointment already exists");
  }
  if (err.constraint === "ux_appointments_queue_ticket") {
    return new ApiError(409, "Номер очереди уже занят, повторите действие");
  }
```

- [ ] **Step 14: Run the tests to verify everything passes**

Run: `cd services/api && npx vitest run src/services/queue src/repositories/postgres/migration035.test.ts`
Expected: PASS — `Test Files 3 passed (3)`, `Tests 98 passed (98)`.

Run: `cd services/api && npm test`
Expected: PASS — `Test Files 10 passed (10)`, `Tests 205 passed (205)`: the 7 existing files (107 tests) plus the 3 new ones (see the JWT_SECRET note above if the two older suites fail to load).

Run: `cd services/api && npm run typecheck`
Expected: PASS — `tsc --noEmit` prints nothing and exits 0 (test files are type-checked too: `tsconfig.json` includes all of `src`).

- [ ] **Step 15: Commit**

```bash
git add services/api/migrations/035_electronic_queue.sql services/api/src/repositories/interfaces/queueTypes.ts services/api/src/services/queue/queueRules.ts services/api/src/services/queue/queueRules.test.ts services/api/src/services/queue/displayCode.ts services/api/src/services/queue/displayCode.test.ts services/api/src/repositories/postgres/migration035.test.ts services/api/src/middleware/errorHandler.ts && git commit -m "feat(queue): add migration 035, queue types and pure queue helpers"
```

---

---

### Task 2: Doctor room and queue letter (API)

**Files:**
- Modify: `services/api/src/validators/doctorsValidators.ts` (lines 40–56 `normalizeDoctorPayload`, 120–131 `validateCreateDoctor`, 138–200 `validateUpdateDoctor`)
- Modify: `services/api/src/repositories/interfaces/coreTypes.ts` (lines 58–68, type `Doctor`)
- Modify: `services/api/src/repositories/mockDatabase.ts` (lines 31–40, type `DoctorRecord`)
- Modify: `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` (lines 11–46 row type + `mapRow`, 93–120 `findAll`, 136–147 `findById`, 168–183 `create`, 205–293 `update`)
- Modify: `services/api/src/controllers/doctorsController.ts` (lines 19–53)
- Test: `services/api/src/validators/doctorsValidators.test.ts`
- Test: `services/api/src/repositories/postgres/PostgresDoctorsRepository.test.ts`
- No change needed (verified): `services/api/src/routes/doctorsRoutes.ts` (POST already runs `validateCreateDoctor`, PUT `validateUpdateDoctor`), `services/api/src/services/doctorsService.ts` (passes the payload through), `services/api/src/repositories/doctorsRepository.ts` (mock spreads the payload, so optional fields on `DoctorRecord` are enough).

**Interfaces:**
- Consumes: Task 1 migration 035 columns `doctors.room TEXT NULL` (CHECK `char_length(btrim(room)) BETWEEN 1 AND 20`) and `doctors.queue_prefix TEXT NULL` (CHECK `char_length(queue_prefix) = 1`). CHECK violations (23514) are not mapped by `errorHandler` and would be 500s, so the validator must reject bad values with 400 first.
- Produces:
  - `Doctor.room?: string | null; Doctor.queuePrefix?: string | null;` in `coreTypes.ts` (`DoctorCreateInput`/`DoctorUpdateInput` inherit them); `DoctorRecord.room?`, `DoctorRecord.queuePrefix?` in `mockDatabase.ts`.
  - HTTP: `POST /api/doctors` and `PUT /api/doctors/:id` accept `room` and `queuePrefix` (alias `queue_prefix`); `GET /api/doctors` and `GET /api/doctors/:id` return `room` and `queuePrefix` (`null` when unset) in postgres mode. The stored letter is upper-cased by the validator (`"к"` → `"К"`).
  - 400 messages: `"Field 'room' must be a string up to 20 characters"`, `"Field 'queuePrefix' must be a single letter"`. A PUT carrying only `room` or only `queuePrefix` is a valid update.

- [ ] **Step 1: Write the failing validator test**

Create `services/api/src/validators/doctorsValidators.test.ts`. It calls the Express middleware directly with a fake `req` and a `vi.fn()` `next`. Gotchas: the existing create validator already rejects a body without `phone`/`birth_date` keys (its parsers return `undefined` for "missing"), so the base body carries both as `null`; `it.each` spreads array items into arguments, so array-valued cases are wrapped in another array.

```ts
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
vi.mock("../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-doctor-validator-tests-only" } }));
import { validateCreateDoctor, validateUpdateDoctor } from "./doctorsValidators";
import { ApiError } from "../middleware/errorHandler";

type Validator = (req: Request, res: Response, next: NextFunction) => void;
const ROOM_ERROR = "Field 'room' must be a string up to 20 characters";
const PREFIX_ERROR = "Field 'queuePrefix' must be a single letter";
// The create validator already requires phone and birth_date keys (null is fine) — keep them in every create body.
const baseDoctor = { name: "Др. Алиева", speciality: "Терапевт", percent: 10, active: true, phone: null, birth_date: null };

/** Runs a validator like Express would: returns the (mutated) body or the thrown error. */
const run = (validator: Validator, body: Record<string, unknown>) => {
  const req = { body, params: {} } as unknown as Request;
  const next = vi.fn();
  try {
    validator(req, {} as Response, next as unknown as NextFunction);
  } catch (error) {
    expect(next).not.toHaveBeenCalled();
    return { error: error as ApiError, body: req.body as Record<string, unknown> };
  }
  expect(next).toHaveBeenCalledTimes(1);
  return { error: null, body: req.body as Record<string, unknown> };
};

describe("validateCreateDoctor room and queue letter", () => {
  it("trims the room and upper-cases the letter", () => {
    const { error, body } = run(validateCreateDoctor, { ...baseDoctor, room: " 12 ", queuePrefix: " к " });
    expect(error).toBeNull();
    expect(body).toMatchObject({ room: "12", queuePrefix: "К" });
  });

  it("accepts the snake_case alias queue_prefix", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, queue_prefix: "b" }).body.queuePrefix).toBe("B");
  });

  it("stores empty strings and null as null", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "   ", queuePrefix: "" }).body).toMatchObject({ room: null, queuePrefix: null });
    expect(run(validateCreateDoctor, { ...baseDoctor, room: null, queuePrefix: null }).body).toMatchObject({ room: null, queuePrefix: null });
  });

  it("leaves both fields out when they are not sent", () => {
    const { error, body } = run(validateCreateDoctor, { ...baseDoctor });
    expect(error).toBeNull();
    expect(body.room).toBeUndefined();
    expect(body.queuePrefix).toBeUndefined();
  });

  it("counts room length in characters, up to 20", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "Кабинет УЗИ, 2 этаж!" }).body.room).toBe("Кабинет УЗИ, 2 этаж!"); // 20 chars
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "𝟙".repeat(20) }).error).toBeNull(); // 20 code points, 40 UTF-16 units
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "x".repeat(21) }).error).toMatchObject({ status: 400, message: ROOM_ERROR });
  });

  // Each case is wrapped in an array: it.each spreads array items into arguments.
  it.each([[12], [true], [["5"]], [{ room: "5" }]])("rejects a non-string room %j", (room: unknown) => {
    const { error } = run(validateCreateDoctor, { ...baseDoctor, room });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: ROOM_ERROR });
  });

  it.each(["AB", "1", "-", "К1", 5, true])("rejects queue letter %j", (queuePrefix) => {
    const { error } = run(validateCreateDoctor, { ...baseDoctor, queuePrefix });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: PREFIX_ERROR });
  });

  it.each([["a", "A"], ["ў", "Ў"], ["Ғ", "Ғ"], ["ß", "ß"]])("accepts letter %j as %j", (queuePrefix, stored) => {
    // "ß".toUpperCase() is "SS" (two letters): the validator keeps the original so the DB CHECK (one character) still holds.
    expect(run(validateCreateDoctor, { ...baseDoctor, queuePrefix }).body.queuePrefix).toBe(stored);
  });
});

describe("validateUpdateDoctor room and queue letter", () => {
  it("accepts an update that only changes the room", () => {
    const { error, body } = run(validateUpdateDoctor, { room: " 7 " });
    expect(error).toBeNull();
    expect(body).toEqual({ room: "7" });
  });

  it("accepts an update that only clears the queue letter", () => {
    const { error, body } = run(validateUpdateDoctor, { queuePrefix: null });
    expect(error).toBeNull();
    expect(body).toEqual({ queuePrefix: null });
  });

  it("accepts the queue_prefix alias as the only field", () => {
    expect(run(validateUpdateDoctor, { queue_prefix: "т" }).body.queuePrefix).toBe("Т");
  });

  it("clears a blank room", () => {
    expect(run(validateUpdateDoctor, { room: "  " }).body.room).toBeNull();
  });

  it("rejects invalid values with 400", () => {
    expect(run(validateUpdateDoctor, { room: "x".repeat(21) }).error).toMatchObject({ status: 400, message: ROOM_ERROR });
    expect(run(validateUpdateDoctor, { queuePrefix: "12" }).error).toMatchObject({ status: 400, message: PREFIX_ERROR });
  });

  it("still requires at least one field", () => {
    expect(run(validateUpdateDoctor, {}).error).toMatchObject({ status: 400, message: "At least one field must be provided for update" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/validators/doctorsValidators.test.ts`
Expected: FAIL — `Tests 21 failed | 4 passed (25)`; e.g. `trims the room and upper-cases the letter` → `expected { name: 'Др. Алиева', …(7) } to match object { room: '12', queuePrefix: 'К' }`, and `accepts an update that only changes the room` → `expected Error: At least one field must be provided… to be null`.

- [ ] **Step 3: Implement the validation**

Edit 1 — alias and the two parsers (new code goes right after `normalizeDoctorPayload`). `[...s].length` counts code points like Postgres `char_length`. `"ß".toUpperCase()` is `"SS"`, which would break the one-character CHECK, so the parser keeps the original letter when upper-casing expands it.

In `services/api/src/validators/doctorsValidators.ts` replace:

```ts
  if (body.birthDate != null && body.birth_date == null) {
    body.birth_date = body.birthDate;
  }
};
```

with:

```ts
  if (body.birthDate != null && body.birth_date == null) {
    body.birth_date = body.birthDate;
  }
  // `!== undefined` (not `!= null`) so that `queue_prefix: null` can clear the letter too.
  if (body.queue_prefix !== undefined && body.queuePrefix === undefined) {
    body.queuePrefix = body.queue_prefix;
  }
};

const ROOM_ERROR = "Field 'room' must be a string up to 20 characters";
const QUEUE_PREFIX_ERROR = "Field 'queuePrefix' must be a single letter";

/** undefined → not sent; null / blank → null; otherwise the trimmed room, at most 20 characters (code points, like char_length). */
const parseOptionalRoom = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, ROOM_ERROR);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if ([...trimmed].length > 20) throw new ApiError(400, ROOM_ERROR);
  return trimmed;
};

/** undefined → not sent; null / blank → null; otherwise exactly one letter, upper-cased. */
const parseOptionalQueuePrefix = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, QUEUE_PREFIX_ERROR);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\p{L}$/u.test(trimmed)) throw new ApiError(400, QUEUE_PREFIX_ERROR);
  const upper = trimmed.toUpperCase();
  // A few letters upper-case to two ("ß" → "SS"); keep the original so the DB CHECK (one character) holds.
  return [...upper].length === 1 ? upper : trimmed;
};
```

Edit 2 — `validateCreateDoctor` (absent fields stay absent; the controller turns them into `null`):

In `services/api/src/validators/doctorsValidators.ts` replace:

```ts
  const normalizedBirthDate = parseOptionalBirthDate(birth_date);
  if (normalizedBirthDate === undefined) {
    throw new ApiError(400, "Field 'birth_date' must be YYYY-MM-DD, null or empty");
  }
  body.birth_date = normalizedBirthDate;

  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  next();
};
```

with:

```ts
  const normalizedBirthDate = parseOptionalBirthDate(birth_date);
  if (normalizedBirthDate === undefined) {
    throw new ApiError(400, "Field 'birth_date' must be YYYY-MM-DD, null or empty");
  }
  body.birth_date = normalizedBirthDate;

  const normalizedRoom = parseOptionalRoom(body.room);
  if (normalizedRoom !== undefined) body.room = normalizedRoom;
  const normalizedQueuePrefix = parseOptionalQueuePrefix(body.queuePrefix);
  if (normalizedQueuePrefix !== undefined) body.queuePrefix = normalizedQueuePrefix;

  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  next();
};
```

Edit 3 — `validateUpdateDoctor` destructuring:

In `services/api/src/validators/doctorsValidators.ts` replace:

```ts
  const { name, fullName, speciality, specialty, percent, active, serviceIds, phone, birth_date } =
    body;
```

with:

```ts
  const { name, fullName, speciality, specialty, percent, active, serviceIds, phone, birth_date, room, queuePrefix } =
    body;
```

Edit 4 — `validateUpdateDoctor` parsing (this anchor is unique because it ends at `const hasAnyField =`):

In `services/api/src/validators/doctorsValidators.ts` replace:

```ts
  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  const hasAnyField =
```

with:

```ts
  if (room !== undefined) {
    body.room = parseOptionalRoom(room);
  }

  if (queuePrefix !== undefined) {
    body.queuePrefix = parseOptionalQueuePrefix(queuePrefix);
  }

  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  const hasAnyField =
```

Edit 5 — the `hasAnyField` whitelist (without it a PUT with only `room` is a 400):

In `services/api/src/validators/doctorsValidators.ts` replace:

```ts
    phone !== undefined ||
    birth_date !== undefined;
```

with:

```ts
    phone !== undefined ||
    birth_date !== undefined ||
    room !== undefined ||
    queuePrefix !== undefined;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/validators/doctorsValidators.test.ts`
Expected: PASS — `Tests 25 passed (25)`.

- [ ] **Step 5: Write the failing repository + HTTP round-trip test (PGlite)**

Create `services/api/src/repositories/postgres/PostgresDoctorsRepository.test.ts`. Gotchas: `PostgresDoctorsRepository` uses the global `dbPool` and opens `dbPool.connect()` transactions, so the `config/database` mock needs BOTH `query` and `connect`, delegating to the serialized PGlite pool (inside the transaction the repository only uses its `client`, so the gate cannot deadlock). The `doctors` stub uses `id bigserial` (not the contract's `id bigint primary key`) because the repository INSERT does not pass an id. `findAll`/`loadServiceIds` join `doctor_services` and `services(active, deleted_at, clinic_id)`, so those stubs exist too. The HTTP block goes through `doctorsRouter` → validator → controller → service → repository, which is the only way to prove the controller whitelist forwards the two fields (it silently drops unknown keys).

```ts
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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/repositories/postgres/PostgresDoctorsRepository.test.ts`
Expected: FAIL — `Tests 5 failed (5)`, each like `AssertionError: expected { id: 1, name: 'Др. Алиева', …(7) } to match object { room: '12', queuePrefix: 'К' }` (the repository neither writes nor selects the new columns yet).

- [ ] **Step 7: Add the fields to the domain types**

In `services/api/src/repositories/interfaces/coreTypes.ts` replace:

```ts
  active: boolean;
  serviceIds: number[];
  createdAt: string;
};
```

with:

```ts
  active: boolean;
  serviceIds: number[];
  createdAt: string;
  /** Кабинет (до 20 символов): ТВ-экран очереди и талон. */
  room?: string | null;
  /** Буква очереди врача, одна заглавная буква («К» → талон «К-05»). */
  queuePrefix?: string | null;
};
```

In `services/api/src/repositories/mockDatabase.ts` replace:

```ts
  birth_date?: string | null;
  active: boolean;
  createdAt: string;
};
```

with:

```ts
  birth_date?: string | null;
  active: boolean;
  createdAt: string;
  room?: string | null;
  queuePrefix?: string | null;
};
```

- [ ] **Step 8: Select and write the columns in `PostgresDoctorsRepository`**

The column list is written out by hand in several places; every one gets `room, queue_prefix`. Apply these edits in order (each OLD snippet is unique at the time it is applied).

Edit 1 — row type:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
  active: boolean;
  created_at: Date | string;
};
```

with:

```ts
  active: boolean;
  created_at: Date | string;
  room: string | null;
  queue_prefix: string | null;
};
```

Edit 2 — `mapRow`:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
  active: row.active !== false,
  serviceIds,
  createdAt: toIso(row.created_at),
});
```

with:

```ts
  active: row.active !== false,
  serviceIds,
  createdAt: toIso(row.created_at),
  room: row.room ?? null,
  queuePrefix: row.queue_prefix ?? null,
});
```

Edit 3 — `findAll` SELECT list:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
          d.active,
          d.created_at,
          COALESCE(
```

with:

```ts
          d.active,
          d.created_at,
          d.room,
          d.queue_prefix,
          COALESCE(
```

Edit 4 — `findAll` GROUP BY (Postgres rejects the query if a selected column is missing here):

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
          d.active,
          d.created_at
        ORDER BY d.full_name ASC
```

with:

```ts
          d.active,
          d.created_at,
          d.room,
          d.queue_prefix
        ORDER BY d.full_name ASC
```

Edit 5 — `findById`:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
          active,
          created_at
        FROM doctors
        WHERE id = $1 AND clinic_id = $2
        LIMIT 1
```

with:

```ts
          active,
          created_at,
          room,
          queue_prefix
        FROM doctors
        WHERE id = $1 AND clinic_id = $2
        LIMIT 1
```

Edit 6 — `create` INSERT, RETURNING and parameters:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
          INSERT INTO doctors (clinic_id, full_name, specialty, percent, phone, birth_date, active)
          VALUES ($1, $2, $3, $4, $5, $6::date, $7)
          RETURNING
            id,
            full_name,
            specialty,
            percent,
            phone,
            birth_date,
            active,
            created_at
        `,
        [clinicId, fullName, spec, data.percent, data.phone ?? null, data.birth_date ?? null, data.active]
```

with:

```ts
          INSERT INTO doctors (clinic_id, full_name, specialty, percent, phone, birth_date, active, room, queue_prefix)
          VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
          RETURNING
            id,
            full_name,
            specialty,
            percent,
            phone,
            birth_date,
            active,
            created_at,
            room,
            queue_prefix
        `,
        [
          clinicId,
          fullName,
          spec,
          data.percent,
          data.phone ?? null,
          data.birth_date ?? null,
          data.active,
          data.room ?? null,
          data.queuePrefix ?? null,
        ]
```

Edit 7 — `update` locking pre-select:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
          SELECT id, full_name, specialty, percent, phone, birth_date, active, created_at
          FROM doctors
          WHERE id = $1 AND clinic_id = $2
          FOR UPDATE
```

with:

```ts
          SELECT id, full_name, specialty, percent, phone, birth_date, active, created_at, room, queue_prefix
          FROM doctors
          WHERE id = $1 AND clinic_id = $2
          FOR UPDATE
```

Edit 8 — `update` SET branches (`undefined` = not sent, `null` = clear):

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
      if (data.active !== undefined) {
        values.push(data.active);
        setClauses.push(`active = $${values.length}`);
      }
```

with:

```ts
      if (data.active !== undefined) {
        values.push(data.active);
        setClauses.push(`active = $${values.length}`);
      }

      if (data.room !== undefined) {
        values.push(data.room);
        setClauses.push(`room = $${values.length}`);
      }

      if (data.queuePrefix !== undefined) {
        values.push(data.queuePrefix);
        setClauses.push(`queue_prefix = $${values.length}`);
      }
```

Edit 9 — `update` RETURNING:

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
              active,
              created_at
          `,
          values
```

with:

```ts
              active,
              created_at,
              room,
              queue_prefix
          `,
          values
```

Edit 10 — `update` final re-select (this is the row that is returned):

In `services/api/src/repositories/postgres/PostgresDoctorsRepository.ts` replace:

```ts
      const finalRow = await client.query<DoctorDbRow>(
        `
          SELECT id, full_name, specialty, percent, phone, birth_date, active, created_at
```

with:

```ts
      const finalRow = await client.query<DoctorDbRow>(
        `
          SELECT id, full_name, specialty, percent, phone, birth_date, active, created_at, room, queue_prefix
```

- [ ] **Step 9: Forward the fields in the controller**

Edit 1 — create destructuring (the same two-line destructuring also exists in the update controller; this anchor is unique because it ends with `const created`):

In `services/api/src/controllers/doctorsController.ts` replace:

```ts
  const { fullName, specialty, percent, phone, birth_date, active, serviceIds, name, speciality } =
    req.body ?? {};
  const created = await services.doctors.create(auth, {
```

with:

```ts
  const {
    fullName,
    specialty,
    percent,
    phone,
    birth_date,
    active,
    serviceIds,
    name,
    speciality,
    room,
    queuePrefix,
  } = req.body ?? {};
  const created = await services.doctors.create(auth, {
```

Edit 2 — create payload:

In `services/api/src/controllers/doctorsController.ts` replace:

```ts
    active: Boolean(active),
    serviceIds: Array.isArray(serviceIds) ? serviceIds : [],
  });
```

with:

```ts
    active: Boolean(active),
    serviceIds: Array.isArray(serviceIds) ? serviceIds : [],
    room: (room ?? null) as string | null,
    queuePrefix: (queuePrefix ?? null) as string | null,
  });
```

Edit 3 — update destructuring:

In `services/api/src/controllers/doctorsController.ts` replace:

```ts
  const { fullName, specialty, percent, phone, birth_date, active, serviceIds, name, speciality } =
    req.body ?? {};
  const payload = {
```

with:

```ts
  const {
    fullName,
    specialty,
    percent,
    phone,
    birth_date,
    active,
    serviceIds,
    name,
    speciality,
    room,
    queuePrefix,
  } = req.body ?? {};
  const payload = {
```

Edit 4 — update payload (conditional spreads, so a PUT without the keys leaves the columns untouched):

In `services/api/src/controllers/doctorsController.ts` replace:

```ts
    ...(active !== undefined ? { active: Boolean(active) } : {}),
    ...(serviceIds !== undefined && Array.isArray(serviceIds) ? { serviceIds } : {}),
  };
```

with:

```ts
    ...(active !== undefined ? { active: Boolean(active) } : {}),
    ...(serviceIds !== undefined && Array.isArray(serviceIds) ? { serviceIds } : {}),
    ...(room !== undefined ? { room: (room ?? null) as string | null } : {}),
    ...(queuePrefix !== undefined ? { queuePrefix: (queuePrefix ?? null) as string | null } : {}),
  };
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd services/api && npx vitest run src/validators/doctorsValidators.test.ts src/repositories/postgres/PostgresDoctorsRepository.test.ts`
Expected: PASS — `Test Files 2 passed (2)`, `Tests 30 passed (30)`.

Run: `cd services/api && npm test`
Expected: PASS — `Test Files 12 passed (12)`, `Tests 235 passed (235)` (JWT_SECRET note from Task 1 applies).

Run: `cd services/api && npm run typecheck`
Expected: PASS — no output, exit 0.

- [ ] **Step 11: Commit**

```bash
git add services/api/src/repositories/interfaces/coreTypes.ts services/api/src/repositories/mockDatabase.ts services/api/src/repositories/postgres/PostgresDoctorsRepository.ts services/api/src/repositories/postgres/PostgresDoctorsRepository.test.ts services/api/src/validators/doctorsValidators.ts services/api/src/validators/doctorsValidators.test.ts services/api/src/controllers/doctorsController.ts && git commit -m "feat(doctors): add room and queue letter to the doctors API"
```

---

### Task 3: Queue numbers on arrival (appointments integration, API)

Goal: when a visit of today goes to `arrived` (PUT `/api/appointments/:id`, or created as `arrived`), it gets the next number of its doctor's per-day counter in the same DB transaction. The number is idempotent on repeat. A doctor change on an arrived visit of today takes a new number from the new doctor's counter. Moving a numbered visit to another day clears the queue fields. `no_show → arrived` is allowed only for a visit of today; it takes a NEW number at the end of the queue and skips the slot-conflict checks. Clients can never write queue fields.

Read before you start:
- **CRLF.** The working tree is CRLF (`core.autocrlf=true`, index is LF). The Edit tool matches the snippets below as written. If you script edits instead, match `\r\n`.
- **"Today".** The service decides "today" with `clinicToday(timeZone, now())` (Task 1). The repository only receives `day`. `Appointment.startAt` is clinic wall-clock time `"YYYY-MM-DD HH:mm:ss"`, so "visit is on day D" means `startAt.slice(0, 10) === D`.
- **Past dates.** `ensureStartAtNotInPast` uses the REAL clock (`Date.now()`), not the injected one. Tests therefore insert today's visits straight into the DB or mock DB. Reschedule tests move visits to 2099.
- **Gated pool.** The new PGlite test routes BOTH `dbPool.query` and `dbPool.connect` through a one-connection gate. Any `dbPool.query` issued while a transaction client is checked out waits forever, and vitest times out after 5 s. Inside the new transactions, use only `client`. `syncPrimaryAppointmentServiceRow` and `withServices` use the pool, so they must run after `release()`.

**Files:**
- Create: `services/api/src/repositories/postgres/queueAllocation.ts`
- Create (test): `services/api/src/repositories/postgres/appointmentsQueue.test.ts`
- Modify: `services/api/src/repositories/interfaces/coreTypes.ts` (`Appointment`, ~lines 103–127)
- Modify: `services/api/src/repositories/interfaces/IAppointmentsRepository.ts` (lines 1–16)
- Modify: `services/api/src/repositories/postgres/PostgresAppointmentsRepository.ts`: imports 1–22, `AppointmentRow` 24–46, `mapAppointmentRow` 99–123, after `withServices` 178–179, `SELECT_LIST` 181–203, `create` 416–495, `update` 508–608
- Modify: `services/api/src/repositories/appointmentsRepository.ts` (Mock; line 1, line 28, `create` 77–102, `update` 158–162)
- Modify: `services/api/src/repositories/mockDatabase.ts` (`AppointmentRecord`, lines 57–79)
- Modify: `services/api/src/services/appointmentsService.ts` (import 37, transitions 65–73, constructor 350–351, `create` 413/488, `update` 509/601–629)
- Modify: `services/api/src/container/services.ts` (line 30)
- Test: `services/api/src/repositories/postgres/PostgresAppointmentsRepository.test.ts` (DDL 14–27, new test before line 41)
- Test: `services/api/src/services/appointmentsService.test.ts` (new `describe` before line 202)

**Interfaces:**
- Consumes (Task 1):
  - `services/api/migrations/035_electronic_queue.sql`
  - `QueueDirective` from `services/api/src/repositories/interfaces/queueTypes.ts`
  - `clinicToday(timeZone: string, now: Date): string`, `planQueueChange(current: QueueSnapshot | null, next: QueueTargetState, today: string): QueueDirective` and `formatQueueCode(prefix: string | null | undefined, queueNumber: number): string`, all from `services/api/src/services/queue/queueRules.ts`
- Consumes (Task 2): `DoctorRecord.queuePrefix?: string | null` in `services/api/src/repositories/mockDatabase.ts`.
- Produces:
  - `allocateQueueNumber(client: QueryClient, clinicId: number, doctorId: number, day: string): Promise<{ queueNumber: number; queuePrefix: string | null }>` (`repositories/postgres/queueAllocation.ts`). Task 4 reuses it inside its own `issue` transaction. **Lock order:** lock the `appointments` row (`SELECT … FOR UPDATE`) FIRST, then allocate (the `queue_counters` upsert), exactly as `takeQueueTicket` below does. The same order everywhere means no deadlocks.
  - `export type AppointmentWriteOptions = { queue?: QueueDirective; skipConflictCheck?: boolean }` in `IAppointmentsRepository.ts`. Signatures: `create(data, options?)` and `update(id, data, options?)`.
  - `Appointment` optional fields: `queueNumber?: number | null; queueCode?: string | null; queueDate?: string | null; queueIssuedAt?: string | null; queueCalledAt?: string | null; queueCallCount?: number`. Every `SELECT_LIST` read returns them: list, get, update, cancel, price and billing.
  - `new AppointmentsService(repo, timeZone = "Asia/Tashkent", now = () => new Date())`. The container passes `env.reportsTimezone`.
  - Transition `no_show → arrived`, today only. Otherwise it fails with 400 `"Вернуть в очередь можно только запись на сегодня"`.
  - `AppointmentRecord` (mock) optional fields `queueNumber`, `queuePrefix`, `queueCode`, `queueDate`, `queueIssuedAt`, `queueCalledAt`, `queueCallCount`.

#### Cycle A: appointments expose the queue columns (read path)

- [ ] **Step 1: Write the failing test.** `SELECT_LIST` will read the new columns, so this PGlite test must first run migration 035. 035 alters `doctors`, so the test also needs a `doctors` stand-in.

In `services/api/src/repositories/postgres/PostgresAppointmentsRepository.test.ts` replace:
```ts
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric, created_by bigint);
    INSERT INTO clinics VALUES(1),(2); INSERT INTO patients VALUES(1); INSERT INTO services VALUES(3,1,'Приём',100000);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
}, 30000);
```
with:
```ts
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric, created_by bigint);
    CREATE TABLE doctors(id bigint primary key, clinic_id bigint);
    INSERT INTO clinics VALUES(1),(2); INSERT INTO patients VALUES(1); INSERT INTO services VALUES(3,1,'Приём',100000);
    INSERT INTO doctors VALUES(2,1);`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  // SELECT_LIST reads the electronic-queue columns; 035 alters doctors and appointments (both created above).
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
}, 30000);
```
In the same file replace:
```ts
  it("does not update a return date in another clinic", async () => {
```
with:
```ts
  it("maps queue columns and derives the ticket code from the letter snapshot", async () => {
    const rows = await db.query<{ id: number }>(
      `INSERT INTO appointments(clinic_id,patient_id,doctor_id,service_id,start_at,end_at,status,queue_number,queue_prefix,queue_date,queue_issued_at,queue_call_count)
       VALUES(1,1,2,3,'2099-11-02 10:00:00+00','2099-11-02 10:30:00+00','arrived',5,'К','2099-11-02','2099-11-02 05:01:02+00',2),
             (1,1,2,3,'2099-11-02 11:00:00+00','2099-11-02 11:30:00+00','scheduled',NULL,NULL,NULL,NULL,0) RETURNING id`
    );
    const [numbered, plain] = await runWithClinicContext(1, () =>
      Promise.all(rows.rows.map((row) => repo.findById(Number(row.id))))
    );
    expect(numbered).toMatchObject({
      queueNumber: 5,
      queueCode: "К-05",
      queueDate: "2099-11-02",
      queueIssuedAt: "2099-11-02T05:01:02.000Z",
      queueCalledAt: null,
      queueCallCount: 2,
    });
    expect(plain).toMatchObject({ queueNumber: null, queueCode: null, queueDate: null, queueIssuedAt: null, queueCallCount: 0 });
  });
  it("does not update a return date in another clinic", async () => {
```

- [ ] **Step 2: Run the test to verify it fails.**
Run: `cd services/api && npx vitest run src/repositories/postgres/PostgresAppointmentsRepository.test.ts`
Expected: FAIL, 1 failed / 7 passed. The failure is `AssertionError: expected { id: 2, patientId: 1, …(20) } to match object { queueNumber: 5, …(5) }`, because `SELECT_LIST` does not read the queue columns yet.
This file does not mock `config/env`: `errorHandler` imports it, and it needs `JWT_SECRET` from `services/api/.env`. If that file is missing on this PC, prefix the command with `JWT_SECRET=local-tests-only ` (same value as the Task 1 note).

- [ ] **Step 3: Implement.**

In `services/api/src/repositories/interfaces/coreTypes.ts` replace:
```ts
  createdAt: string;
  updatedAt: string;
  services?: AppointmentServiceAssignedSummary[];
};
```
with:
```ts
  createdAt: string;
  updatedAt: string;
  services?: AppointmentServiceAssignedSummary[];
  /** Electronic queue ticket (null = no number). Written only by the queue rules, never from a request body. */
  queueNumber?: number | null;
  /** formatQueueCode(letter snapshot, number), e.g. "К-05". */
  queueCode?: string | null;
  /** Clinic calendar day of the ticket, "YYYY-MM-DD". */
  queueDate?: string | null;
  /** ISO instants. */
  queueIssuedAt?: string | null;
  queueCalledAt?: string | null;
  queueCallCount?: number;
};
```
Do NOT add queue fields to `AppointmentCreateInput` or `AppointmentUpdateInput`: clients must never be able to write them.

In `services/api/src/repositories/postgres/PostgresAppointmentsRepository.ts` replace:
```ts
import { requireClinicId } from "../../tenancy/clinicContext";
```
with:
```ts
import { requireClinicId } from "../../tenancy/clinicContext";
import { formatQueueCode } from "../../services/queue/queueRules";
```
Replace the end of the row type:
```ts
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type AppointmentServiceRow = {
```
with:
```ts
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  queue_number: number | null;
  queue_prefix: string | null;
  queue_date: string | null;
  queue_issued_at: string | Date | null;
  queue_called_at: string | Date | null;
  queue_call_count: number | string | null;
};

type AppointmentServiceRow = {
```
Replace the end of `mapAppointmentRow`:
```ts
  createdAt: toIsoUtc(row.created_at),
  updatedAt: toIsoUtc(row.updated_at),
});
```
with:
```ts
  createdAt: toIsoUtc(row.created_at),
  updatedAt: toIsoUtc(row.updated_at),
  // Queue number of the visit's day; the code uses the letter snapshot taken at issue time.
  queueNumber: row.queue_number == null ? null : Number(row.queue_number),
  queueCode:
    row.queue_number == null ? null : formatQueueCode(row.queue_prefix, Number(row.queue_number)),
  queueDate: row.queue_date ?? null,
  queueIssuedAt: row.queue_issued_at ? toIsoUtc(row.queue_issued_at) : null,
  queueCalledAt: row.queue_called_at ? toIsoUtc(row.queue_called_at) : null,
  queueCallCount: Number(row.queue_call_count ?? 0),
});
```
`queue_issued_at` and `queue_called_at` are real instants, so they go through `toIsoUtc`. `start_at` stays wall-clock.
Replace the end of `SELECT_LIST`:
```ts
  notes,
  created_at,
  updated_at
`;
```
with:
```ts
  notes,
  created_at,
  updated_at,
  queue_number,
  queue_prefix,
  to_char(queue_date, 'YYYY-MM-DD') AS queue_date,
  queue_issued_at,
  queue_called_at,
  queue_call_count
`;
```
`queue_date` is a DATE. node-pg parses DATE as local midnight and PGlite as UTC midnight, so it is selected as `to_char`, like `recommended_return_date`.

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `cd services/api && npx vitest run src/repositories/postgres/PostgresAppointmentsRepository.test.ts`
Expected: PASS (8 passed).
Run: `cd services/api && npm run typecheck`
Expected: exit 0.

#### Cycle B: the service plans queue changes (checked through the Mock repository)

- [ ] **Step 5: Write the failing test.**

In `services/api/src/services/appointmentsService.test.ts` replace:
```ts
describe("invoice snapshot of the visit's services", () => {
```
with:
```ts
describe("electronic queue numbers", () => {
  const reception = { ...operator, role: "reception" as const };
  const today = "2026-09-30";
  // 06:00 UTC is 11:00 in Tashkent: the clinic day is 2026-09-30 whatever the real date is.
  const queueService = new AppointmentsService(repository, "Asia/Tashkent", () => new Date("2026-09-30T06:00:00Z"));
  /** Visits of the fixed day go straight into the mock DB: create() refuses past times by the real clock. */
  const seedVisit = (id: number, startAt: string, endAt: string, doctorId = 2) => {
    getMockDb().appointments.push({
      id, patientId: 1, doctorId, serviceId: 3, price: 100000, startAt, endAt, status: "scheduled", billingStatus: "draft",
      cancelReason: null, cancelledAt: null, cancelledBy: null, diagnosis: null, treatment: null, notes: null, createdAt, updatedAt: createdAt,
    });
  };

  beforeEach(() => {
    getMockDb().doctors[0].queuePrefix = "К";
    getMockDb().doctors.push({ id: 5, name: "Врач без буквы", speciality: "Хирург", percent: 10, active: true, createdAt });
  });

  it("numbers today's arrivals per doctor with the doctor's letter and keeps the number on repeat", async () => {
    seedVisit(501, `${today} 10:00:00`, `${today} 10:30:00`);
    seedVisit(502, `${today} 10:30:00`, `${today} 11:00:00`);
    seedVisit(503, `${today} 10:00:00`, `${today} 10:30:00`, 5);
    expect(await queueService.update(reception, 501, { status: "arrived" })).toMatchObject({ queueNumber: 1, queueCode: "К-01", queueDate: today, queueCallCount: 0 });
    expect(await queueService.update(reception, 502, { status: "arrived" })).toMatchObject({ queueNumber: 2, queueCode: "К-02" });
    expect(await queueService.update(reception, 503, { status: "arrived" })).toMatchObject({ queueNumber: 1, queueCode: "01" });
    expect(await queueService.update(reception, 501, { status: "arrived" })).toMatchObject({ queueNumber: 1, queueCode: "К-01" });
  });

  it("does not number an arrival for another day", async () => {
    const saved = await queueService.create(reception, input);
    const arrived = await queueService.update(reception, saved.id, { status: "arrived" });
    expect(arrived?.status).toBe("arrived");
    expect(arrived?.queueNumber ?? null).toBeNull();
  });

  it("ignores queue fields sent by a client", async () => {
    seedVisit(501, `${today} 10:00:00`, `${today} 10:30:00`);
    const payload = { status: "arrived", queueNumber: 99, queueCode: "Z-99", queueDate: "2020-01-01", queuePrefix: "Z" };
    expect(await queueService.update(reception, 501, payload as never)).toMatchObject({ queueNumber: 1, queueCode: "К-01", queueDate: today });
    await expect(queueService.update(reception, 501, { queueNumber: 5 } as never)).rejects.toMatchObject({ status: 400 });
    expect(getMockDb().appointments.find((row) => row.id === 501)).toMatchObject({ queueNumber: 1 });
  });

  it("returns a no-show to the end of today's queue even when the slot is taken meanwhile", async () => {
    seedVisit(501, `${today} 10:00:00`, `${today} 10:30:00`);
    seedVisit(502, `${today} 10:30:00`, `${today} 11:00:00`);
    await queueService.update(reception, 501, { status: "arrived" });
    await queueService.update(reception, 502, { status: "arrived" });
    await queueService.update(reception, 501, { status: "no_show" });
    seedVisit(504, `${today} 10:00:00`, `${today} 10:30:00`);
    expect(await queueService.update(reception, 501, { status: "arrived" })).toMatchObject({ status: "arrived", queueNumber: 3, queueCode: "К-03" });
  });

  it("refuses to return a no-show of another day to the queue", async () => {
    const saved = await queueService.create(reception, input);
    await queueService.update(reception, saved.id, { status: "no_show" });
    await expect(queueService.update(reception, saved.id, { status: "arrived" })).rejects.toMatchObject({
      status: 400,
      message: "Вернуть в очередь можно только запись на сегодня",
    });
    expect(getMockDb().appointments.find((row) => row.id === saved.id)?.status).toBe("no_show");
  });
});

describe("invoice snapshot of the visit's services", () => {
```
The test sets `getMockDb().doctors[0].queuePrefix = "К"`, which relies on Task 2's optional `DoctorRecord.queuePrefix`. `"К"` is Cyrillic Ka (U+041A), in this test and in every test below.

- [ ] **Step 6: Run the test to verify it fails.**
Run: `cd services/api && npx vitest run src/services/appointmentsService.test.ts`
Expected: FAIL, `Tests 4 failed | 37 passed (41)`. The failures are `Invalid status transition: 'no_show' -> 'arrived'` and `expected { id: 501, … } to match object { queueNumber: 1, … }`, because the service does not issue numbers yet. The test "does not number an arrival for another day" already passes.

- [ ] **Step 7: Implement (interface, mock, service, container).**

In `services/api/src/repositories/interfaces/IAppointmentsRepository.ts` replace:
```ts
} from "./coreTypes";

export interface IAppointmentsRepository {
```
with:
```ts
} from "./coreTypes";
import type { QueueDirective } from "./queueTypes";

/** Side effects of a write decided by AppointmentsService (see services/queue/queueRules.ts). */
export type AppointmentWriteOptions = {
  /** "issue": next number of the doctor's counter for `day`; "clear": drop the ticket; default "keep". */
  queue?: QueueDirective;
  /** Skip the slot-overlap check: a no-show returning to today's queue keeps its old, possibly taken slot. */
  skipConflictCheck?: boolean;
};

export interface IAppointmentsRepository {
```
Replace:
```ts
  create(data: AppointmentCreateInput): Promise<Appointment>;
  update(id: number, data: AppointmentUpdateInput): Promise<Appointment | null>;
```
with:
```ts
  create(data: AppointmentCreateInput, options?: AppointmentWriteOptions): Promise<Appointment>;
  update(
    id: number,
    data: AppointmentUpdateInput,
    options?: AppointmentWriteOptions
  ): Promise<Appointment | null>;
```
Leave `PostgresAppointmentsRepository` alone in this cycle. TypeScript accepts an implementation with fewer parameters, so it still type-checks. Cycle D adds the options there.

In `services/api/src/repositories/mockDatabase.ts` replace the end of `AppointmentRecord`:
```ts
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentServiceRecord = {
```
with:
```ts
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  queueNumber?: number | null;
  /** Doctor's letter at issue time (mirrors appointments.queue_prefix). */
  queuePrefix?: string | null;
  queueCode?: string | null;
  queueDate?: string | null;
  queueIssuedAt?: string | null;
  queueCalledAt?: string | null;
  queueCallCount?: number;
};

export type AppointmentServiceRecord = {
```

In `services/api/src/repositories/appointmentsRepository.ts` (the Mock) replace:
```ts
import type { IAppointmentsRepository } from "./interfaces/IAppointmentsRepository";
```
with:
```ts
import type {
  AppointmentWriteOptions,
  IAppointmentsRepository,
} from "./interfaces/IAppointmentsRepository";
import type { QueueDirective } from "./interfaces/queueTypes";
import { formatQueueCode } from "../services/queue/queueRules";
```
Replace:
```ts
const toAppointment = (row: AppointmentRecord): Appointment => ({ ...row });
```
with:
```ts
const toAppointment = (row: AppointmentRecord): Appointment => ({ ...row });

/**
 * Mirrors PostgresAppointmentsRepository: "issue" takes 1 + the highest number of the doctor on that day
 * (the row's own old number included, like the Postgres counter) and snapshots the doctor's letter.
 * Call it before `record` replaces the stored row.
 */
const applyQueueDirective = (
  record: AppointmentRecord,
  directive: QueueDirective | undefined
): AppointmentRecord => {
  if (!directive || directive.kind === "keep") return record;
  if (directive.kind === "clear") {
    return {
      ...record,
      queueNumber: null,
      queuePrefix: null,
      queueCode: null,
      queueDate: null,
      queueIssuedAt: null,
      queueCalledAt: null,
      queueCallCount: 0,
    };
  }
  const db = getMockDb();
  const taken = db.appointments
    .filter((row) => row.doctorId === record.doctorId && row.queueDate === directive.day && row.queueNumber != null)
    .map((row) => row.queueNumber as number);
  const queueNumber = Math.max(0, ...taken) + 1;
  const queuePrefix = db.doctors.find((doctor) => doctor.id === record.doctorId)?.queuePrefix ?? null;
  return {
    ...record,
    queueNumber,
    queuePrefix,
    queueCode: formatQueueCode(queuePrefix, queueNumber),
    queueDate: directive.day,
    queueIssuedAt: new Date().toISOString(),
    queueCalledAt: null,
    queueCallCount: 0,
  };
};
```
The Mock numbering counts the row's own old number too. That keeps it equal to the Postgres counter, which never goes back: a returning no-show with number 1 gets 2 when it is the only numbered visit, not 1 again.
Replace:
```ts
  async create(input: AppointmentCreateInput): Promise<Appointment> {
    const now = new Date().toISOString();
    const created: AppointmentRecord = {
```
with:
```ts
  async create(
    input: AppointmentCreateInput,
    options: AppointmentWriteOptions = {}
  ): Promise<Appointment> {
    const now = new Date().toISOString();
    const draft: AppointmentRecord = {
```
Replace:
```ts
      updatedAt: now,
    };
    getMockDb().appointments.push(created);
```
with:
```ts
      updatedAt: now,
    };
    const created = applyQueueDirective(draft, options.queue);
    getMockDb().appointments.push(created);
```
(`created` is still the name used by the rest of `create`, so no other line changes.)
Replace:
```ts
  async update(id: number, input: AppointmentUpdateInput): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    db.appointments[idx] = { ...db.appointments[idx], ...input, updatedAt: new Date().toISOString() };
```
with:
```ts
  async update(
    id: number,
    input: AppointmentUpdateInput,
    options: AppointmentWriteOptions = {}
  ): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    db.appointments[idx] = applyQueueDirective(
      { ...db.appointments[idx], ...input, updatedAt: new Date().toISOString() },
      options.queue
    );
```
`applyQueueDirective` scans `db.appointments` while it still holds the OLD row. That is why the result is assigned only after the call.

In `services/api/src/services/appointmentsService.ts` replace:
```ts
import { parseNumericInput, roundMoney2 } from "../utils/numbers";
```
with:
```ts
import { parseNumericInput, roundMoney2 } from "../utils/numbers";
import { clinicToday, planQueueChange } from "./queue/queueRules";
```
Replace:
```ts
  cancelled: [],
  no_show: [],
};
```
with:
```ts
  cancelled: [],
  // Return to the queue: allowed only for a visit of today (checked in update).
  no_show: ["arrived"],
};
```
Replace:
```ts
export class AppointmentsService {
  constructor(private readonly appointmentsRepository: IAppointmentsRepository) {}
```
with:
```ts
/** Queue fields are written only by the queue rules, never from a request body. */
const QUEUE_PAYLOAD_KEYS = [
  "queueNumber",
  "queueCode",
  "queueDate",
  "queueIssuedAt",
  "queueCalledAt",
  "queueCallCount",
  "queuePrefix",
] as const;

const stripQueueKeys = (payload: AppointmentCreateInput | AppointmentUpdateInput): void => {
  const record = payload as Record<string, unknown>;
  for (const key of QUEUE_PAYLOAD_KEYS) {
    delete record[key];
  }
};

export class AppointmentsService {
  /**
   * `timeZone` is the clinic calendar (env.reportsTimezone) that decides "today" for queue numbers;
   * `now` is injectable so tests can pin the clinic day.
   */
  constructor(
    private readonly appointmentsRepository: IAppointmentsRepository,
    private readonly timeZone: string = "Asia/Tashkent",
    private readonly now: () => Date = () => new Date()
  ) {}
```
Replace (in `create`):
```ts
    const normalizedPayload = normalizeCreateInput(mergedForNormalize);
```
with:
```ts
    const normalizedPayload = normalizeCreateInput(mergedForNormalize);
    stripQueueKeys(normalizedPayload);
```
Replace (in `create`):
```ts
    const created = await this.appointmentsRepository.create(payloadToCreate);
```
with:
```ts
    // A walk-in created as "arrived" for today gets its queue number in the same transaction.
    const queue = planQueueChange(
      null,
      {
        status: payloadToCreate.status,
        doctorId: payloadToCreate.doctorId,
        startAt: payloadToCreate.startAt,
      },
      clinicToday(this.timeZone, this.now())
    );
    const created = await this.appointmentsRepository.create(payloadToCreate, { queue });
```
Replace (in `update`):
```ts
    const normalizedPayload = normalizeUpdateInput(payload);
```
with:
```ts
    const normalizedPayload = normalizeUpdateInput(payload);
    stripQueueKeys(normalizedPayload);
```
The strip runs before the `Object.keys(normalizedPayload).length === 0` guard. A body that holds only queue keys therefore gets 400 "At least one field must be provided for update".
Replace (in `update`):
```ts
    ensureValidDateRange(mergedStartAt, mergedEndAt);
    ensureStatusTransitionAllowed(current.status, mergedStatus);
```
with:
```ts
    ensureValidDateRange(mergedStartAt, mergedEndAt);
    ensureStatusTransitionAllowed(current.status, mergedStatus);

    const today = clinicToday(this.timeZone, this.now());
    // A no-show who came back goes to the end of today's queue with a new number.
    const isReturnToQueue = current.status === "no_show" && mergedStatus === "arrived";
    if (isReturnToQueue && mergedStartAt.slice(0, 10) !== today) {
      throw new ApiError(400, "Вернуть в очередь можно только запись на сегодня");
    }
```
Replace (in `update`):
```ts
    if (ACTIVE_APPOINTMENT_STATUSES.has(mergedStatus)) {
      await ensureNoDoctorConflict(
```
with:
```ts
    // Queue order, not the original slot, governs a returning patient: the slot may be taken by now.
    if (ACTIVE_APPOINTMENT_STATUSES.has(mergedStatus) && !isReturnToQueue) {
      await ensureNoDoctorConflict(
```
Replace (in `update`):
```ts
    const updated = await this.appointmentsRepository.update(id, updatedPayload);
```
with:
```ts
    const queue = planQueueChange(
      {
        status: current.status,
        doctorId: current.doctorId,
        startAt: current.startAt,
        queueNumber: current.queueNumber ?? null,
        queueDate: current.queueDate ?? null,
      },
      { status: mergedStatus, doctorId: mergedDoctorId, startAt: mergedStartAt },
      today
    );
    const updated = await this.appointmentsRepository.update(id, updatedPayload, {
      queue,
      skipConflictCheck: isReturnToQueue,
    });
```
Why a returning no-show skips both conflict checks (the service's `ensureNoDoctorConflict` and the repository's `findConflicting`): `no_show` frees the slot, and reception may have booked someone else into it meanwhile. The returning patient is ordered by the queue, not by the slot.
No database constraint refuses this in production. A read-only check on 2026-10-01 found only the primary key, three foreign keys, the `billing_status` CHECK and NOT NULLs on `appointments`, and no exclusion constraint `appointments_doctor_active_no_overlap`. So «Вернуть в очередь» into a re-booked slot works there. If `services/api/src/sql/appointments_schedule_exclusion_patch.sql` (not in `migrations/`) were ever applied by hand, the DB would reject that case with 409 «У врача уже есть запись на это время», mapped by `errorHandler`.

In `services/api/src/container/services.ts` replace:
```ts
  appointments: new AppointmentsService(repositories.appointments),
```
with:
```ts
  appointments: new AppointmentsService(repositories.appointments, env.reportsTimezone),
```
(`env` is already imported in this file.)

- [ ] **Step 8: Run the tests to verify they pass.**
Run: `cd services/api && npx vitest run src/services/appointmentsService.test.ts`
Expected: PASS (41 passed).
Run: `cd services/api && npm run typecheck && npm test`
Expected: typecheck exit 0; `Test Files 12 passed (12)`, `Tests 241 passed (241)`.

#### Cycle C: the atomic per-doctor counter

- [ ] **Step 9: Write the failing test.** Create `services/api/src/repositories/postgres/appointmentsQueue.test.ts`. This is the full harness plus the first `describe`; Step 13 appends the rest.
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-appointments-queue-tests-only" } }));
vi.mock("../../container", () => ({ services: { get appointments() { return svc; } } }));
// BOTH query and connect go through the gated pool: a pool query issued while a transaction client is
// checked out would wait for the gate forever, so these tests also prove the transactions use only `client`.
vi.mock("../../config/database", () => ({ dbPool: {
  query: (sql: string, params?: unknown[]) => pool.query(sql, params),
  connect: () => pool.connect(),
} }));
import { PostgresAppointmentsRepository } from "./PostgresAppointmentsRepository";
import { allocateQueueNumber } from "./queueAllocation";
import { AppointmentsService } from "../../services/appointmentsService";
import { appointmentsRouter } from "../../routes/appointmentsRoutes";
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

const TODAY = "2026-09-30";
const YESTERDAY = "2026-09-29";
// 06:00 UTC = 11:00 in Tashkent: the clinic day is TODAY whatever the real date is.
const repo = new PostgresAppointmentsRepository();
const svc = new AppointmentsService(repo, "Asia/Tashkent", () => new Date("2026-09-30T06:00:00Z"));

type Role = "reception" | "manager" | "doctor" | "nurse";
const users: Record<string, { userId: number; role: Role; doctorId?: number | null; nurseDoctorId?: number | null }> = {
  manager: { userId: 1, role: "manager" },
  reception: { userId: 2, role: "reception" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
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
const counters = async () =>
  (await db.query<{ doctor_id: number; queue_date: string; last_number: number }>(
    "SELECT doctor_id, to_char(queue_date, 'YYYY-MM-DD') AS queue_date, last_number FROM queue_counters ORDER BY doctor_id, queue_date"
  )).rows.map((row) => [Number(row.doctor_id), row.queue_date, Number(row.last_number)]);

beforeAll(async () => {
  // start_at holds clinic wall-clock time: literals round-trip only when the session zone equals Node's zone.
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
      created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
    CREATE TABLE services(id bigint primary key, clinic_id bigint, name text, price numeric, duration integer, active boolean default true, deleted_at timestamptz);
    CREATE TABLE doctor_services(doctor_id bigint, service_id bigint);
    CREATE TABLE appointment_services(id bigserial primary key, appointment_id bigint, service_id bigint, price numeric, quantity numeric,
      created_by bigint, created_at timestamptz default now());`);
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/033_call_center_daily_workflow.sql"), "utf8"));
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/appointments", appointmentsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/appointments`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE queue_counters, appointment_services, appointments, doctor_services, services, doctors, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics(id, name) VALUES (1, 'Клиника'), (2, 'Другая клиника');
    INSERT INTO users(id, clinic_id) VALUES (1, 1), (2, 1), (3, 1), (5, 1);
    INSERT INTO patients(id, clinic_id, full_name) VALUES (100, 1, 'Каримов Алишер'), (101, 1, 'Юсупова Нигора'), (102, 1, 'Азимов Бобур'), (103, 1, 'Рахимов Жасур');
    INSERT INTO doctors(id, clinic_id, full_name, specialty, queue_prefix) VALUES
      (10, 1, 'Алиева Дилноза', 'Терапевт', 'К'), (11, 1, 'Юсупов Тимур', 'Кардиолог', 'Т'), (12, 1, 'Без буквы', 'Хирург', NULL);
    INSERT INTO services(id, clinic_id, name, price, duration) VALUES (3, 1, 'Приём', 100000, 30);
    INSERT INTO doctor_services VALUES (10, 3), (11, 3), (12, 3);
    INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status) VALUES
      (201, 1, 100, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled'),
      (202, 1, 101, 10, 3, 100000, '${TODAY} 10:30:00', '${TODAY} 11:00:00', 'confirmed'),
      (203, 1, 102, 11, 3, 100000, '${TODAY} 11:00:00', '${TODAY} 11:30:00', 'scheduled'),
      (204, 1, 103, 10, 3, 100000, '${YESTERDAY} 10:00:00', '${YESTERDAY} 10:30:00', 'scheduled'),
      (205, 1, 103, 10, 3, 100000, '${YESTERDAY} 11:00:00', '${YESTERDAY} 11:30:00', 'no_show'),
      (206, 1, 103, 12, 3, 100000, '${TODAY} 12:00:00', '${TODAY} 12:30:00', 'scheduled');`);
});

describe("allocateQueueNumber", () => {
  it("counts per doctor and day, snapshots the letter and gives the number back on rollback", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 2, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 11, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "Т" });
      expect(await allocateQueueNumber(client, 1, 10, "2026-10-01")).toEqual({ queueNumber: 1, queuePrefix: "К" });
      expect(await allocateQueueNumber(client, 1, 12, TODAY)).toEqual({ queueNumber: 1, queuePrefix: null });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      expect(await allocateQueueNumber(client, 1, 10, TODAY)).toEqual({ queueNumber: 1, queuePrefix: "К" });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });
});
```
Notes on the harness:
- **Fixtures.** Fixture ids start at 201 because `RESTART IDENTITY` restarts the bigserial at 1, and `repo.create` in Step 13 takes ids 1, 2, …
- **Doctors.** Doctor 10 has letter "К", doctor 11 has "Т", doctor 12 has none.
- **Time zone.** `SET TIME ZONE` to Node's zone must run before any fixture is inserted. Otherwise the `'2026-09-30 10:00:00'` literals come back shifted.

- [ ] **Step 10: Run the test to verify it fails.**
Run: `cd services/api && npx vitest run src/repositories/postgres/appointmentsQueue.test.ts`
Expected: FAIL with `Error: Cannot find module './queueAllocation'` (`Failed to load url ./queueAllocation`).

- [ ] **Step 11: Implement.** Create `services/api/src/repositories/postgres/queueAllocation.ts`:
```ts
import type { QueryClient } from "./queryPool";

/**
 * Atomic per-doctor/day counter + doctor letter snapshot. Must run inside the caller's transaction on `client`:
 * the upsert row-locks the counter until COMMIT, so concurrent issues for one doctor get consecutive numbers,
 * and a ROLLBACK gives the number back. The letter is copied onto the appointment (`queue_prefix`) so a printed
 * ticket stays valid if the doctor's letter changes later.
 */
export async function allocateQueueNumber(
  client: QueryClient,
  clinicId: number,
  doctorId: number,
  day: string
): Promise<{ queueNumber: number; queuePrefix: string | null }> {
  const counter = await client.query(
    `
      INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number)
      VALUES ($1, $2, $3::date, 1)
      ON CONFLICT (doctor_id, queue_date) DO UPDATE SET last_number = queue_counters.last_number + 1
      RETURNING last_number
    `,
    [clinicId, doctorId, day]
  );
  const doctor = await client.query(
    `SELECT queue_prefix FROM doctors WHERE id = $1 AND clinic_id = $2`,
    [doctorId, clinicId]
  );
  const prefix: unknown = doctor.rows[0]?.queue_prefix;
  return {
    // pg returns INTEGER as number already; Number() keeps PGlite and pg identical.
    queueNumber: Number(counter.rows[0].last_number),
    queuePrefix: typeof prefix === "string" && prefix.trim() !== "" ? prefix : null,
  };
}
```
`queue_counters` is keyed `(doctor_id, queue_date)`. `ON CONFLICT … DO UPDATE` row-locks the counter until COMMIT, so two simultaneous arrivals for one doctor get consecutive numbers. The unique index `ux_appointments_queue_ticket` is the backstop: Task 1 maps its violation to 409.

- [ ] **Step 12: Run the tests to verify they pass.**
Run: `cd services/api && npx vitest run src/repositories/postgres/appointmentsQueue.test.ts`
Expected: PASS (1 passed).
Run: `cd services/api && npm run typecheck`
Expected: exit 0. The harness imports that are unused until Step 13 are fine: `noUnusedLocals` is off.

#### Cycle D: PostgreSQL writes the ticket in the same transaction as the change

- [ ] **Step 13: Write the failing tests.** In `services/api/src/repositories/postgres/appointmentsQueue.test.ts` replace the end of the file:
```ts
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });
});
```
with:
```ts
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });
});

describe("queue numbers through PUT /api/appointments/:id", () => {
  it("numbers today's arrivals per doctor with the doctor's letter snapshot", async () => {
    const first = await http("reception", "/201", "PUT", { status: "arrived" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "arrived", queueNumber: 1, queueCode: "К-01", queueDate: TODAY, queueCalledAt: null, queueCallCount: 0 });
    expect(typeof first.body.queueIssuedAt).toBe("string");
    expect((await http("nurse", "/202", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 2, queueCode: "К-02" });
    expect((await http("reception", "/203", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "Т-01" });
    expect((await http("reception", "/206", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "01" });
    expect(await counters()).toEqual([[10, TODAY, 2], [11, TODAY, 1], [12, TODAY, 1]]);

    // A printed ticket stays valid when the doctor's letter changes later.
    await db.query("UPDATE doctors SET queue_prefix = 'Б' WHERE id = 10");
    expect((await http("reception", "/201")).body).toMatchObject({ queueCode: "К-01" });
  });

  it("lets an arrival for another day pass without a number", async () => {
    const res = await http("reception", "/204", "PUT", { status: "arrived" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "arrived", queueNumber: null, queueCode: null, queueDate: null });
    expect(await counters()).toEqual([]);
  });

  it("keeps the same number when the arrival is sent again", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    expect((await http("reception", "/201", "PUT", { status: "arrived" })).body).toMatchObject({ queueNumber: 1, queueCode: "К-01" });
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });

  it("takes a number from the new doctor's counter when an arrived visit changes doctor", async () => {
    await http("reception", "/203", "PUT", { status: "arrived" });
    await http("reception", "/201", "PUT", { status: "arrived" });
    const moved = await http("manager", "/201", "PUT", { doctorId: 11 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ doctorId: 11, status: "arrived", queueNumber: 2, queueCode: "Т-02", queueDate: TODAY });
  });

  it("clears the queue fields when a numbered visit moves to another day", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const moved = await http("manager", "/201", "PUT", { startAt: "2099-01-05 10:00:00" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      startAt: "2099-01-05 10:00:00",
      queueNumber: null,
      queueCode: null,
      queueDate: null,
      queueIssuedAt: null,
      queueCallCount: 0,
    });
  });

  it("keeps the number through consultation and completion", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    expect((await http("doctor", "/201", "PUT", { status: "in_consultation" })).body).toMatchObject({ queueCode: "К-01" });
    const done = await http("doctor", "/201/complete", "PATCH", {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", queueNumber: 1, queueCode: "К-01" });
  });

  it("gives a returning no-show a new number at the end, even when its slot is taken meanwhile", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    await http("reception", "/202", "PUT", { status: "arrived" });
    expect((await http("reception", "/201", "PUT", { status: "no_show" })).body).toMatchObject({ status: "no_show", queueCode: "К-01" });
    await db.query(
      `INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status)
       VALUES (207, 1, 103, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled')`
    );
    const back = await http("reception", "/201", "PUT", { status: "arrived" });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: "arrived", queueNumber: 3, queueCode: "К-03" });
    // The slot really is taken: an ordinary arrival there is still refused.
    expect((await http("reception", "/207", "PUT", { status: "arrived" })).status).toBe(409);
  });

  it("refuses to return a no-show of another day to the queue", async () => {
    const res = await http("reception", "/205", "PUT", { status: "arrived" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Вернуть в очередь можно только запись на сегодня");
  });

  it("ignores queue fields sent in the request body", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const res = await http("doctor", "/201", "PUT", { notes: "Кашель", queueNumber: 99, queueCode: "Z-99", queueDate: "2020-01-01", queuePrefix: "Z" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notes: "Кашель", queueNumber: 1, queueCode: "К-01", queueDate: TODAY });
    expect((await http("reception", "/202", "PUT", { queueNumber: 5 })).status).toBe(400);
  });

  it("returns queue fields in the appointment list", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const list = await http("reception", "/?doctorId=10");
    expect(list.status).toBe(200);
    const byId = new Map<number, any>(list.body.map((row: any) => [row.id, row]));
    expect(byId.get(201)).toMatchObject({ queueNumber: 1, queueCode: "К-01", queueDate: TODAY, queueCallCount: 0 });
    expect(byId.get(202)).toMatchObject({ queueNumber: null, queueCode: null, queueDate: null, queueCallCount: 0 });
  });
});

describe("repository queue writes", () => {
  it("numbers a visit created as arrived inside the create transaction", async () => {
    const created = await runWithClinicContext(1, () =>
      repo.create(
        { patientId: 100, doctorId: 10, serviceId: 3, price: 100000, startAt: `${TODAY} 15:00:00`, endAt: `${TODAY} 15:30:00`, status: "arrived", diagnosis: null, treatment: null, notes: null },
        { queue: { kind: "issue", day: TODAY } }
      )
    );
    expect(created).toMatchObject({ status: "arrived", queueNumber: 1, queueCode: "К-01", queueDate: TODAY });
    const lines = await db.query<{ service_id: number }>("SELECT service_id FROM appointment_services WHERE appointment_id = $1", [created.id]);
    expect(lines.rows.map((row) => Number(row.service_id))).toEqual([3]);
  });

  it("does not take a second number for an issue decided on stale data", async () => {
    await http("reception", "/201", "PUT", { status: "arrived" });
    const again = await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { queue: { kind: "issue", day: TODAY } }));
    expect(again).toMatchObject({ queueNumber: 1, queueCode: "К-01" });
    expect(await counters()).toEqual([[10, TODAY, 1]]);
  });

  it("returns null and gives the number back when the row vanished", async () => {
    await db.query("UPDATE appointments SET deleted_at = now() WHERE id = 201");
    expect(await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { queue: { kind: "issue", day: TODAY } }))).toBeNull();
    expect(await counters()).toEqual([]);
  });

  it("skips the slot check only when asked to", async () => {
    await db.query(
      `INSERT INTO appointments(id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status)
       VALUES (207, 1, 103, 10, 3, 100000, '${TODAY} 10:00:00', '${TODAY} 10:30:00', 'scheduled')`
    );
    await expect(runWithClinicContext(1, () => repo.update(201, { status: "arrived" }))).rejects.toMatchObject({ status: 409 });
    expect(
      await runWithClinicContext(1, () => repo.update(201, { status: "arrived" }, { skipConflictCheck: true, queue: { kind: "issue", day: TODAY } }))
    ).toMatchObject({ status: "arrived", queueCode: "К-01" });
  });
});
```

- [ ] **Step 14: Run the test to verify it fails.**
Run: `cd services/api && npx vitest run src/repositories/postgres/appointmentsQueue.test.ts`
Expected: FAIL, 10 failed / 5 passed. For example: `expected { id: 201, patientId: 100, …(26) } to match object { status: 'arrived', …(5) }`, because the repository ignores `options.queue`; and `У врача уже есть запись на это время` in "skips the slot check only when asked to".

- [ ] **Step 15: Implement.** All edits are in `services/api/src/repositories/postgres/PostgresAppointmentsRepository.ts`.

Replace the first import:
```ts
import type { IAppointmentsRepository } from "../interfaces/IAppointmentsRepository";
```
with:
```ts
import type {
  AppointmentWriteOptions,
  IAppointmentsRepository,
} from "../interfaces/IAppointmentsRepository";
import type { QueueDirective } from "../interfaces/queueTypes";
```
Replace (this line was added in Step 3):
```ts
import { formatQueueCode } from "../../services/queue/queueRules";
```
with:
```ts
import { formatQueueCode } from "../../services/queue/queueRules";
import type { QueryClient } from "./queryPool";
import { allocateQueueNumber } from "./queueAllocation";
```
Replace:
```ts
const withServices = async (row: AppointmentRow): Promise<Appointment> =>
  (await attachAssignedServices([mapAppointmentRow(row)]))[0];
```
with:
```ts
const withServices = async (row: AppointmentRow): Promise<Appointment> =>
  (await attachAssignedServices([mapAppointmentRow(row)]))[0];

type QueueTicket = { queueNumber: number; queuePrefix: string | null; day: string };

/** SET clauses writing a new ticket or removing it ("clear"); pushes their parameters onto `values`. */
const queueSetClauses = (
  ticket: QueueTicket | "clear",
  values: Array<number | string | null>
): string[] => {
  if (ticket === "clear") {
    return [
      "queue_number = NULL",
      "queue_prefix = NULL",
      "queue_date = NULL",
      "queue_issued_at = NULL",
      "queue_called_at = NULL",
      "queue_call_count = 0",
    ];
  }
  values.push(ticket.queueNumber);
  const numberParam = values.length;
  values.push(ticket.queuePrefix);
  const prefixParam = values.length;
  values.push(ticket.day);
  const dayParam = values.length;
  return [
    `queue_number = $${numberParam}`,
    `queue_prefix = $${prefixParam}`,
    `queue_date = $${dayParam}::date`,
    "queue_issued_at = NOW()",
    "queue_called_at = NULL",
    "queue_call_count = 0",
  ];
};
```
Replace the head of `create`:
```ts
  async create(data: AppointmentCreateInput): Promise<Appointment> {
    const clinicId = requireClinicId();
    const startAt = assertAppointmentTimestampForDb(data.startAt, "startAt");
    const endAt = assertAppointmentTimestampForDb(data.endAt, "endAt");

    const hasConflict = await this.findConflicting(
      data.doctorId,
      startAt,
      endAt
    );
    if (hasConflict) {
      throw new ApiError(409, "У врача уже есть запись на это время");
    }
```
with:
```ts
  async create(
    data: AppointmentCreateInput,
    options: AppointmentWriteOptions = {}
  ): Promise<Appointment> {
    const clinicId = requireClinicId();
    const startAt = assertAppointmentTimestampForDb(data.startAt, "startAt");
    const endAt = assertAppointmentTimestampForDb(data.endAt, "endAt");

    if (!options.skipConflictCheck) {
      const hasConflict = await this.findConflicting(
        data.doctorId,
        startAt,
        endAt
      );
      if (hasConflict) {
        throw new ApiError(409, "У врача уже есть запись на это время");
      }
    }
```
Replace inside the `create` transaction:
```ts
      const mapped = mapAppointmentRow(result.rows[0]);
      const lines = await this.resolveInitialAppointmentServiceLines(data, mapped);
```
with:
```ts
      let row = result.rows[0];
      if (options.queue?.kind === "issue") {
        // The new row is invisible to other transactions until COMMIT, so no row lock is needed here.
        const ticket = await allocateQueueNumber(client, clinicId, data.doctorId, options.queue.day);
        const values: Array<number | string | null> = [];
        const clauses = queueSetClauses({ ...ticket, day: options.queue.day }, values);
        values.push(Number(row.id), clinicId);
        const numbered = await client.query<AppointmentRow>(
          `
            UPDATE appointments
            SET ${clauses.join(", ")}
            WHERE id = $${values.length - 1} AND clinic_id = $${values.length}
            RETURNING ${SELECT_LIST}
          `,
          values
        );
        row = numbered.rows[0];
      }
      const mapped = mapAppointmentRow(row);
      const lines = await this.resolveInitialAppointmentServiceLines(data, mapped);
```
Pass `price` when you call `repo.create` directly, as the tests do. Without a price, the pre-existing `resolveInitialAppointmentServiceLines` falls back to `this.getServicePrice()`. That is a pool query inside this transaction, and it deadlocks the gated test pool. The service always passes a price.

Replace the head of `update`:
```ts
  async update(id: number, data: AppointmentUpdateInput): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const current = await this.findById(id);
    if (!current) {
      return null;
    }

    const nextDoctorId = data.doctorId ?? current.doctorId;
    const nextStartAt = data.startAt ?? current.startAt;
    const nextEndAt = data.endAt ?? current.endAt;
    const hasConflict = await this.findConflicting(
      nextDoctorId,
      nextStartAt,
      nextEndAt,
      id
    );
    if (hasConflict) {
      throw new ApiError(409, "У врача уже есть запись на это время");
    }
```
with:
```ts
  async update(
    id: number,
    data: AppointmentUpdateInput,
    options: AppointmentWriteOptions = {}
  ): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const current = await this.findById(id);
    if (!current) {
      return null;
    }

    const nextDoctorId = data.doctorId ?? current.doctorId;
    const nextStartAt = data.startAt ?? current.startAt;
    const nextEndAt = data.endAt ?? current.endAt;
    if (!options.skipConflictCheck) {
      const hasConflict = await this.findConflicting(
        nextDoctorId,
        nextStartAt,
        nextEndAt,
        id
      );
      if (hasConflict) {
        throw new ApiError(409, "У врача уже есть запись на это время");
      }
    }
```
Replace the tail of `update`. The SET builder between these two anchors stays unchanged.
```ts
    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    values.push(clinicId);

    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length - 1} AND clinic_id = $${values.length} AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      values
    );
    if (result.rows.length === 0) {
      return null;
    }
    await this.syncPrimaryAppointmentServiceRow(id);
    return withServices(result.rows[0]);
  }
```
with:
```ts
    const queue: QueueDirective = options.queue ?? { kind: "keep" };
    if (setClauses.length === 0 && queue.kind === "keep") {
      return this.findById(id);
    }

    setClauses.push(`updated_at = NOW()`);
    const row = await this.updateInTransaction(clinicId, id, nextDoctorId, setClauses, values, queue);
    if (!row) {
      return null;
    }
    // Both helpers use the pool, so they run only after the transaction client was released.
    await this.syncPrimaryAppointmentServiceRow(id);
    return withServices(row);
  }

  /**
   * The row change and its queue ticket commit together. Between connect() and release() only `client`
   * may be used: a pool query there waits for a second connection (and deadlocks a one-connection pool).
   */
  private async updateInTransaction(
    clinicId: number,
    id: number,
    doctorId: number,
    setClauses: string[],
    values: Array<number | string | null>,
    queue: QueueDirective
  ): Promise<AppointmentRow | null> {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      if (queue.kind === "issue") {
        const ticket = await this.takeQueueTicket(client, clinicId, id, doctorId, queue.day);
        if (ticket === "missing") {
          await client.query("ROLLBACK");
          return null;
        }
        if (ticket !== "held") {
          setClauses.push(...queueSetClauses(ticket, values));
        }
      } else if (queue.kind === "clear") {
        setClauses.push(...queueSetClauses("clear", values));
      }
      values.push(id);
      values.push(clinicId);
      const result = await client.query<AppointmentRow>(
        `
          UPDATE appointments
          SET ${setClauses.join(", ")}
          WHERE id = $${values.length - 1} AND clinic_id = $${values.length} AND deleted_at IS NULL
          RETURNING ${SELECT_LIST}
        `,
        values
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return result.rows[0];
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Locks the row and takes the next number of `doctorId` for `day`. "held": the row is already arrived
   * with this doctor's number for `day` (a concurrent request issued it first), so no second number is
   * taken. "missing": the row is gone or soft-deleted.
   */
  private async takeQueueTicket(
    client: QueryClient,
    clinicId: number,
    id: number,
    doctorId: number,
    day: string
  ): Promise<QueueTicket | "held" | "missing"> {
    const locked = await client.query(
      `
        SELECT doctor_id, status, queue_number, to_char(queue_date, 'YYYY-MM-DD') AS queue_date
        FROM appointments
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        FOR UPDATE
      `,
      [id, clinicId]
    );
    const row = locked.rows[0] as
      | { doctor_id: number | string; status: AppointmentStatus; queue_number: number | null; queue_date: string | null }
      | undefined;
    if (!row) {
      return "missing";
    }
    // pg returns BIGINT as a string (PGlite as a number): compare doctor ids with Number().
    if (
      row.status === "arrived" &&
      row.queue_number != null &&
      row.queue_date === day &&
      Number(row.doctor_id) === doctorId
    ) {
      return "held";
    }
    const ticket = await allocateQueueNumber(client, clinicId, doctorId, day);
    return { ...ticket, day };
  }
```
Notes:
- **Every update is now a transaction.** Even "keep" runs as BEGIN / UPDATE / COMMIT, which is one extra round trip.
- **Pre-checks stay on the pool, before `connect()`.** These are `findById` and `findConflicting`.
- **"held" guard.** Two quick clicks on «Пришёл» both plan `issue` from stale data. The row lock makes the second request see the first one's number, so it takes no second number.
- **Zero rows.** A soft-deleted row returns null, and the ROLLBACK also gives the counter number back.

- [ ] **Step 16: Run the tests to verify they pass.**
Run: `cd services/api && npx vitest run src/repositories/postgres/appointmentsQueue.test.ts src/repositories/postgres/PostgresAppointmentsRepository.test.ts src/services/appointmentsService.test.ts`
Expected: PASS (15 + 8 + 41 tests).
Run: `cd services/api && npm run typecheck && npm test`
Expected: typecheck exit 0; `Test Files 13 passed (13)`, `Tests 256 passed (256)`, 0 failed.
This was verified in a sandbox copy under the Node zones Asia/Tashkent, UTC, America/Los_Angeles and Pacific/Kiritimati.

- [ ] **Step 17: Commit.**
```bash
git add services/api/src/repositories/postgres/queueAllocation.ts services/api/src/repositories/postgres/appointmentsQueue.test.ts services/api/src/repositories/postgres/PostgresAppointmentsRepository.ts services/api/src/repositories/postgres/PostgresAppointmentsRepository.test.ts services/api/src/repositories/interfaces/coreTypes.ts services/api/src/repositories/interfaces/IAppointmentsRepository.ts services/api/src/repositories/appointmentsRepository.ts services/api/src/repositories/mockDatabase.ts services/api/src/services/appointmentsService.ts services/api/src/services/appointmentsService.test.ts services/api/src/container/services.ts && git commit -m "feat(appointments): issue electronic queue numbers on arrival"
```

---

### Task 4: Queue staff API — day view, call, call-next, issue, ticket (+ API permissions)

**Files:**
- Modify: `services/api/src/auth/permissions.ts` (module list ~l.31-33, role matrix ~l.53-127, `PERMISSIONS` ~l.177)
- Create: `services/api/src/auth/permissions.test.ts`
- Create: `services/api/src/services/queue/queueDay.ts`
- Test: `services/api/src/services/queue/queueDay.test.ts`
- Create: `services/api/src/validators/queueValidators.ts`
- Create: `services/api/src/repositories/postgres/PostgresQueueRepository.ts`
- Create: `services/api/src/services/queueService.ts`
- Create: `services/api/src/controllers/queueController.ts`
- Create: `services/api/src/routes/queueRoutes.ts`
- Modify: `services/api/src/container/services.ts` (imports ~l.20, before `export const services = {` ~l.26, end of object ~l.52-56)
- Modify: `services/api/src/routes/index.ts` (imports ~l.30, mounts ~l.78)
- Test: `services/api/src/repositories/postgres/PostgresQueueRepository.test.ts`

**Interfaces:**
- Consumes (Task 1): `services/api/migrations/035_electronic_queue.sql`; from `services/api/src/repositories/interfaces/queueTypes.ts` the types
  `IQueueRepository`, `QueueDayRow`, `QueueDoctorRow`, `QueueTarget`, `QueueEntry`, `QueueEntryState`, `QueueDoctorDay`, `QueueToday`, `QueueTicket`;
  from `services/api/src/services/queue/queueRules.ts`: `clinicToday(timeZone: string, now: Date): string`, `addDays(day: string, n: number): string`,
  `formatQueueCode(prefix: string | null | undefined, queueNumber: number): string`,
  `compareCabinets(a: { room: string | null; doctorName: string }, b: { room: string | null; doctorName: string }): number`.
- Consumes (Task 3): `allocateQueueNumber(client: QueryClient, clinicId: number, doctorId: number, day: string): Promise<{ queueNumber: number; queuePrefix: string | null }>`
  from `services/api/src/repositories/postgres/queueAllocation.ts`.
- Consumes (existing): `parsePositiveId` (`validators/questionnairesValidators.ts`), `isDoctorScopedRole` / `getEffectiveDoctorId` (`services/clinicalDataScope.ts`),
  `QueryPool` / `QueryClient` (`repositories/postgres/queryPool.ts`), `normalizeToLocalDateTime` (`utils/localDateTime.ts`), `getAuthPayload` (`utils/requestAuth.ts`).
- Produces (used by Task 5 and the web tasks):
  - `permissions.ts`: module `"queue"` in `PERMISSION_MODULES`; grants reception `[read, create, update]`, doctor/nurse `[read, update]`, manager/director `[read]`;
    `PERMISSIONS.QUEUE_DISPLAY_MANAGE = ["superadmin"]` (so `allowPermission("QUEUE_DISPLAY_MANAGE")` type-checks).
  - `services/queue/queueDay.ts`: `toQueueEntry(row: QueueDayRow): QueueEntry | null`,
    `buildQueueDoctors(rows: QueueDayRow[], doctors: QueueDoctorRow[], alwaysInclude: number[]): QueueDoctorDay[]`,
    `loadQueueDay(repo: IQueueRepository, clinicId: number, day: string, doctorFilter: number[] | null, alwaysInclude: number[]): Promise<{ rows: QueueDayRow[]; doctors: QueueDoctorDay[] }>`.
  - `repositories/postgres/PostgresQueueRepository.ts`: `class PostgresQueueRepository implements IQueueRepository` with `constructor(private readonly pool: QueryPool)`.
  - `services/queueService.ts`: `class QueueService` with `constructor(repo: IQueueRepository, timeZone = "Asia/Tashkent", now: () => Date = () => new Date())` and
    `today(auth, query)`, `issue(auth, appointmentId)`, `call(auth, appointmentId)`, `callNext(auth, doctorId)`, `ticket(auth, appointmentId)` (contract §6).
  - `validators/queueValidators.ts`: `parseQueueDoctorFilter(query: unknown): number | null`, `validateQueueIdParam` (checks the appointment `req.params.id`
    of the `/appointments/:id/*` routes only; Task 5 does not use it on `/displays/:id`, where a non-numeric id gets 404 «Экран не найден» from the service),
    `validateQueueDoctorIdParam` (checks `req.params.doctorId`).
  - `controllers/queueController.ts`: `getQueueTodayController`, `issueQueueNumberController`, `callQueueEntryController`, `callNextQueueEntryController`,
    `getQueueTicketController` (Task 5 appends its display controllers to this file).
  - `routes/queueRoutes.ts`: `queueRouter`; the file's LAST line is `export { router as queueRouter };` (Task 5 inserts the display routes directly above it and
    extends the import `import { checkPermission } from "../middleware/permissionMiddleware";` with `allowPermission`).
  - `container/services.ts`: module-level `const queueRepository = new PostgresQueueRepository(dbPool);` (Task 5 passes it to `QueueDisplaysService`) and `services.queue`.
  - HTTP: `GET /api/queue/today[?doctorId=]` → `QueueToday`; `POST /api/queue/appointments/:id/issue` → `{ entry }`; `POST /api/queue/appointments/:id/call` → `{ entry }`;
    `POST /api/queue/doctors/:doctorId/call-next` → `{ entry: QueueEntry | null }`; `GET /api/queue/appointments/:id/ticket` → `QueueTicket`. All 200 on success.

Gotchas for this task (read once):
- The working tree uses CRLF line endings (`core.autocrlf=true`); the `Edit` tool matches the snippets below regardless. If you script edits, normalize `\r\n` first.
- `appointments.start_at` holds clinic wall-clock "as UTC". The day range for `in_consultation` rows is two string params (`"<day> 00:00:00"`, `"<day+1> 00:00:00"`)
  cast with `::timestamptz` exactly like `PostgresAppointmentsRepository` writes them — never `AT TIME ZONE`. `queue_date` is compared with a separate `::date` param.
- `pg` returns BIGINT/COUNT as strings and DATE as a local-midnight `Date`; PGlite returns numbers. Hence `Number(...)` everywhere, `count(*)::int`, and
  `to_char(queue_date, 'YYYY-MM-DD')`. PGlite has no `rowCount` guarantee, so "did the UPDATE match" is checked via `RETURNING id` + `rows.length`.
- The PGlite test pool is gated to one connection: inside `issue`'s transaction only `client.query` may be used (a `this.pool.query` there deadlocks the test).
- `getEffectiveDoctorId` throws 500 for non doctor/nurse roles — always guard it with `isDoctorScopedRole`.
- `call`, `call-next` and the backfill `issue` do NOT touch `appointments.updated_at` (invoices use it as an optimistic-lock version).

- [ ] **Step 1: Write the failing permissions test**

Create `services/api/src/auth/permissions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS, hasPermission, roleHasPermissionKey, rolesWithPermission } from "./permissions";

describe("queue permissions", () => {
  it("grants the queue module per the electronic queue design", () => {
    expect(rolesWithPermission("queue", "read")).toEqual(["superadmin", "reception", "doctor", "nurse", "manager", "director"]);
    expect(rolesWithPermission("queue", "create")).toEqual(["superadmin", "reception"]);
    expect(rolesWithPermission("queue", "update")).toEqual(["superadmin", "reception", "doctor", "nurse"]);
    expect(rolesWithPermission("queue", "delete")).toEqual(["superadmin"]);
    for (const role of ["cashier", "operator", "accountant"] as const) {
      expect(hasPermission(role, "queue", "read")).toBe(false);
    }
  });

  it("lets only superadmin manage queue displays", () => {
    expect(PERMISSIONS.QUEUE_DISPLAY_MANAGE).toEqual(["superadmin"]);
    expect(roleHasPermissionKey("superadmin", "QUEUE_DISPLAY_MANAGE")).toBe(true);
    expect(roleHasPermissionKey("manager", "QUEUE_DISPLAY_MANAGE")).toBe(false);
    expect(roleHasPermissionKey("reception", "QUEUE_DISPLAY_MANAGE")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/auth/permissions.test.ts`
Expected: FAIL — `expected [ 'superadmin' ] to deeply equal [ 'superadmin', 'reception', 'doctor', 'nurse', 'manager', 'director' ]`
(only the implicit superadmin passes) and `PERMISSIONS.QUEUE_DISPLAY_MANAGE` is `undefined`.

- [ ] **Step 3: Add the `queue` module, grants and `QUEUE_DISPLAY_MANAGE`**

In `services/api/src/auth/permissions.ts` replace:
```ts
  // Анкеты пациентов: общая база для всех врачей. Шаблоны — отдельная политика QUESTIONNAIRE_TEMPLATE_MANAGE.
  "questionnaires",
] as const;
```
with:
```ts
  // Анкеты пациентов: общая база для всех врачей. Шаблоны — отдельная политика QUESTIONNAIRE_TEMPLATE_MANAGE.
  "questionnaires",
  // Электронная очередь: номера и вызов пациентов. Врач/медсестра — только своя очередь (проверка в сервисе).
  // Экраны (ТВ) — отдельная политика QUEUE_DISPLAY_MANAGE.
  "queue",
] as const;
```

In the same file replace (reception block end):
```ts
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  doctor: {
```
with:
```ts
    questionnaires: ["read", "create", "update"],
    queue: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  doctor: {
```

Replace (doctor block end):
```ts
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  nurse: {
```
with:
```ts
    questionnaires: ["read", "create", "update"],
    queue: ["read", "update"],
    ai: ["read", "create"],
  },

  nurse: {
```

Replace (nurse block end):
```ts
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  cashier: {
```
with:
```ts
    questionnaires: ["read", "create", "update"],
    queue: ["read", "update"],
    ai: ["read", "create"],
  },

  cashier: {
```

Replace (manager — the only role with questionnaire delete):
```ts
    questionnaires: ["read", "create", "update", "delete"],
```
with:
```ts
    questionnaires: ["read", "create", "update", "delete"],
    queue: ["read"],
```

Replace (director):
```ts
  director: {
    patients: ["read"],
    appointments: ["read"],
```
with:
```ts
  director: {
    patients: ["read"],
    appointments: ["read"],
    queue: ["read"],
```

Replace:
```ts
  QUESTIONNAIRE_TEMPLATE_MANAGE: ["superadmin", "manager", "doctor"] as const satisfies readonly UserRole[],
```
with:
```ts
  QUESTIONNAIRE_TEMPLATE_MANAGE: ["superadmin", "manager", "doctor"] as const satisfies readonly UserRole[],
  /** ТВ-экраны электронной очереди (создание, код, удаление) — только superadmin клиники. */
  QUEUE_DISPLAY_MANAGE: ["superadmin"] as const satisfies readonly UserRole[],
```
`allowPermission` does not auto-allow superadmin (unlike `checkPermission`), so `"superadmin"` must be listed explicitly. The web mirror is Task 6.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/auth/permissions.test.ts && npm run typecheck`
Expected: PASS (2 tests), typecheck exit 0.

- [ ] **Step 5: Write the failing day-view test**

Create `services/api/src/services/queue/queueDay.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { IQueueRepository, QueueDayRow, QueueDoctorRow } from "../../repositories/interfaces/queueTypes";
import { buildQueueDoctors, loadQueueDay, toQueueEntry } from "./queueDay";

const row = (over: Partial<QueueDayRow>): QueueDayRow => ({
  appointmentId: 1,
  doctorId: 10,
  patientId: 100,
  patientName: "Каримова Анна Сергеевна",
  status: "arrived",
  startAt: "2026-09-30 10:00:00",
  queueNumber: 1,
  queuePrefix: "К",
  queueDate: "2026-09-30",
  issuedAt: "2026-09-30T03:00:00.000Z",
  calledAt: null,
  callCount: 0,
  updatedAt: "2026-09-30T05:00:00.000Z",
  ...over,
});

const doctor = (over: Partial<QueueDoctorRow>): QueueDoctorRow => ({
  id: 10,
  name: "Алиева Нигора",
  specialty: "Терапевт",
  room: "5",
  prefix: "К",
  ...over,
});

describe("toQueueEntry", () => {
  it("derives the queue state from the appointment status", () => {
    expect(toQueueEntry(row({}))).toEqual({
      appointmentId: 1,
      doctorId: 10,
      patientId: 100,
      patientName: "Каримова Анна Сергеевна",
      number: 1,
      code: "К-01",
      state: "waiting",
      startAt: "2026-09-30 10:00:00",
      issuedAt: "2026-09-30T03:00:00.000Z",
      calledAt: null,
      callCount: 0,
    });
    expect(toQueueEntry(row({ calledAt: "2026-09-30T05:10:00.000Z", callCount: 2 }))).toMatchObject({ state: "called", callCount: 2 });
    expect(toQueueEntry(row({ status: "in_consultation" }))?.state).toBe("serving");
    expect(toQueueEntry(row({ status: "no_show" }))?.state).toBe("missed");
    expect(toQueueEntry(row({ status: "completed" }))?.state).toBe("done");
    for (const status of ["scheduled", "confirmed", "cancelled"] as const) {
      expect(toQueueEntry(row({ status }))).toBeNull();
    }
  });

  it("formats codes without a letter and keeps serving-without-ticket codeless", () => {
    expect(toQueueEntry(row({ queuePrefix: null, queueNumber: 7 }))?.code).toBe("07");
    expect(toQueueEntry(row({ queueNumber: 123 }))?.code).toBe("К-123");
    expect(toQueueEntry(row({ status: "in_consultation", queueNumber: null, queuePrefix: null, queueDate: null }))).toMatchObject({
      state: "serving",
      number: null,
      code: null,
    });
  });
});

describe("buildQueueDoctors", () => {
  const doctors = [
    doctor({}),
    doctor({ id: 11, name: "Юсупов Азиз", room: "12", prefix: null }),
    doctor({ id: 12, name: "Ким Елена", room: null, prefix: null }),
    doctor({ id: 13, name: "Лаборатория", room: "Лаборатория", prefix: null }),
    doctor({ id: 14, name: "Бекова Сабина", room: "3", prefix: null }),
  ];

  it("groups entries per doctor with serving, waiting, missed and done counts", () => {
    const rows = [
      row({ appointmentId: 1, queueNumber: 3 }),
      row({ appointmentId: 2, queueNumber: 1, calledAt: "2026-09-30T05:10:00.000Z", callCount: 1 }),
      row({ appointmentId: 3, queueNumber: 2, status: "no_show" }),
      row({ appointmentId: 4, queueNumber: 5, status: "completed" }),
      row({ appointmentId: 5, queueNumber: 6, status: "completed" }),
      row({ appointmentId: 6, queueNumber: 4, status: "in_consultation", updatedAt: "2026-09-30T05:30:00.000Z" }),
      row({ appointmentId: 7, queueNumber: null, queuePrefix: null, queueDate: null, status: "in_consultation", updatedAt: "2026-09-30T05:20:00.000Z" }),
      row({ appointmentId: 8, queueNumber: 7, status: "cancelled" }),
      row({ appointmentId: 9, doctorId: 11, queueNumber: 1, queuePrefix: null }),
    ];
    const [first, second] = buildQueueDoctors(rows, doctors, []);
    expect(first).toMatchObject({ doctorId: 10, doctorName: "Алиева Нигора", specialty: "Терапевт", room: "5", prefix: "К", doneCount: 2 });
    expect(first.serving).toMatchObject({ appointmentId: 6, number: 4, code: "К-04", state: "serving" });
    expect(first.waiting.map((entry) => [entry.appointmentId, entry.state])).toEqual([
      [2, "called"],
      [1, "waiting"],
    ]);
    expect(first.missed.map((entry) => entry.code)).toEqual(["К-02"]);
    expect(second).toMatchObject({ doctorId: 11, serving: null, missed: [], doneCount: 0 });
    expect(second.waiting.map((entry) => entry.code)).toEqual(["01"]);
  });

  it("keeps only doctors with entries or always-included ones, ordered by cabinet", () => {
    const rows = [row({ appointmentId: 1, doctorId: 12 }), row({ appointmentId: 2, doctorId: 13 }), row({ appointmentId: 3, doctorId: 99 })];
    const days = buildQueueDoctors(rows, doctors, [11, 14, 98]);
    expect(days.map((day) => day.doctorId)).toEqual([14, 11, 13, 12]);
    expect(days.find((day) => day.doctorId === 14)).toMatchObject({ serving: null, waiting: [], missed: [], doneCount: 0 });
  });

  it("ignores rows that are not part of a queue", () => {
    expect(buildQueueDoctors([row({ status: "scheduled" }), row({ appointmentId: 2, status: "cancelled" })], doctors, [])).toEqual([]);
  });
});

describe("loadQueueDay", () => {
  const repo = (rows: QueueDayRow[]) =>
    ({
      listDayRows: vi.fn(async () => rows),
      listDoctors: vi.fn(async (_clinicId: number, ids: number[]) => ids.map((id) => doctor({ id, name: `Врач ${id}`, room: String(id) }))),
    }) as unknown as IQueueRepository & { listDayRows: ReturnType<typeof vi.fn>; listDoctors: ReturnType<typeof vi.fn> };

  it("loads doctors for the rows plus the always-included ones", async () => {
    const fake = repo([row({ appointmentId: 1, doctorId: 10 }), row({ appointmentId: 2, doctorId: 10, queueNumber: 2 })]);
    const result = await loadQueueDay(fake, 1, "2026-09-30", [10, 12], [12]);
    expect(fake.listDayRows).toHaveBeenCalledWith(1, "2026-09-30", [10, 12]);
    expect(fake.listDoctors).toHaveBeenCalledWith(1, [10, 12]);
    expect(result.rows).toHaveLength(2);
    expect(result.doctors.map((day) => [day.doctorId, day.waiting.length])).toEqual([
      [10, 2],
      [12, 0],
    ]);
  });

  it("skips the doctor lookup for an empty day", async () => {
    const fake = repo([]);
    expect(await loadQueueDay(fake, 1, "2026-09-30", null, [])).toEqual({ rows: [], doctors: [] });
    expect(fake.listDoctors).not.toHaveBeenCalled();
  });
});
```
(`К` in the codes is the Cyrillic letter, as doctors type it; `formatQueueCode` from Task 1 pads to two digits.)

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/services/queue/queueDay.test.ts`
Expected: FAIL with `Error: Cannot find module './queueDay'` / `Failed to load url ./queueDay ... Does the file exist?`

- [ ] **Step 7: Implement `queueDay.ts`**

Create `services/api/src/services/queue/queueDay.ts`:
```ts
import type {
  IQueueRepository,
  QueueDayRow,
  QueueDoctorDay,
  QueueDoctorRow,
  QueueEntry,
  QueueEntryState,
} from "../../repositories/interfaces/queueTypes";
import { compareCabinets, formatQueueCode } from "./queueRules";

/** Состояние в очереди выводится из статуса записи — отдельного автомата состояний нет. */
const stateOf = (row: QueueDayRow): QueueEntryState | null => {
  switch (row.status) {
    case "arrived":
      return row.calledAt ? "called" : "waiting";
    case "in_consultation":
      return "serving";
    case "no_show":
      return "missed";
    case "completed":
      return "done";
    default:
      return null;
  }
};

export function toQueueEntry(row: QueueDayRow): QueueEntry | null {
  const state = stateOf(row);
  if (!state) {
    return null;
  }
  return {
    appointmentId: row.appointmentId,
    doctorId: row.doctorId,
    patientId: row.patientId,
    patientName: row.patientName,
    number: row.queueNumber,
    code: row.queueNumber != null ? formatQueueCode(row.queuePrefix, row.queueNumber) : null,
    state,
    startAt: row.startAt,
    issuedAt: row.issuedAt,
    calledAt: row.calledAt,
    callCount: row.callCount,
  };
}

const byNumber = (a: QueueEntry, b: QueueEntry): number =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.appointmentId - b.appointmentId;

export function buildQueueDoctors(rows: QueueDayRow[], doctors: QueueDoctorRow[], alwaysInclude: number[]): QueueDoctorDay[] {
  const entriesByDoctor = new Map<number, QueueEntry[]>();
  const updatedAtMs = new Map<number, number>();
  for (const row of rows) {
    const entry = toQueueEntry(row);
    if (!entry) {
      continue;
    }
    updatedAtMs.set(entry.appointmentId, Date.parse(row.updatedAt));
    const list = entriesByDoctor.get(entry.doctorId);
    if (list) {
      list.push(entry);
    } else {
      entriesByDoctor.set(entry.doctorId, [entry]);
    }
  }

  const include = new Set(alwaysInclude);
  const days: QueueDoctorDay[] = [];
  for (const doctor of doctors) {
    const entries = entriesByDoctor.get(doctor.id) ?? [];
    if (entries.length === 0 && !include.has(doctor.id)) {
      continue;
    }
    // Если «на приёме» несколько (врач не завершил прошлый приём) — показываем последнего по updated_at.
    const serving =
      entries
        .filter((entry) => entry.state === "serving")
        .sort(
          (a, b) =>
            (updatedAtMs.get(b.appointmentId) ?? 0) - (updatedAtMs.get(a.appointmentId) ?? 0) ||
            b.appointmentId - a.appointmentId
        )[0] ?? null;
    days.push({
      doctorId: doctor.id,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      room: doctor.room,
      prefix: doctor.prefix,
      serving,
      waiting: entries.filter((entry) => entry.state === "waiting" || entry.state === "called").sort(byNumber),
      missed: entries.filter((entry) => entry.state === "missed").sort(byNumber),
      doneCount: entries.filter((entry) => entry.state === "done").length,
    });
  }
  return days.sort((a, b) => compareCabinets(a, b));
}

export async function loadQueueDay(
  repo: IQueueRepository,
  clinicId: number,
  day: string,
  doctorFilter: number[] | null,
  alwaysInclude: number[]
): Promise<{ rows: QueueDayRow[]; doctors: QueueDoctorDay[] }> {
  const rows = await repo.listDayRows(clinicId, day, doctorFilter);
  const ids = [...new Set([...rows.map((row) => row.doctorId), ...alwaysInclude])];
  const doctorRows = ids.length > 0 ? await repo.listDoctors(clinicId, ids) : [];
  return { rows, doctors: buildQueueDoctors(rows, doctorRows, alwaysInclude) };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/services/queue/queueDay.test.ts && npm run typecheck`
Expected: PASS (7 tests), typecheck exit 0.

- [ ] **Step 9: Write the failing HTTP test (PGlite + queueRouter)**

Create `services/api/src/repositories/postgres/PostgresQueueRepository.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../../config/env", () => ({
  env: { isProduction: false, jwtSecret: "isolated-queue-tests-only", reportsTimezone: "Asia/Tashkent", dataProvider: "postgres" },
}));
vi.mock("../../container", () => ({ services: { get queue() { return svc; } } }));
vi.mock("../../config/database", () => ({
  dbPool: {
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: () => pool.connect(),
  },
}));
import { PostgresQueueRepository } from "./PostgresQueueRepository";
import { QueueService } from "../../services/queueService";
import { queueRouter } from "../../routes/queueRoutes";
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
// Fixed clock: 2026-09-30T06:00Z = 11:00 in Tashkent, clinic day "2026-09-30".
const NOW = new Date("2026-09-30T06:00:00Z");
const svc = new QueueService(new PostgresQueueRepository(pool), "Asia/Tashkent", () => NOW);

type Role = "superadmin" | "manager" | "reception" | "doctor" | "nurse" | "cashier";
const users: Record<string, { userId: number; role: Role; doctorId?: number | null; nurseDoctorId?: number | null; clinicId?: number }> = {
  superadmin: { userId: 9, role: "superadmin" },
  reception: { userId: 2, role: "reception" },
  doctor: { userId: 3, role: "doctor", doctorId: 10 },
  otherDoctor: { userId: 4, role: "doctor", doctorId: 11 },
  nurse: { userId: 5, role: "nurse", nurseDoctorId: 10 },
  manager: { userId: 1, role: "manager" },
  cashier: { userId: 6, role: "cashier" },
  foreignReception: { userId: 8, role: "reception", clinicId: 2 },
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
const column = async (id: number, expr: string) =>
  (await db.query<{ v: unknown }>(`SELECT ${expr} AS v FROM appointments WHERE id = $1`, [id])).rows[0]?.v;

beforeAll(async () => {
  // start_at literals are wall clock; they round-trip only when the DB session and Node share a zone (as in production).
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
  await db.exec(readFileSync(resolve(__dirname, "../../../migrations/035_electronic_queue.sql"), "utf8"));
  const app = express();
  app.use(express.json());
  app.use("/api/queue", queueRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/queue`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
});
beforeEach(async () => {
  // Doctor 10 (room 5, letter К): #1 called, #2 serving, #3 missed, #4 and #5 waiting, #6 done, a serving patient without
  // a ticket, a cancelled #7, a deleted #8, yesterday's #1, and three unnumbered rows for the issue tests.
  // Doctor 11 (room 7) has nothing today; doctor 12 (room 3, no letter) has #1 waiting; clinic 2 has its own #1.
  await db.exec(`TRUNCATE queue_counters, queue_displays, appointments, doctors, patients, users, clinics RESTART IDENTITY CASCADE;
    INSERT INTO clinics (id, name) VALUES (1, 'Клиника Шифо'), (2, 'Чужая клиника');
    INSERT INTO users (id, clinic_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1), (8, 2), (9, 1);
    INSERT INTO patients (id, clinic_id, full_name) VALUES
      (100, 1, 'Каримова Анна Сергеевна'), (101, 1, 'Юсупов Бобур'), (102, 1, 'Алиев Сардор'), (103, 1, 'Назарова Дилноза'),
      (104, 1, 'Рахимов Тимур'), (105, 1, 'Ким Ольга'), (106, 1, 'Ли Виктор'), (107, 1, 'Отменённый Пациент'),
      (108, 1, 'Удалённый Пациент'), (109, 1, 'Вчерашний Пациент'), (110, 1, 'Поздний Пациент'), (111, 1, 'Записанный Пациент'),
      (112, 1, 'Завтрашний Пациент'), (120, 1, 'Турсунова Мадина'), (200, 2, 'Чужой Пациент');
    INSERT INTO doctors (id, clinic_id, full_name, specialty, room, queue_prefix) VALUES
      (10, 1, 'Алиева Нигора', 'Терапевт', '5', 'К'), (11, 1, 'Юсупов Азиз', 'Кардиолог', '7', NULL),
      (12, 1, 'Ким Елена', 'Педиатр', '3', NULL), (20, 2, 'Чужой Врач', 'Хирург', '1', 'Х');
    INSERT INTO appointments (id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status,
        queue_number, queue_prefix, queue_date, queue_issued_at, queue_called_at, queue_call_count, updated_at, deleted_at) VALUES
      (500, 1, 100, 10, 1, 0, '2026-09-30 08:00:00', '2026-09-30 08:30:00', 'arrived', 1, 'К', '2026-09-30', '2026-09-30 03:00:00+00', '2026-09-30 05:10:00+00', 1, '2026-09-30 05:00:00+00', NULL),
      (501, 1, 101, 10, 1, 0, '2026-09-30 08:30:00', '2026-09-30 09:00:00', 'in_consultation', 2, 'К', '2026-09-30', '2026-09-30 03:05:00+00', NULL, 0, '2026-09-30 05:20:00+00', NULL),
      (502, 1, 102, 10, 1, 0, '2026-09-30 09:00:00', '2026-09-30 09:30:00', 'no_show', 3, 'К', '2026-09-30', '2026-09-30 03:10:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (503, 1, 103, 10, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 5, 'К', '2026-09-30', '2026-09-30 03:20:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (504, 1, 104, 10, 1, 0, '2026-09-30 10:30:00', '2026-09-30 11:00:00', 'arrived', 4, 'К', '2026-09-30', '2026-09-30 03:15:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (505, 1, 105, 10, 1, 0, '2026-09-30 07:00:00', '2026-09-30 07:30:00', 'completed', 6, 'К', '2026-09-30', '2026-09-30 02:00:00+00', '2026-09-30 02:05:00+00', 1, '2026-09-30 03:00:00+00', NULL),
      (506, 1, 106, 10, 1, 0, '2026-09-30 09:00:00', '2026-09-30 09:30:00', 'in_consultation', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:30:00+00', NULL),
      (507, 1, 107, 10, 1, 0, '2026-09-30 11:00:00', '2026-09-30 11:30:00', 'cancelled', 7, 'К', '2026-09-30', '2026-09-30 03:25:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (508, 1, 108, 10, 1, 0, '2026-09-30 11:30:00', '2026-09-30 12:00:00', 'arrived', 8, 'К', '2026-09-30', '2026-09-30 03:30:00+00', NULL, 0, '2026-09-30 05:00:00+00', '2026-09-30 05:40:00+00'),
      (509, 1, 109, 10, 1, 0, '2026-09-29 10:00:00', '2026-09-29 10:30:00', 'arrived', 1, 'К', '2026-09-29', '2026-09-29 03:00:00+00', NULL, 0, '2026-09-29 05:00:00+00', NULL),
      (510, 1, 110, 10, 1, 0, '2026-09-30 12:00:00', '2026-09-30 12:30:00', 'arrived', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (511, 1, 111, 10, 1, 0, '2026-09-30 13:00:00', '2026-09-30 13:30:00', 'scheduled', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (512, 1, 112, 10, 1, 0, '2026-10-01 10:00:00', '2026-10-01 10:30:00', 'arrived', NULL, NULL, NULL, NULL, NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (520, 1, 120, 12, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 1, NULL, '2026-09-30', '2026-09-30 04:00:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL),
      (600, 2, 200, 20, 1, 0, '2026-09-30 10:00:00', '2026-09-30 10:30:00', 'arrived', 1, 'Х', '2026-09-30', '2026-09-30 04:00:00+00', NULL, 0, '2026-09-30 05:00:00+00', NULL);
    INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number) VALUES
      (1, 10, '2026-09-30', 8), (1, 10, '2026-09-29', 1), (1, 12, '2026-09-30', 1), (2, 20, '2026-09-30', 1);`);
});

describe("GET /today", () => {
  it("groups today's queue per cabinet with serving, waiting, missed and done", async () => {
    const res = await http("reception", "/today");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: "2026-09-30", timeZone: "Asia/Tashkent", serverTime: "2026-09-30T06:00:00.000Z" });
    expect(res.body.doctors.map((d: any) => d.doctorId)).toEqual([12, 10]);
    const [pediatrician, therapist] = res.body.doctors;
    expect(pediatrician).toMatchObject({ doctorName: "Ким Елена", specialty: "Педиатр", room: "3", prefix: null, serving: null, missed: [], doneCount: 0 });
    expect(pediatrician.waiting).toEqual([
      {
        appointmentId: 520, doctorId: 12, patientId: 120, patientName: "Турсунова Мадина", number: 1, code: "01", state: "waiting",
        startAt: "2026-09-30 10:00:00", issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0,
      },
    ]);
    expect(therapist).toMatchObject({ doctorName: "Алиева Нигора", room: "5", prefix: "К", doneCount: 1 });
    expect(therapist.serving).toMatchObject({ appointmentId: 506, number: null, code: null, state: "serving", startAt: "2026-09-30 09:00:00" });
    expect(therapist.waiting.map((e: any) => [e.appointmentId, e.code, e.state])).toEqual([
      [500, "К-01", "called"],
      [504, "К-04", "waiting"],
      [503, "К-05", "waiting"],
    ]);
    expect(therapist.waiting[0]).toMatchObject({ calledAt: "2026-09-30T05:10:00.000Z", callCount: 1 });
    expect(therapist.missed.map((e: any) => [e.appointmentId, e.code])).toEqual([[502, "К-03"]]);
  });

  it("filters by doctor and scopes doctors and nurses to their own queue", async () => {
    const filtered = await http("reception", "/today?doctorId=12");
    expect(filtered.body.doctors.map((d: any) => d.doctorId)).toEqual([12]);
    expect((await http("reception", "/today?doctorId=11")).body.doctors).toMatchObject([
      { doctorId: 11, serving: null, waiting: [], missed: [], doneCount: 0 },
    ]);

    expect((await http("doctor", "/today")).body.doctors.map((d: any) => d.doctorId)).toEqual([10]);
    expect((await http("nurse", "/today")).body.doctors.map((d: any) => d.doctorId)).toEqual([10]);
    const own = await http("otherDoctor", "/today");
    expect(own.status).toBe(200);
    expect(own.body.doctors).toMatchObject([{ doctorId: 11, doctorName: "Юсупов Азиз", room: "7", serving: null, waiting: [], missed: [], doneCount: 0 }]);
    expect((await http("otherDoctor", "/today?doctorId=11")).status).toBe(200);
    const foreign = await http("otherDoctor", "/today?doctorId=10");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
  });

  it("enforces the queue permission and validates the filter", async () => {
    expect((await http("manager", "/today")).status).toBe(200);
    expect((await http("superadmin", "/today")).status).toBe(200);
    expect((await http("cashier", "/today")).status).toBe(403);
    expect((await http("reception", "/today?doctorId=0")).status).toBe(400);
    expect((await http("reception", "/today?doctorId=abc")).status).toBe(400);
  });

  it("never mixes clinics", async () => {
    const own = await http("reception", "/today");
    const ids = own.body.doctors.flatMap((d: any) => [...d.waiting, ...d.missed, d.serving].filter(Boolean).map((e: any) => e.appointmentId));
    expect(ids).not.toContain(600);
    const foreign = await http("foreignReception", "/today");
    expect(foreign.body.doctors).toHaveLength(1);
    expect(foreign.body.doctors[0]).toMatchObject({ doctorId: 20, prefix: "Х" });
    expect(foreign.body.doctors[0].waiting.map((e: any) => e.appointmentId)).toEqual([600]);
    expect((await http("foreignReception", "/today?doctorId=10")).body.doctors).toEqual([]);
  });
});

describe("POST /doctors/:doctorId/call-next", () => {
  it("calls the lowest waiting number, skipping called, serving and missed ones", async () => {
    const first = await http("reception", "/doctors/10/call-next", "POST");
    expect(first.status).toBe(200);
    expect(first.body.entry).toMatchObject({ appointmentId: 504, code: "К-04", state: "called", callCount: 1 });
    expect(first.body.entry.calledAt).toEqual(expect.any(String));
    expect((await http("doctor", "/doctors/10/call-next", "POST")).body.entry).toMatchObject({ appointmentId: 503, callCount: 1 });
    expect((await http("nurse", "/doctors/10/call-next", "POST")).body).toEqual({ entry: null });
    expect((await http("reception", "/doctors/11/call-next", "POST")).body).toEqual({ entry: null });
  });

  it("keeps doctors to their own queue and read-only roles out", async () => {
    const foreign = await http("doctor", "/doctors/12/call-next", "POST");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
    expect((await http("manager", "/doctors/10/call-next", "POST")).status).toBe(403);
    expect((await http("reception", "/doctors/abc/call-next", "POST")).status).toBe(400);
    expect((await http("foreignReception", "/doctors/10/call-next", "POST")).body).toEqual({ entry: null });
    expect(await column(504, "queue_called_at")).toBeNull();
  });
});

describe("POST /appointments/:id/call", () => {
  it("re-calls a patient without touching updated_at", async () => {
    const before = await column(500, "updated_at::text");
    const res = await http("reception", "/appointments/500/call", "POST");
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ appointmentId: 500, state: "called", callCount: 2 });
    expect(res.body.entry.calledAt).not.toBe("2026-09-30T05:10:00.000Z");
    expect(await column(500, "updated_at::text")).toBe(before);

    const waiting = await http("reception", "/appointments/503/call", "POST");
    expect(waiting.body.entry).toMatchObject({ appointmentId: 503, state: "called", callCount: 1 });
  });

  it("rejects patients who are not waiting in today's queue", async () => {
    for (const id of [501, 502, 509, 510, 511]) {
      const res = await http("reception", `/appointments/${id}/call`, "POST");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Пациент не ожидает в очереди");
    }
    expect((await http("reception", "/appointments/508/call", "POST")).status).toBe(404);
    expect((await http("reception", "/appointments/600/call", "POST")).status).toBe(404);
    expect((await http("reception", "/appointments/0/call", "POST")).status).toBe(400);
  });

  it("applies roles and the doctor scope", async () => {
    expect((await http("manager", "/appointments/503/call", "POST")).status).toBe(403);
    expect((await http("cashier", "/appointments/503/call", "POST")).status).toBe(403);
    const foreign = await http("otherDoctor", "/appointments/503/call", "POST");
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Можно работать только со своей очередью");
    expect((await http("nurse", "/appointments/503/call", "POST")).body.entry).toMatchObject({ appointmentId: 503, state: "called" });
    expect((await http("doctor", "/appointments/504/call", "POST")).body.entry).toMatchObject({ appointmentId: 504, state: "called" });
  });
});

describe("nurse scope", () => {
  it("keeps a nurse to her doctor's queue: another doctor's day view, call and call-next are 403 and change nothing", async () => {
    // Doctor 11 gets one waiting patient, so only the scope check can refuse the nurse (reception calls it at the end).
    await db.exec(`INSERT INTO appointments (id, clinic_id, patient_id, doctor_id, service_id, price, start_at, end_at, status,
        queue_number, queue_prefix, queue_date, queue_issued_at, queue_called_at, queue_call_count) VALUES
      (530, 1, 111, 11, 1, 0, '2026-09-30 14:00:00', '2026-09-30 14:30:00', 'arrived', 1, NULL, '2026-09-30', '2026-09-30 04:30:00+00', NULL, 0);`);
    for (const [path, method] of [["/today?doctorId=11", "GET"], ["/appointments/530/call", "POST"], ["/doctors/11/call-next", "POST"]]) {
      const res = await http("nurse", path, method);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Можно работать только со своей очередью");
    }
    expect(await column(530, "queue_called_at")).toBeNull();
    expect(await column(530, "queue_call_count")).toBe(0);
    expect((await http("reception", "/appointments/530/call", "POST")).body.entry).toMatchObject({ appointmentId: 530, state: "called", callCount: 1 });
  });
});

describe("POST /appointments/:id/issue", () => {
  it("backfills a number for an arrived-today patient from the doctor's counter, idempotently", async () => {
    const res = await http("reception", "/appointments/510/issue", "POST");
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ appointmentId: 510, number: 9, code: "К-09", state: "waiting", callCount: 0, calledAt: null });
    expect(res.body.entry.issuedAt).toEqual(expect.any(String));
    const again = await http("reception", "/appointments/510/issue", "POST");
    expect(again.body.entry).toMatchObject({ number: 9, code: "К-09" });
    const counter = await db.query<{ last_number: number }>(
      `SELECT last_number FROM queue_counters WHERE doctor_id = 10 AND queue_date = '2026-09-30'`
    );
    expect(counter.rows[0].last_number).toBe(9);
    expect(await column(503, "queue_number")).toBe(5);
  });

  it("refuses patients who have not arrived or are not booked for today", async () => {
    const scheduled = await http("reception", "/appointments/511/issue", "POST");
    expect(scheduled.status).toBe(409);
    expect(scheduled.body.error).toBe("Номер выдаётся только пришедшему пациенту");
    const tomorrow = await http("reception", "/appointments/512/issue", "POST");
    expect(tomorrow.status).toBe(409);
    expect(tomorrow.body.error).toBe("Запись не на сегодня");
    expect((await http("reception", "/appointments/9999/issue", "POST")).status).toBe(404);
    expect((await http("foreignReception", "/appointments/510/issue", "POST")).status).toBe(404);
    expect((await http("doctor", "/appointments/510/issue", "POST")).status).toBe(403);
    expect((await http("manager", "/appointments/510/issue", "POST")).status).toBe(403);
    expect(await column(510, "queue_number")).toBeNull();
  });
});

describe("GET /appointments/:id/ticket", () => {
  it("returns the printable ticket with the number of patients ahead", async () => {
    const res = await http("reception", "/appointments/503/ticket");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      appointmentId: 503, clinicName: "Клиника Шифо", code: "К-05", number: 5, doctorName: "Алиева Нигора", specialty: "Терапевт",
      room: "5", issuedAt: "2026-09-30T03:20:00.000Z", aheadCount: 2, timeZone: "Asia/Tashkent",
    });
    expect((await http("doctor", "/appointments/520/ticket")).status).toBe(403);
    expect((await http("cashier", "/appointments/503/ticket")).status).toBe(403);
    expect((await http("manager", "/appointments/520/ticket")).body).toMatchObject({ code: "01", aheadCount: 0, room: "3" });
  });

  it("falls back to a generic clinic name and 404s without a number", async () => {
    await db.exec(`UPDATE clinics SET name = '   ' WHERE id = 1`);
    expect((await http("reception", "/appointments/503/ticket")).body.clinicName).toBe("Клиника");
    const none = await http("reception", "/appointments/511/ticket");
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("У записи нет номера очереди");
    expect((await http("reception", "/appointments/9999/ticket")).status).toBe(404);
    expect((await http("reception", "/appointments/600/ticket")).status).toBe(404);
  });
});
```
Notes: the fixture needs `queue_counters` rows (doctor 10 at 8) because numbers are seeded by hand — without them the counter would restart at 1 and hit
`ux_appointments_queue_ticket`. The DB `now()` is the real clock (only the service clock is fixed), so the test never compares `calledAt`/`issuedAt` written by the
code with the fixed clock. Only `035` is executed: the queue code reads no column from `033`.

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/repositories/postgres/PostgresQueueRepository.test.ts`
Expected: FAIL with `Error: Cannot find module './PostgresQueueRepository'` / `Failed to load url ./PostgresQueueRepository ... Does the file exist?`

- [ ] **Step 11: Create the validators**

Create `services/api/src/validators/queueValidators.ts`:
```ts
import type { NextFunction, Request, Response } from "express";
import { parsePositiveId } from "./questionnairesValidators";

/** `?doctorId=` of GET /api/queue/today: absent or empty → null, otherwise a positive integer (400 on garbage). */
export const parseQueueDoctorFilter = (query: unknown): number | null => {
  const raw = query && typeof query === "object" ? (query as Record<string, unknown>).doctorId : undefined;
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  return parsePositiveId(raw, "doctorId");
};

/** `:id` route param of the /appointments/:id/* routes (appointment id). */
export const validateQueueIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  parsePositiveId(req.params.id, "id");
  next();
};

/** `:doctorId` route param of POST /api/queue/doctors/:doctorId/call-next. */
export const validateQueueDoctorIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  parsePositiveId(req.params.doctorId, "doctorId");
  next();
};
```

- [ ] **Step 12: Create the repository**

Create `services/api/src/repositories/postgres/PostgresQueueRepository.ts`:
```ts
import { ApiError } from "../../middleware/errorHandler";
import { addDays } from "../../services/queue/queueRules";
import { normalizeToLocalDateTime } from "../../utils/localDateTime";
import type { AppointmentStatus } from "../interfaces/coreTypes";
import type { IQueueRepository, QueueDayRow, QueueDoctorRow, QueueTarget } from "../interfaces/queueTypes";
import { allocateQueueNumber } from "./queueAllocation";
import type { QueryClient, QueryPool } from "./queryPool";

type DayRowDb = {
  id: number | string;
  doctor_id: number | string;
  patient_id: number | string;
  patient_name: string | null;
  status: AppointmentStatus;
  start_at: string | Date;
  queue_number: number | string | null;
  queue_prefix: string | null;
  queue_date: string | null;
  queue_issued_at: string | Date | null;
  queue_called_at: string | Date | null;
  queue_call_count: number | string | null;
  updated_at: string | Date;
};

/** Моменты времени (issued/called/updated) — настоящие instant-ы, отдаём ISO. start_at — «настенное» время записи. */
const iso = (value: string | Date | null): string | null => (value == null ? null : new Date(value).toISOString());
const numberOrNull = (value: unknown): number | null => (value == null ? null : Number(value));

const DAY_ROW_SELECT = `
  SELECT a.id, a.doctor_id, a.patient_id, COALESCE(btrim(p.full_name), '') AS patient_name, a.status, a.start_at,
         a.queue_number, a.queue_prefix, to_char(a.queue_date, 'YYYY-MM-DD') AS queue_date,
         a.queue_issued_at, a.queue_called_at, a.queue_call_count, a.updated_at
  FROM appointments a
  LEFT JOIN patients p ON p.id = a.patient_id`;

const mapDayRow = (row: DayRowDb): QueueDayRow => ({
  appointmentId: Number(row.id),
  doctorId: Number(row.doctor_id),
  patientId: Number(row.patient_id),
  patientName: row.patient_name ?? "",
  status: row.status,
  startAt: normalizeToLocalDateTime(row.start_at),
  queueNumber: numberOrNull(row.queue_number),
  queuePrefix: row.queue_prefix ?? null,
  queueDate: row.queue_date ?? null,
  issuedAt: iso(row.queue_issued_at),
  calledAt: iso(row.queue_called_at),
  callCount: Number(row.queue_call_count ?? 0),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export class PostgresQueueRepository implements IQueueRepository {
  constructor(private readonly pool: QueryPool) {}

  async listDayRows(clinicId: number, day: string, doctorIds: number[] | null): Promise<QueueDayRow[]> {
    // start_at хранит настенное время клиники «как UTC»: границы дня передаём строками и приводим так же,
    // как их пишет PostgresAppointmentsRepository ($::timestamptz), без AT TIME ZONE.
    const result = await this.pool.query(
      `${DAY_ROW_SELECT}
       WHERE a.clinic_id = $1
         AND a.deleted_at IS NULL
         AND a.status <> 'cancelled'
         AND ($5::bigint[] IS NULL OR a.doctor_id = ANY($5::bigint[]))
         AND (
           (a.queue_date = $2::date AND a.queue_number IS NOT NULL)
           OR (a.status = 'in_consultation' AND a.start_at >= $3::timestamptz AND a.start_at < $4::timestamptz)
         )
       ORDER BY a.doctor_id, a.queue_number NULLS LAST, a.id`,
      [clinicId, day, `${day} 00:00:00`, `${addDays(day, 1)} 00:00:00`, doctorIds]
    );
    return result.rows.map(mapDayRow);
  }

  async getDayRow(clinicId: number, appointmentId: number): Promise<QueueDayRow | null> {
    const result = await this.pool.query(
      `${DAY_ROW_SELECT}
       WHERE a.id = $1 AND a.clinic_id = $2 AND a.deleted_at IS NULL`,
      [appointmentId, clinicId]
    );
    return result.rows[0] ? mapDayRow(result.rows[0]) : null;
  }

  async listDoctors(clinicId: number, doctorIds: number[]): Promise<QueueDoctorRow[]> {
    const result = await this.pool.query(
      `SELECT d.id, COALESCE(btrim(d.full_name), '') AS name, COALESCE(btrim(d.specialty), '') AS specialty,
              d.room, d.queue_prefix
       FROM doctors d
       WHERE d.clinic_id = $1 AND d.id = ANY($2::bigint[]) AND d.deleted_at IS NULL
       ORDER BY d.id`,
      [clinicId, doctorIds]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      specialty: row.specialty,
      room: row.room ?? null,
      prefix: row.queue_prefix ?? null,
    }));
  }

  async findTarget(clinicId: number, appointmentId: number): Promise<QueueTarget | null> {
    const result = await this.pool.query(
      `SELECT id, doctor_id, status, start_at, queue_number, to_char(queue_date, 'YYYY-MM-DD') AS queue_date
       FROM appointments
       WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
      [appointmentId, clinicId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      appointmentId: Number(row.id),
      doctorId: Number(row.doctor_id),
      status: row.status,
      startAt: normalizeToLocalDateTime(row.start_at),
      queueNumber: numberOrNull(row.queue_number),
      queueDate: row.queue_date ?? null,
    };
  }

  async issue(clinicId: number, appointmentId: number, day: string): Promise<void> {
    await this.transaction(async (client) => {
      // Внутри транзакции — только client: тестовый пул выдаёт одно соединение, pool.query здесь зависнет.
      const locked = await client.query(
        `SELECT doctor_id, status, queue_number, to_char(queue_date, 'YYYY-MM-DD') AS queue_date
         FROM appointments
         WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [appointmentId, clinicId]
      );
      const row = locked.rows[0];
      if (!row) {
        throw new ApiError(404, "Запись не найдена");
      }
      if (row.status !== "arrived") {
        throw new ApiError(409, "Номер выдаётся только пришедшему пациенту");
      }
      if (row.queue_number != null && row.queue_date === day) {
        return; // Номер на сегодня уже выдан — повторная выдача идемпотентна.
      }
      const { queueNumber, queuePrefix } = await allocateQueueNumber(client, clinicId, Number(row.doctor_id), day);
      // updated_at не трогаем: номер — не правка записи, иначе счёт/услуги получат ложный 409 оптимистичной блокировки.
      await client.query(
        `UPDATE appointments
         SET queue_number = $3, queue_prefix = $4, queue_date = $5::date, queue_issued_at = now(),
             queue_called_at = NULL, queue_call_count = 0
         WHERE id = $1 AND clinic_id = $2`,
        [appointmentId, clinicId, queueNumber, queuePrefix, day]
      );
    });
  }

  async call(clinicId: number, appointmentId: number, day: string): Promise<boolean> {
    // updated_at не меняется: вызов — не правка записи (иначе счёт/услуги получат ложный 409 оптимистичной блокировки).
    const result = await this.pool.query(
      `UPDATE appointments
       SET queue_called_at = now(), queue_call_count = queue_call_count + 1
       WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL AND status = 'arrived'
         AND queue_number IS NOT NULL AND queue_date = $3::date
       RETURNING id`,
      [appointmentId, clinicId, day]
    );
    return result.rows.length > 0;
  }

  async callNext(clinicId: number, doctorId: number, day: string): Promise<number | null> {
    // SKIP LOCKED: два одновременных «Вызвать следующего» получат разных пациентов (или второй — null).
    const result = await this.pool.query(
      `WITH next AS (
         SELECT id
         FROM appointments
         WHERE clinic_id = $1 AND doctor_id = $2 AND queue_date = $3::date AND queue_number IS NOT NULL
           AND status = 'arrived' AND queue_called_at IS NULL AND deleted_at IS NULL
         ORDER BY queue_number
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE appointments a
       SET queue_called_at = now(), queue_call_count = a.queue_call_count + 1
       FROM next
       WHERE a.id = next.id
       RETURNING a.id`,
      [clinicId, doctorId, day]
    );
    return result.rows[0] ? Number(result.rows[0].id) : null;
  }

  async countAhead(clinicId: number, doctorId: number, day: string, queueNumber: number): Promise<number> {
    const result = await this.pool.query(
      `SELECT count(*)::int AS ahead
       FROM appointments
       WHERE clinic_id = $1 AND doctor_id = $2 AND queue_date = $3::date AND queue_number < $4
         AND status = 'arrived' AND deleted_at IS NULL`,
      [clinicId, doctorId, day, queueNumber]
    );
    return Number(result.rows[0]?.ahead ?? 0);
  }

  async clinicName(clinicId: number): Promise<string> {
    const result = await this.pool.query(`SELECT name FROM clinics WHERE id = $1 LIMIT 1`, [clinicId]);
    const name = typeof result.rows[0]?.name === "string" ? result.rows[0].name.trim() : "";
    return name || "Клиника";
  }

  private async transaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
```
`listDayRows` runs on every TV poll (2 s) and staff poll (5 s); its two OR branches are served by the two partial indexes of migration 035
(`idx_appointments_queue_day`, `idx_appointments_in_consultation_day`), which the planner combines with a BitmapOr (Task 1, note under Step 11).
`callNext` is a single statement (atomic without an explicit transaction): the CTE locks the lowest uncalled `arrived` row with `FOR UPDATE SKIP LOCKED`, so two
simultaneous "Вызвать следующего" presses get two different patients or `null`. `listDoctors` skips soft-deleted doctors (`deleted_at IS NULL`), so a deleted
doctor's card disappears from the queue views.

- [ ] **Step 13: Create the service**

Create `services/api/src/services/queueService.ts`:
```ts
import { ApiError } from "../middleware/errorHandler";
import type { IQueueRepository, QueueEntry, QueueTicket, QueueToday } from "../repositories/interfaces/queueTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { parseQueueDoctorFilter } from "../validators/queueValidators";
import { getEffectiveDoctorId, isDoctorScopedRole } from "./clinicalDataScope";
import { loadQueueDay, toQueueEntry } from "./queue/queueDay";
import { clinicToday, formatQueueCode } from "./queue/queueRules";

const FOREIGN_QUEUE = "Можно работать только со своей очередью";
const NOT_FOUND = "Запись не найдена";

export class QueueService {
  constructor(
    private readonly repo: IQueueRepository,
    private readonly timeZone: string = "Asia/Tashkent",
    private readonly now: () => Date = () => new Date()
  ) {}

  async today(auth: AuthTokenPayload, query: unknown): Promise<QueueToday> {
    const requested = parseQueueDoctorFilter(query);
    const own = this.ownDoctorId(auth);
    if (own != null && requested != null && requested !== own) {
      throw new ApiError(403, FOREIGN_QUEUE);
    }
    const doctorId = own ?? requested;
    const now = this.now();
    const date = clinicToday(this.timeZone, now);
    // Выбранный врач (для врача/медсестры — свой) показывается карточкой даже с пустой очередью.
    const filter = doctorId == null ? null : [doctorId];
    const { doctors } = await loadQueueDay(this.repo, auth.clinicId, date, filter, filter ?? []);
    return { date, timeZone: this.timeZone, serverTime: now.toISOString(), doctors };
  }

  async issue(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }> {
    const target = await this.repo.findTarget(auth.clinicId, appointmentId);
    if (!target) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, target.doctorId);
    if (target.status !== "arrived") {
      throw new ApiError(409, "Номер выдаётся только пришедшему пациенту");
    }
    const day = this.currentDay();
    if (target.startAt.slice(0, 10) !== day) {
      throw new ApiError(409, "Запись не на сегодня");
    }
    await this.repo.issue(auth.clinicId, appointmentId, day);
    return { entry: await this.entry(auth.clinicId, appointmentId) };
  }

  async call(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }> {
    const target = await this.repo.findTarget(auth.clinicId, appointmentId);
    if (!target) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, target.doctorId);
    if (!(await this.repo.call(auth.clinicId, appointmentId, this.currentDay()))) {
      throw new ApiError(409, "Пациент не ожидает в очереди");
    }
    return { entry: await this.entry(auth.clinicId, appointmentId) };
  }

  async callNext(auth: AuthTokenPayload, doctorId: number): Promise<{ entry: QueueEntry | null }> {
    this.assertOwnQueue(auth, doctorId);
    const appointmentId = await this.repo.callNext(auth.clinicId, doctorId, this.currentDay());
    return { entry: appointmentId == null ? null : await this.entry(auth.clinicId, appointmentId) };
  }

  async ticket(auth: AuthTokenPayload, appointmentId: number): Promise<QueueTicket> {
    const row = await this.repo.getDayRow(auth.clinicId, appointmentId);
    if (!row) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, row.doctorId);
    if (row.queueNumber == null || row.queueDate == null) {
      throw new ApiError(404, "У записи нет номера очереди");
    }
    const [doctors, clinicName, aheadCount] = await Promise.all([
      this.repo.listDoctors(auth.clinicId, [row.doctorId]),
      this.repo.clinicName(auth.clinicId),
      this.repo.countAhead(auth.clinicId, row.doctorId, row.queueDate, row.queueNumber),
    ]);
    const doctor = doctors[0];
    return {
      appointmentId: row.appointmentId,
      clinicName,
      code: formatQueueCode(row.queuePrefix, row.queueNumber),
      number: row.queueNumber,
      doctorName: doctor?.name ?? "",
      specialty: doctor?.specialty ?? "",
      room: doctor?.room ?? null,
      issuedAt: row.issuedAt ?? this.now().toISOString(),
      aheadCount,
      timeZone: this.timeZone,
    };
  }

  /** Врач/медсестра — id «своего» врача; остальные роли видят все очереди клиники (null). */
  private ownDoctorId(auth: AuthTokenPayload): number | null {
    // getEffectiveDoctorId бросает 500 для не-врачебных ролей — вызываем только после isDoctorScopedRole.
    return isDoctorScopedRole(auth.role) ? getEffectiveDoctorId(auth) : null;
  }

  private assertOwnQueue(auth: AuthTokenPayload, doctorId: number): void {
    const own = this.ownDoctorId(auth);
    if (own != null && own !== doctorId) {
      throw new ApiError(403, FOREIGN_QUEUE);
    }
  }

  private currentDay(): string {
    return clinicToday(this.timeZone, this.now());
  }

  private async entry(clinicId: number, appointmentId: number): Promise<QueueEntry> {
    const row = await this.repo.getDayRow(clinicId, appointmentId);
    const entry = row ? toQueueEntry(row) : null;
    if (!entry) {
      throw new ApiError(404, NOT_FOUND);
    }
    return entry;
  }
}
```
Behaviour notes: for non-scoped roles a `?doctorId=` filter also force-includes that doctor's card (empty queue still renders on the Queue page filter).
`ticket` checks the doctor scope before revealing whether the appointment has a number.

- [ ] **Step 14: Create the controller and the router**

Create `services/api/src/controllers/queueController.ts`:
```ts
import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const getQueueTodayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.today(auth, req.query));
};

export const issueQueueNumberController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.issue(auth, Number(req.params.id)));
};

export const callQueueEntryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.call(auth, Number(req.params.id)));
};

export const callNextQueueEntryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.callNext(auth, Number(req.params.doctorId)));
};

export const getQueueTicketController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.ticket(auth, Number(req.params.id)));
};
```

Create `services/api/src/routes/queueRoutes.ts` (keep `export { router as queueRouter };` as the very last line — Task 5 inserts display routes above it):
```ts
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  callNextQueueEntryController,
  callQueueEntryController,
  getQueueTicketController,
  getQueueTodayController,
  issueQueueNumberController,
} from "../controllers/queueController";
import { validateQueueDoctorIdParam, validateQueueIdParam } from "../validators/queueValidators";

const router = Router();

// Свой requireAuth: тесты монтируют роутер напрямую, без index.ts. Врач/медсестра — только своя очередь (сервис).
router.use(requireAuth);
router.get("/today", checkPermission("queue", "read"), asyncHandler(getQueueTodayController));
router.post(
  "/appointments/:id/issue",
  checkPermission("queue", "create"),
  validateQueueIdParam,
  asyncHandler(issueQueueNumberController)
);
router.post(
  "/appointments/:id/call",
  checkPermission("queue", "update"),
  validateQueueIdParam,
  asyncHandler(callQueueEntryController)
);
router.get(
  "/appointments/:id/ticket",
  checkPermission("queue", "read"),
  validateQueueIdParam,
  asyncHandler(getQueueTicketController)
);
router.post(
  "/doctors/:doctorId/call-next",
  checkPermission("queue", "update"),
  validateQueueDoctorIdParam,
  asyncHandler(callNextQueueEntryController)
);

export { router as queueRouter };
```

- [ ] **Step 15: Wire the container and mount the router**

In `services/api/src/container/services.ts` replace:
```ts
import { PostgresQuestionnairesRepository } from "../repositories/postgres/PostgresQuestionnairesRepository";
```
with:
```ts
import { PostgresQuestionnairesRepository } from "../repositories/postgres/PostgresQuestionnairesRepository";
import { QueueService } from "../services/queueService";
import { PostgresQueueRepository } from "../repositories/postgres/PostgresQueueRepository";
```

In the same file replace:
```ts
export const services = {
```
with:
```ts
// Один репозиторий очереди на сотрудников и публичный ТВ-экран.
const queueRepository = new PostgresQueueRepository(dbPool);

export const services = {
```

In the same file replace (end of the object; Task 3 changed only the `appointments:` line above, which this anchor does not touch):
```ts
    new PostgresQuestionnairesRepository(dbPool, env.reportsTimezone),
    repositories.appointments
  ),
};
```
with:
```ts
    new PostgresQuestionnairesRepository(dbPool, env.reportsTimezone),
    repositories.appointments
  ),
  queue: new QueueService(queueRepository, env.reportsTimezone),
};
```

In `services/api/src/routes/index.ts` replace:
```ts
import { questionnairesRouter } from "./questionnairesRoutes";
```
with:
```ts
import { questionnairesRouter } from "./questionnairesRoutes";
import { queueRouter } from "./queueRoutes";
```

In the same file replace:
```ts
router.use("/questionnaires", requireAuth, subscriptionGuard, questionnairesRouter);
```
with:
```ts
router.use("/questionnaires", requireAuth, subscriptionGuard, questionnairesRouter);
router.use("/queue", requireAuth, subscriptionGuard, queueRouter);
```
(`requireAuth` runs twice on this path — once here, once inside `queueRouter` — which is harmless and lets the tests mount the router alone.)

- [ ] **Step 16: Run the tests to verify they pass**

Run: `cd services/api && npx vitest run src/repositories/postgres/PostgresQueueRepository.test.ts src/services/queue/queueDay.test.ts src/auth/permissions.test.ts`
Expected: PASS — `Test Files 3 passed (3)`, `Tests 23 passed (23)` (14 + 7 + 2 tests).

Run: `cd services/api && npm run typecheck && npm test`
Expected: typecheck exit 0; the whole API suite PASS with `Test Files 16 passed (16)`, `Tests 279 passed (279)` (the real-`env` tests read `JWT_SECRET` from `services/api/.env`, as before this task).

- [ ] **Step 17: Commit**

```bash
git add services/api/src/auth/permissions.ts services/api/src/auth/permissions.test.ts \
  services/api/src/services/queue/queueDay.ts services/api/src/services/queue/queueDay.test.ts \
  services/api/src/validators/queueValidators.ts \
  services/api/src/repositories/postgres/PostgresQueueRepository.ts services/api/src/repositories/postgres/PostgresQueueRepository.test.ts \
  services/api/src/services/queueService.ts services/api/src/controllers/queueController.ts services/api/src/routes/queueRoutes.ts \
  services/api/src/container/services.ts services/api/src/routes/index.ts \
  && git commit -m "feat(api): queue staff API — day view, call, call-next, issue, ticket"
```

---

### Task 5: TV screens — display management and the public queue endpoint (API)

Superadmin creates/edits/deletes TV screens ("displays") of the clinic and gets a one-time screen code; an unauthenticated TV polls
`GET /api/public/queue-display/:code` and receives today's masked queue of that clinic. Everything below lives in `services/api`.

**Files:**
- Modify: `services/api/src/middleware/subscriptionMiddleware.ts` (lines 7–10, 34–36, 53–65 of the current file)
- Create: `services/api/src/middleware/subscriptionMiddleware.test.ts`
- Create: `services/api/src/services/queue/displayState.ts`
- Create: `services/api/src/services/queue/displayState.test.ts`
- Create: `services/api/src/repositories/postgres/PostgresQueueDisplaysRepository.ts`
- Create: `services/api/src/services/queueDisplaysService.ts`
- Create: `services/api/src/middleware/publicRateLimit.ts`
- Create: `services/api/src/routes/publicRoutes.ts`
- Modify: `services/api/src/controllers/queueController.ts` (created by Task 4; append at the end)
- Modify: `services/api/src/routes/queueRoutes.ts` (created by Task 4; imports at the top, display routes right before the final export)
- Modify: `services/api/src/container/services.ts` (imports ≈ line 22–24; one entry after the `queue:` entry Task 4 added)
- Modify: `services/api/src/routes/index.ts` (import ≈ line 30; mount ≈ line 54, next to `/auth`)
- Modify: `services/api/src/middleware/requestLogger.ts` (lines 5–6, the `requestLogger` export)
- Test: `services/api/src/repositories/postgres/queueDisplays.test.ts` (PGlite + real HTTP)
- Test: `services/api/src/middleware/requestLogger.test.ts`

**Interfaces:**
- Consumes (exact names, per the contract):
  - Task 1 — `services/api/src/services/queue/queueRules.ts`: `clinicToday(timeZone, now)`, `formatQueueCode(prefix, n)`, `maskPatientName(fullName)`, `compareCabinets(a, b)`;
    `services/api/src/services/queue/displayCode.ts`: `generateDisplayCode()`, `formatDisplayCode(canonical)`, `normalizeDisplayCode(input)`, `hashDisplayCode(canonical)`;
    `services/api/src/repositories/interfaces/queueTypes.ts`: `IQueueDisplaysRepository`, `IQueueRepository`, `QueueDisplay`, `QueueDisplayInput`, `QueueDisplayLanguage`,
    `QueueDisplayLookup`, `QueueDisplayWithCode`, `QueueDisplayState`, `QueueDisplayCabinet`, `QueueDisplayCall`, `QueueDoctorDay`, `QueueDayRow`, `QueueEntry`;
    migrations `033_call_center_daily_workflow.sql` (existing) and `035_electronic_queue.sql` (tables `queue_displays`, `queue_counters`, queue columns).
  - Task 4 — `services/api/src/services/queue/queueDay.ts`: `loadQueueDay(repo, clinicId, day, doctorFilter, alwaysInclude)`;
    `services/api/src/repositories/postgres/PostgresQueueRepository.ts`: `new PostgresQueueRepository(pool: QueryPool)`;
    `services/api/src/services/queueService.ts`: `new QueueService(repo, timeZone, now)`;
    `services/api/src/routes/queueRoutes.ts` (starts with `import { Router } from "express";`, has `router.use(requireAuth)` and imports `asyncHandler`,
    ends with `export { router as queueRouter };`); `services/api/src/controllers/queueController.ts` (imports `Request`/`Response` from express,
    `services` from `../container`, `getAuthPayload` from `../utils/requestAuth`); `PERMISSIONS.QUEUE_DISPLAY_MANAGE = ["superadmin"]` in
    `services/api/src/auth/permissions.ts`; in `services/api/src/container/services.ts` the module-level `const queueRepository = new PostgresQueueRepository(dbPool);`
    and the entry `  queue: new QueueService(queueRepository, env.reportsTimezone),`.
- Produces:
  - `services/api/src/middleware/subscriptionMiddleware.ts`: `export type SubscriptionFields = { subscription_status: string | null; subscription_ends_at: Date | string | null }`,
    `export function getSubscriptionBlock(row: SubscriptionFields, nowMs: number): "suspended" | "expired" | null` (middleware behaviour unchanged: still 402).
  - `services/api/src/services/queue/displayState.ts`: `buildDisplayState(input: { serverTime; timeZone; clinicName; display: QueueDisplay; doctors: QueueDoctorDay[]; rows: QueueDayRow[] }): QueueDisplayState`,
    `DISPLAY_WAITING_LIMIT = 5`, `DISPLAY_RECENT_CALLS_LIMIT = 20`.
  - `services/api/src/repositories/postgres/PostgresQueueDisplaysRepository.ts`: `class PostgresQueueDisplaysRepository implements IQueueDisplaysRepository`, `constructor(pool: QueryPool)`.
  - `services/api/src/services/queueDisplaysService.ts`: `class QueueDisplaysService` — `constructor(displays, queue, timeZone = "Asia/Tashkent", now = () => new Date())`,
    `list(auth)`, `create(auth, body)`, `update(auth, id, body)`, `remove(auth, id)`, `rotate(auth, id)`, `publicState(code)`.
  - `services/api/src/middleware/publicRateLimit.ts`: `publicQueueDisplayRateLimit`. `services/api/src/routes/publicRoutes.ts`: `publicRouter`.
  - `services/api/src/middleware/requestLogger.ts`: `shouldSkipRequestLog(method: string, originalUrl: string, statusCode: number): boolean` (true for a
    successful (< 400) GET of `/api/public/queue-display/…` or `/api/queue/today`, query ignored) and `redactLoggedUrl(originalUrl: string): string`
    (`/api/public/queue-display/<code…>` → `/api/public/queue-display/***`); `requestLogger` keeps its morgan format and now skips/redacts with them.
  - `services/api/src/controllers/queueController.ts` (appended): `listQueueDisplaysController`, `createQueueDisplayController`, `updateQueueDisplayController`,
    `deleteQueueDisplayController`, `rotateQueueDisplayCodeController`, `getPublicQueueDisplayController`.
  - Container: `services.queueDisplays` (Task 14's preview stand must expose it too).
  - HTTP (consumed by Task 6 `queueApi` / `fetchQueueDisplayState`, Task 10, Task 12):
    `GET /api/queue/displays` → 200 `QueueDisplay[]`; `POST /api/queue/displays` → **201** `QueueDisplayWithCode`;
    `PATCH /api/queue/displays/:id` → 200 `QueueDisplay`; `DELETE /api/queue/displays/:id` → 200 `{ success: true, id }`;
    `POST /api/queue/displays/:id/rotate-code` → 200 `QueueDisplayWithCode` — all superadmin only (others 403), unknown/foreign/revoked id → 404 `{ error: "Экран не найден" }`, bad input → 400.
    `GET /api/public/queue-display/:code` (no auth) → 200 `QueueDisplayState`; unknown/malformed/revoked code → 404 `{ error: "Экран не найден" }`;
    suspended/expired clinic → 403 `{ error: "Подписка клиники неактивна" }`; always `Cache-Control: no-store` and `RateLimit-*` headers (300/min per client IP).
  - Input rule (refinement): `doctorIds: []` is stored as `null` (= "all doctors with a queue today"), duplicates are removed.
  - Display ids are not checked by Task 4's `validateQueueIdParam` (that validator guards only the appointment `/appointments/:id/*` routes). A
    non-numeric or non-positive `/displays/:id` reaches the service, and `assertDisplayId` answers 404 `{ error: "Экран не найден" }`, never 400.

Gotchas that bite in this task:
- The public route has **no clinic context** (no JWT), so nothing on that path may call `requireClinicId()`. The displays repository and Task 4's queue
  repository take `clinicId` explicitly; the clinic comes from the display row found by `token_hash`.
- `allowPermission` does **not** auto-allow superadmin (only `checkPermission` does); that is why the key lists `"superadmin"` explicitly (Task 4).
- pg returns `bigint`/`bigint[]` as strings, PGlite as numbers → always `Number(...)`/`.map(Number)`. PGlite does not fill `rowCount`, so "did it match" checks use `RETURNING id`.
- `services/api/src/container/services.ts` and `services/api/src/routes/index.ts` have CRLF line endings in the working tree (`core.autocrlf=true`); all anchors
  below are single lines, and git normalises line endings on commit.
- `app.ts` deliberately stays without `trust proxy`: on Render (behind Cloudflare) `req.ip` is an internal proxy address, so the limiter keys on
  `CF-Connecting-IP` when it is a valid IP. Changing `trust proxy` would also change `loginRateLimit` and audit IPs — out of scope.
- `requestLogger` (morgan, mounted for every route in `app.ts`) would print the screen code of every TV poll into the Render logs. Steps 18–21 make it
  skip successful queue polls and redact the code of failed ones; the log format for all other routes stays byte-identical.
- The limiter is a module-level singleton (MemoryStore) shared by all tests in the file. The HTTP test never hammers it (≈60 requests from
  127.0.0.1 in total, limit 300); the rate-limit case uses its own `cf-connecting-ip` addresses so its buckets start fresh and the counts are exact.

- [ ] **Step 1: Write the failing test for the extracted subscription rule**

Create `services/api/src/middleware/subscriptionMiddleware.test.ts`. The first block is the new pure helper; the second block pins the
middleware's current behaviour (402 + fail-open), so it passes before and after the refactor:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
const query = vi.hoisted(() => vi.fn());
vi.mock("../config/env", () => ({ env: { isProduction: false, dataProvider: "postgres" } }));
vi.mock("../config/database", () => ({ dbPool: { query } }));
import { getSubscriptionBlock, requireActiveSubscription } from "./subscriptionMiddleware";
import { runWithClinicContext } from "../tenancy/clinicContext";

const NOW = Date.parse("2026-09-30T06:00:00Z");

describe("getSubscriptionBlock", () => {
  it.each([
    ["active without end date", { subscription_status: "active", subscription_ends_at: null }, null],
    ["trialing with a future end", { subscription_status: "trialing", subscription_ends_at: "2026-10-01T00:00:00Z" }, null],
    ["unknown status (null)", { subscription_status: null, subscription_ends_at: null }, null],
    ["unparseable end date is ignored", { subscription_status: "active", subscription_ends_at: "not a date" }, null],
    ["suspended", { subscription_status: "suspended", subscription_ends_at: null }, "suspended"],
    ["suspended wins over a past end date", { subscription_status: "suspended", subscription_ends_at: "2020-01-01T00:00:00Z" }, "suspended"],
    ["expired status", { subscription_status: "expired", subscription_ends_at: null }, "expired"],
    ["active with a past end (string)", { subscription_status: "active", subscription_ends_at: "2026-09-30T05:59:59Z" }, "expired"],
    ["active with a past end (Date)", { subscription_status: "active", subscription_ends_at: new Date("2026-09-29T00:00:00Z") }, "expired"],
    ["end exactly now is still active", { subscription_status: "active", subscription_ends_at: "2026-09-30T06:00:00Z" }, null],
  ] as const)("%s", (_label, row, expected) => {
    expect(getSubscriptionBlock(row, NOW)).toBe(expected);
  });
});

describe("requireActiveSubscription keeps its behaviour", () => {
  const run = (next: NextFunction) =>
    runWithClinicContext(1, () => requireActiveSubscription({} as Request, {} as Response, next));

  beforeEach(() => {
    query.mockReset();
  });

  it("passes an active clinic and blocks suspended/expired ones with 402", async () => {
    query.mockResolvedValueOnce({ rows: [{ subscription_status: "active", subscription_ends_at: null }] });
    const next = vi.fn();
    await run(next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM clinics"), [1]);

    query.mockResolvedValueOnce({ rows: [{ subscription_status: "suspended", subscription_ends_at: null }] });
    await expect(run(vi.fn())).rejects.toMatchObject({ status: 402, message: "Подписка приостановлена. Обратитесь к администратору." });

    query.mockResolvedValueOnce({ rows: [{ subscription_status: "active", subscription_ends_at: "2000-01-01T00:00:00Z" }] });
    await expect(run(vi.fn())).rejects.toMatchObject({ status: 402, message: "Срок подписки истёк. Продлите подписку, чтобы продолжить работу." });
  });

  it("fails open when the clinic row is missing or the query fails", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const missing = vi.fn();
    await run(missing);
    expect(missing).toHaveBeenCalledTimes(1);

    query.mockRejectedValueOnce(new Error("connection lost"));
    const failed = vi.fn();
    await run(failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/middleware/subscriptionMiddleware.test.ts`
Expected: FAIL — the 10 `getSubscriptionBlock` cases fail with `TypeError: getSubscriptionBlock is not a function`; the 2 `requireActiveSubscription` tests pass.

- [ ] **Step 3: Extract `getSubscriptionBlock` (middleware behaviour unchanged)**

`services/api/src/middleware/subscriptionMiddleware.ts` has LF line endings; three edits.

In `services/api/src/middleware/subscriptionMiddleware.ts` replace:
```ts
type SubRow = {
  subscription_status: string;
  subscription_ends_at: Date | string | null;
};
```
with:
```ts
export type SubscriptionFields = {
  subscription_status: string | null;
  subscription_ends_at: Date | string | null;
};

/**
 * Почему клиника заблокирована: "suspended" | "expired", null — подписка активна.
 * Единое правило для гейта дата-роутов и публичного ТВ-экрана очереди:
 * suspended важнее всего; expired — явный статус или дата окончания в прошлом.
 * Нераспознаваемая дата окончания игнорируется (как раньше).
 */
export function getSubscriptionBlock(row: SubscriptionFields, nowMs: number): "suspended" | "expired" | null {
  if (row.subscription_status === "suspended") {
    return "suspended";
  }
  const endsAtMs = row.subscription_ends_at
    ? new Date(row.subscription_ends_at).getTime()
    : null;
  const expiredByDate = endsAtMs != null && Number.isFinite(endsAtMs) && nowMs > endsAtMs;
  if (row.subscription_status === "expired" || expiredByDate) {
    return "expired";
  }
  return null;
}
```

In `services/api/src/middleware/subscriptionMiddleware.ts` replace:
```ts
  let row: SubRow | undefined;
  try {
    const result = await dbPool.query<SubRow>(
```
with:
```ts
  let row: SubscriptionFields | undefined;
  try {
    const result = await dbPool.query<SubscriptionFields>(
```

In `services/api/src/middleware/subscriptionMiddleware.ts` replace:
```ts
  if (row.subscription_status === "suspended") {
    throw new ApiError(402, "Подписка приостановлена. Обратитесь к администратору.");
  }

  const endsAtMs = row.subscription_ends_at
    ? new Date(row.subscription_ends_at).getTime()
    : null;
  const expiredByDate =
    endsAtMs != null && Number.isFinite(endsAtMs) && Date.now() > endsAtMs;

  if (row.subscription_status === "expired" || expiredByDate) {
    throw new ApiError(402, "Срок подписки истёк. Продлите подписку, чтобы продолжить работу.");
  }
```
with:
```ts
  const block = getSubscriptionBlock(row, Date.now());
  if (block === "suspended") {
    throw new ApiError(402, "Подписка приостановлена. Обратитесь к администратору.");
  }
  if (block === "expired") {
    throw new ApiError(402, "Срок подписки истёк. Продлите подписку, чтобы продолжить работу.");
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/middleware/subscriptionMiddleware.test.ts && npm run typecheck`
Expected: PASS (12 tests), typecheck exits 0.

- [ ] **Step 5: Write the failing test for the pure TV state builder**

Create `services/api/src/services/queue/displayState.test.ts` (pure: builds `QueueDoctorDay`/`QueueDayRow` objects by hand, no DB):

```ts
import { describe, expect, it } from "vitest";
import { buildDisplayState } from "./displayState";
import type { QueueDayRow, QueueDisplay, QueueDoctorDay, QueueEntry } from "../../repositories/interfaces/queueTypes";

const display: QueueDisplay = {
  id: 7, name: "Холл 1", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

const entry = (over: Partial<QueueEntry> & Pick<QueueEntry, "appointmentId" | "state">): QueueEntry => ({
  doctorId: 10, patientId: 100, patientName: "Каримов Алишер Бахтиёрович", number: 1, code: "К-01",
  startAt: "2026-09-30 10:00:00", issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0, ...over,
});

const doctor = (over: Partial<QueueDoctorDay> & Pick<QueueDoctorDay, "doctorId">): QueueDoctorDay => ({
  doctorName: "Алиева Нигора", specialty: "Терапевт", room: "5", prefix: "К",
  serving: null, waiting: [], missed: [], doneCount: 0, ...over,
});

const row = (over: Partial<QueueDayRow> & Pick<QueueDayRow, "appointmentId">): QueueDayRow => ({
  doctorId: 10, patientId: 100, patientName: "Каримов Алишер Бахтиёрович", status: "arrived",
  startAt: "2026-09-30 10:00:00", queueNumber: 1, queuePrefix: "К", queueDate: "2026-09-30",
  issuedAt: "2026-09-30T04:00:00.000Z", calledAt: null, callCount: 0, updatedAt: "2026-09-30T04:00:00.000Z", ...over,
});

const build = (doctors: QueueDoctorDay[], rows: QueueDayRow[] = [], showNames = true) =>
  buildDisplayState({
    serverTime: "2026-09-30T06:00:00.000Z", timeZone: "Asia/Tashkent", clinicName: "Клиника Камилова",
    display: { ...display, showNames }, doctors, rows,
  });

const called = (appointmentId: number, number: number, calledAt: string, patientName: string) =>
  entry({ appointmentId, number, code: `К-0${number}`, state: "called", calledAt, callCount: 1, patientName });
const waiting = (appointmentId: number, number: number, patientName = "Юсупова Дилноза") =>
  entry({ appointmentId, number, code: number < 10 ? `К-0${number}` : `К-${number}`, state: "waiting", patientName });

describe("buildDisplayState", () => {
  it("copies the header fields and only the public part of the display", () => {
    const state = build([]);
    expect(state).toEqual({
      serverTime: "2026-09-30T06:00:00.000Z", timeZone: "Asia/Tashkent", clinicName: "Клиника Камилова",
      display: { name: "Холл 1", language: "uz_ru", voiceEnabled: true, showNames: true },
      cabinets: [], recentCalls: [],
    });
  });

  it("shows the patient being served as current, even when someone else is already called", () => {
    const serving = entry({ appointmentId: 1, number: 1, code: "К-01", state: "serving", calledAt: "2026-09-30T05:00:00.000Z", callCount: 1 });
    const state = build([doctor({ doctorId: 10, serving, waiting: [called(2, 2, "2026-09-30T05:50:00.000Z", "Юсупова Дилноза")] })]);
    expect(state.cabinets[0].current).toEqual({ code: "К-01", name: "Алишер К.", state: "serving" });
  });

  it("keeps a serving patient without a ticket as current with a null code", () => {
    const serving = entry({ appointmentId: 1, number: null, code: null, state: "serving", issuedAt: null });
    expect(build([doctor({ doctorId: 10, serving })]).cabinets[0].current).toEqual({ code: null, name: "Алишер К.", state: "serving" });
  });

  it("falls back to the most recently called patient, then to null", () => {
    const early = called(2, 2, "2026-09-30T05:30:00.000Z", "Юсупова Дилноза");
    const late = called(3, 3, "2026-09-30T05:55:00.000Z", "Ахмедов Бобур");
    const state = build([
      doctor({ doctorId: 10, waiting: [early, late, waiting(4, 4)] }),
      doctor({ doctorId: 11, room: "6", waiting: [waiting(5, 1)] }),
    ]);
    expect(state.cabinets[0].current).toEqual({ code: "К-03", name: "Бобур А.", state: "called" });
    expect(state.cabinets[1].current).toBeNull();
  });

  it("lists the first five waiting patients by number, counts all of them and skips called ones", () => {
    const list = [9, 3, 8, 4, 7, 5, 6].map((n) => waiting(100 + n, n));
    const state = build([doctor({ doctorId: 10, waiting: [called(2, 2, "2026-09-30T05:50:00.000Z", "Ахмедов Бобур"), ...list] })]);
    expect(state.cabinets[0].waiting.map((w) => w.code)).toEqual(["К-03", "К-04", "К-05", "К-06", "К-07"]);
    expect(state.cabinets[0].waiting[0]).toEqual({ code: "К-03", name: "Дилноза Ю." });
    expect(state.cabinets[0].waitingCount).toBe(7);
  });

  it("hides every name when showNames is off", () => {
    const serving = entry({ appointmentId: 1, state: "serving" });
    const state = build(
      [doctor({ doctorId: 10, serving, waiting: [waiting(4, 4)] })],
      [row({ appointmentId: 1, status: "in_consultation", calledAt: "2026-09-30T05:00:00.000Z", callCount: 1 })],
      false
    );
    expect(state.display.showNames).toBe(false);
    expect(state.cabinets[0].current?.name).toBeNull();
    expect(state.cabinets[0].waiting[0].name).toBeNull();
    expect(state.recentCalls[0].name).toBeNull();
    expect(JSON.stringify(state)).not.toContain("Алишер");
  });

  it("orders cabinets by room: numbers ascending, then text rooms, then no room", () => {
    const state = build([
      doctor({ doctorId: 1, doctorName: "Ахмедов", room: null }),
      doctor({ doctorId: 2, doctorName: "Бобоев", room: "12" }),
      doctor({ doctorId: 3, doctorName: "Гуляев", room: "Лаб" }),
      doctor({ doctorId: 4, doctorName: "Валиев", room: "3" }),
    ]);
    expect(state.cabinets.map((c) => c.doctorId)).toEqual([4, 2, 3, 1]);
    expect(state.cabinets[0]).toEqual({
      doctorId: 4, doctorName: "Валиев", specialty: "Терапевт", room: "3", current: null, waiting: [], waitingCount: 0,
    });
  });

  it("builds recent calls newest first with a key per call, max 20, without cancelled or unnumbered rows", () => {
    const rows: QueueDayRow[] = [];
    for (let i = 0; i < 22; i += 1) {
      rows.push(row({
        appointmentId: 500 + i, queueNumber: i + 1, status: i % 2 ? "arrived" : "completed",
        calledAt: new Date(Date.parse("2026-09-30T04:00:00.000Z") + i * 60_000).toISOString(), callCount: 1,
      }));
    }
    rows.push(row({ appointmentId: 900, queueNumber: 30, status: "cancelled", calledAt: "2026-09-30T05:59:00.000Z", callCount: 1 }));
    rows.push(row({ appointmentId: 901, queueNumber: null, status: "in_consultation", calledAt: "2026-09-30T05:58:00.000Z", callCount: 1 }));
    rows.push(row({ appointmentId: 902, queueNumber: 31, status: "arrived", calledAt: null }));
    rows.push(row({ appointmentId: 903, doctorId: 99, queueNumber: 3, queuePrefix: null, calledAt: "2026-09-30T05:57:00.000Z", callCount: 2 }));

    const state = build([doctor({ doctorId: 10 })], rows);
    expect(state.recentCalls).toHaveLength(20);
    expect(state.recentCalls[0]).toEqual({
      key: "903:2", code: "03", number: 3, name: "Алишер К.", room: null, doctorName: "", calledAt: "2026-09-30T05:57:00.000Z",
    });
    expect(state.recentCalls[1]).toEqual({
      key: "521:1", code: "К-22", number: 22, name: "Алишер К.", room: "5", doctorName: "Алиева Нигора", calledAt: "2026-09-30T04:21:00.000Z",
    });
    expect(state.recentCalls.map((c) => c.key)).not.toContain("900:1");
    expect(state.recentCalls.map((c) => c.key)).not.toContain("901:1");
    expect(state.recentCalls[19].key).toBe("503:1");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/services/queue/displayState.test.ts`
Expected: FAIL with `Error: Cannot find module './displayState'`.

- [ ] **Step 7: Implement `displayState.ts`**

Create `services/api/src/services/queue/displayState.ts`. It re-sorts cabinets with `compareCabinets` and waiting entries by number itself, so it does
not depend on the caller's order; names go through `maskPatientName` or become `null`:

```ts
import type {
  QueueDayRow,
  QueueDisplay,
  QueueDisplayCabinet,
  QueueDisplayCall,
  QueueDisplayState,
  QueueDoctorDay,
  QueueEntry,
} from "../../repositories/interfaces/queueTypes";
import { compareCabinets, formatQueueCode, maskPatientName } from "./queueRules";

/** Сколько ждущих показывает карточка кабинета на ТВ. */
export const DISPLAY_WAITING_LIMIT = 5;
/** Сколько последних вызовов уходит на ТВ (лента + обнаружение новых вызовов). */
export const DISPLAY_RECENT_CALLS_LIMIT = 20;

const instantMs = (iso: string | null): number => (iso ? Date.parse(iso) : 0);
const byNumber = (a: QueueEntry, b: QueueEntry): number => (a.number ?? 0) - (b.number ?? 0);

/**
 * Публичное состояние ТВ-экрана. Чистая функция: на вход — очередь дня (QueueDoctorDay + сырые строки),
 * на выход — только то, что можно показать в холле. Полное ФИО, телефоны, id пациентов сюда не попадают:
 * имя маскируется ("Имя Ф.") или скрывается целиком (showNames = false).
 */
export function buildDisplayState(input: {
  serverTime: string;
  timeZone: string;
  clinicName: string;
  display: QueueDisplay;
  doctors: QueueDoctorDay[];
  rows: QueueDayRow[];
}): QueueDisplayState {
  const { display } = input;
  const nameOf = (fullName: string): string | null => (display.showNames ? maskPatientName(fullName) : null);

  const cabinets: QueueDisplayCabinet[] = [...input.doctors].sort(compareCabinets).map((doctor) => {
    const latestCalled =
      doctor.waiting
        .filter((entry) => entry.state === "called")
        .sort((a, b) => instantMs(b.calledAt) - instantMs(a.calledAt))[0] ?? null;
    const current: QueueDisplayCabinet["current"] = doctor.serving
      ? { code: doctor.serving.code, name: nameOf(doctor.serving.patientName), state: "serving" }
      : latestCalled
        ? { code: latestCalled.code, name: nameOf(latestCalled.patientName), state: "called" }
        : null;
    const waiting = doctor.waiting.filter((entry) => entry.state === "waiting").sort(byNumber);
    return {
      doctorId: doctor.doctorId,
      doctorName: doctor.doctorName,
      specialty: doctor.specialty,
      room: doctor.room,
      current,
      waiting: waiting
        .slice(0, DISPLAY_WAITING_LIMIT)
        .map((entry) => ({ code: entry.code ?? String(entry.number ?? ""), name: nameOf(entry.patientName) })),
      waitingCount: waiting.length,
    };
  });

  const doctorById = new Map(input.doctors.map((doctor) => [doctor.doctorId, doctor]));
  const recentCalls: QueueDisplayCall[] = input.rows
    .filter((row) => row.calledAt != null && row.queueNumber != null && row.status !== "cancelled")
    .sort((a, b) => instantMs(b.calledAt) - instantMs(a.calledAt))
    .slice(0, DISPLAY_RECENT_CALLS_LIMIT)
    .map((row) => {
      const doctor = doctorById.get(row.doctorId);
      const queueNumber = row.queueNumber as number;
      return {
        key: `${row.appointmentId}:${row.callCount}`,
        code: formatQueueCode(row.queuePrefix, queueNumber),
        number: queueNumber,
        name: nameOf(row.patientName),
        room: doctor?.room ?? null,
        doctorName: doctor?.doctorName ?? "",
        calledAt: row.calledAt as string,
      };
    });

  return {
    serverTime: input.serverTime,
    timeZone: input.timeZone,
    clinicName: input.clinicName,
    display: {
      name: display.name,
      language: display.language,
      voiceEnabled: display.voiceEnabled,
      showNames: display.showNames,
    },
    cabinets,
    recentCalls,
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/services/queue/displayState.test.ts && npm run typecheck`
Expected: PASS (8 tests), typecheck exits 0.

- [ ] **Step 9: Write the failing HTTP test (PGlite) for display management and the public endpoint**

Create `services/api/src/repositories/postgres/queueDisplays.test.ts`. It follows `PostgresQuestionnairesRepository.test.ts`: one PGlite, a promise gate
so `query`/`connect` never interleave (inside a transaction code must use only the client, or the gate deadlocks), `vi.mock` of env, container
(getters, evaluated lazily) and database (both `query` and `connect`). Stub tables are created **before** 033 and 035 run, because 035 alters
`doctors`/`appointments` and references `clinics`/`users`. `SET TIME ZONE` to Node's zone makes the `start_at` wall-clock literals
land exactly where the app writes them. The fixed clock `2026-09-30T06:00:00Z` is 11:00 in Tashkent, day `2026-09-30`.
Fixture map (queue columns are written directly; Task 4's repository only reads them): doctor 10 (room "5", letter К) — 1000 serving К-01,
1001 called twice К-02, 1002–1007 waiting К-03…К-08, 1008 cancelled after a call (must vanish); doctor 11 (room "3", no letter) — 1100/1101
called 01/02 (latest = 02); doctor 12 (no room) — only yesterday's 1200; clinic 2 — 2000. Patient surnames differ from doctor surnames so the
"no surname leaks" check cannot hit a doctor name.

```ts
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
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/repositories/postgres/queueDisplays.test.ts`
Expected: FAIL with `Error: Cannot find module './PostgresQueueDisplaysRepository'`.

- [ ] **Step 11: Check the Task 4 files this task extends**

Run:
```bash
cd services/api && grep -n 'from "express"\|from "../container"\|from "../utils/requestAuth"' src/controllers/queueController.ts \
  && grep -n '^import { Router } from "express";\|asyncHandler } from\|^export { router as queueRouter };' src/routes/queueRoutes.ts \
  && grep -n 'QUEUE_DISPLAY_MANAGE' src/auth/permissions.ts \
  && grep -n 'queue: new QueueService(queueRepository, env.reportsTimezone),' src/container/services.ts
```
Expected: 3 lines for `queueController.ts` (the `Request`/`Response` import, `services`, `getAuthPayload`), 3 lines for `queueRoutes.ts`
(the `Router` import on line 1, the `asyncHandler` import, the final export), at least 1 line in `permissions.ts`, 1 line in `services.ts`. If line 1 of
`queueRoutes.ts` is not `import { Router } from "express";`, put the Step 16 import block directly below the file's last `import` statement instead
of using that anchor. The appended controllers below add no imports and rely on exactly those three bindings; if one of the
three `queueController.ts` imports is missing, add the missing line(s) at the top of that file:
`import type { Request, Response } from "express";` / `import { services } from "../container";` / `import { getAuthPayload } from "../utils/requestAuth";`.

- [ ] **Step 12: Create the displays repository**

Create `services/api/src/repositories/postgres/PostgresQueueDisplaysRepository.ts`. `token_hash` and `revoked_at` are never selected into a
`QueueDisplay`; `findByTokenHash` is the only unscoped query and joins `clinics` for the name and subscription fields:

```ts
import type {
  IQueueDisplaysRepository,
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayLanguage,
  QueueDisplayLookup,
} from "../interfaces/queueTypes";
import type { QueryPool } from "./queryPool";

type DisplayRow = {
  id: number | string;
  name: string;
  doctor_ids: Array<number | string> | null;
  show_names: boolean;
  language: string;
  voice_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type LookupRow = DisplayRow & {
  clinic_id: number | string;
  clinic_name: string | null;
  subscription_status: string | null;
  subscription_ends_at: Date | string | null;
};

// token_hash и revoked_at наружу не отдаются никогда.
const COLUMNS = "id, name, doctor_ids, show_names, language, voice_enabled, created_at, updated_at";

// pg отдаёт bigint и bigint[] строками, PGlite — числами: всегда Number(...).
const mapDisplay = (row: DisplayRow): QueueDisplay => ({
  id: Number(row.id),
  name: row.name,
  doctorIds: row.doctor_ids == null ? null : row.doctor_ids.map(Number),
  showNames: row.show_names === true,
  language: row.language as QueueDisplayLanguage,
  voiceEnabled: row.voice_enabled === true,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export class PostgresQueueDisplaysRepository implements IQueueDisplaysRepository {
  constructor(private readonly pool: QueryPool) {}

  async list(clinicId: number): Promise<QueueDisplay[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM queue_displays WHERE clinic_id = $1 AND revoked_at IS NULL ORDER BY id`,
      [clinicId]
    );
    return result.rows.map((row) => mapDisplay(row as DisplayRow));
  }

  async create(clinicId: number, input: QueueDisplayInput, tokenHash: string, createdBy: number | null): Promise<QueueDisplay> {
    const result = await this.pool.query(
      `INSERT INTO queue_displays (clinic_id, name, token_hash, doctor_ids, show_names, language, voice_enabled, created_by)
       VALUES ($1, $2, $3, $4::bigint[], $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [clinicId, input.name, tokenHash, input.doctorIds, input.showNames, input.language, input.voiceEnabled, createdBy]
    );
    return mapDisplay(result.rows[0] as DisplayRow);
  }

  async update(clinicId: number, id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay | null> {
    const params: unknown[] = [clinicId, id];
    const sets: string[] = [];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.doctorIds !== undefined) set("doctor_ids", patch.doctorIds, "::bigint[]");
    if (patch.showNames !== undefined) set("show_names", patch.showNames);
    if (patch.language !== undefined) set("language", patch.language);
    if (patch.voiceEnabled !== undefined) set("voice_enabled", patch.voiceEnabled);
    sets.push("updated_at = now()");
    const result = await this.pool.query(
      `UPDATE queue_displays SET ${sets.join(", ")}
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      params
    );
    return result.rows[0] ? mapDisplay(result.rows[0] as DisplayRow) : null;
  }

  async revoke(clinicId: number, id: number): Promise<boolean> {
    // RETURNING вместо rowCount: PGlite не заполняет rowCount.
    const result = await this.pool.query(
      `UPDATE queue_displays SET revoked_at = now(), updated_at = now()
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [clinicId, id]
    );
    return result.rows.length > 0;
  }

  async rotate(clinicId: number, id: number, tokenHash: string): Promise<QueueDisplay | null> {
    const result = await this.pool.query(
      `UPDATE queue_displays SET token_hash = $3, updated_at = now()
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      [clinicId, id, tokenHash]
    );
    return result.rows[0] ? mapDisplay(result.rows[0] as DisplayRow) : null;
  }

  /** Публичный поиск экрана по хешу кода — без clinic-контекста (ТВ не авторизован). */
  async findByTokenHash(tokenHash: string): Promise<QueueDisplayLookup | null> {
    const result = await this.pool.query(
      `SELECT qd.id, qd.name, qd.doctor_ids, qd.show_names, qd.language, qd.voice_enabled, qd.created_at, qd.updated_at,
              qd.clinic_id, c.name AS clinic_name, c.subscription_status, c.subscription_ends_at
       FROM queue_displays qd
       JOIN clinics c ON c.id = qd.clinic_id
       WHERE qd.token_hash = $1 AND qd.revoked_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0] as LookupRow | undefined;
    if (!row) {
      return null;
    }
    return {
      display: mapDisplay(row),
      clinicId: Number(row.clinic_id),
      clinicName: row.clinic_name?.trim() || "Клиника",
      subscriptionStatus: row.subscription_status ?? null,
      subscriptionEndsAt: row.subscription_ends_at == null ? null : new Date(row.subscription_ends_at).toISOString(),
    };
  }

  async existingDoctorIds(clinicId: number, doctorIds: number[]): Promise<number[]> {
    if (doctorIds.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT id FROM doctors WHERE clinic_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
      [clinicId, doctorIds]
    );
    return result.rows.map((row) => Number((row as { id: number | string }).id));
  }
}
```

- [ ] **Step 13: Create the displays service**

Create `services/api/src/services/queueDisplaysService.ts`. Cheap field checks run before the doctor lookup in the DB; the code is generated
here, only its sha256 goes to the repository, and the formatted code is returned once:

```ts
import { ApiError } from "../middleware/errorHandler";
import { getSubscriptionBlock } from "../middleware/subscriptionMiddleware";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import type {
  IQueueDisplaysRepository,
  IQueueRepository,
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayLanguage,
  QueueDisplayState,
  QueueDisplayWithCode,
} from "../repositories/interfaces/queueTypes";
import { formatDisplayCode, generateDisplayCode, hashDisplayCode, normalizeDisplayCode } from "./queue/displayCode";
import { buildDisplayState } from "./queue/displayState";
import { loadQueueDay } from "./queue/queueDay";
import { clinicToday } from "./queue/queueRules";

type Body = Record<string, unknown>;
const asBody = (body: unknown): Body =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};

const DISPLAY_LANGUAGES: readonly QueueDisplayLanguage[] = ["uz", "ru", "uz_ru"];
const NOT_FOUND = "Экран не найден";

const parseName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  const length = [...name].length;
  if (length < 1 || length > 100) {
    throw new ApiError(400, "Название экрана: от 1 до 100 символов");
  }
  return name;
};

const parseBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new ApiError(400, `Поле '${field}' должно быть true или false`);
  }
  return value;
};

const parseLanguage = (value: unknown): QueueDisplayLanguage => {
  if (typeof value !== "string" || !DISPLAY_LANGUAGES.includes(value as QueueDisplayLanguage)) {
    throw new ApiError(400, "Язык экрана: uz, ru или uz_ru");
  }
  return value as QueueDisplayLanguage;
};

/** id из URL: не положительное целое → такого экрана нет (404), в БД не ходим. */
const assertDisplayId = (id: number): void => {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(404, NOT_FOUND);
  }
};

export class QueueDisplaysService {
  constructor(
    private readonly displays: IQueueDisplaysRepository,
    private readonly queue: IQueueRepository,
    private readonly timeZone: string = "Asia/Tashkent",
    private readonly now: () => Date = () => new Date()
  ) {}

  list(auth: AuthTokenPayload): Promise<QueueDisplay[]> {
    return this.displays.list(auth.clinicId);
  }

  async create(auth: AuthTokenPayload, body: unknown): Promise<QueueDisplayWithCode> {
    const b = asBody(body);
    const name = parseName(b.name);
    const showNames = b.showNames === undefined ? true : parseBoolean(b.showNames, "showNames");
    const language = b.language === undefined ? "uz_ru" : parseLanguage(b.language);
    const voiceEnabled = b.voiceEnabled === undefined ? true : parseBoolean(b.voiceEnabled, "voiceEnabled");
    // Проверка врачей идёт в БД — последней, после дешёвых проверок.
    const doctorIds = await this.parseDoctorIds(auth.clinicId, b.doctorIds ?? null);
    const input: QueueDisplayInput = { name, doctorIds, showNames, language, voiceEnabled };
    // Код показывается один раз; в БД только sha256 канонической формы.
    const canonical = generateDisplayCode();
    const display = await this.displays.create(auth.clinicId, input, hashDisplayCode(canonical), auth.userId);
    return { display, code: formatDisplayCode(canonical) };
  }

  async update(auth: AuthTokenPayload, id: number, body: unknown): Promise<QueueDisplay> {
    assertDisplayId(id);
    const b = asBody(body);
    const patch: Partial<QueueDisplayInput> = {};
    if (b.name !== undefined) patch.name = parseName(b.name);
    if (b.showNames !== undefined) patch.showNames = parseBoolean(b.showNames, "showNames");
    if (b.language !== undefined) patch.language = parseLanguage(b.language);
    if (b.voiceEnabled !== undefined) patch.voiceEnabled = parseBoolean(b.voiceEnabled, "voiceEnabled");
    if (b.doctorIds !== undefined) patch.doctorIds = await this.parseDoctorIds(auth.clinicId, b.doctorIds);
    const updated = await this.displays.update(auth.clinicId, id, patch);
    if (!updated) {
      throw new ApiError(404, NOT_FOUND);
    }
    return updated;
  }

  async remove(auth: AuthTokenPayload, id: number): Promise<{ success: true; id: number }> {
    assertDisplayId(id);
    if (!(await this.displays.revoke(auth.clinicId, id))) {
      throw new ApiError(404, NOT_FOUND);
    }
    return { success: true, id };
  }

  async rotate(auth: AuthTokenPayload, id: number): Promise<QueueDisplayWithCode> {
    assertDisplayId(id);
    const canonical = generateDisplayCode();
    const display = await this.displays.rotate(auth.clinicId, id, hashDisplayCode(canonical));
    if (!display) {
      throw new ApiError(404, NOT_FOUND);
    }
    return { display, code: formatDisplayCode(canonical) };
  }

  /** Публичное состояние ТВ по коду экрана. Клиника берётся из самого экрана, не из токена. */
  async publicState(code: string): Promise<QueueDisplayState> {
    const canonical = normalizeDisplayCode(code);
    if (!canonical) {
      throw new ApiError(404, NOT_FOUND);
    }
    const lookup = await this.displays.findByTokenHash(hashDisplayCode(canonical));
    if (!lookup) {
      throw new ApiError(404, NOT_FOUND);
    }
    const now = this.now();
    const block = getSubscriptionBlock(
      { subscription_status: lookup.subscriptionStatus, subscription_ends_at: lookup.subscriptionEndsAt },
      now.getTime()
    );
    if (block) {
      throw new ApiError(403, "Подписка клиники неактивна");
    }
    const day = clinicToday(this.timeZone, now);
    const { rows, doctors } = await loadQueueDay(
      this.queue,
      lookup.clinicId,
      day,
      lookup.display.doctorIds,
      lookup.display.doctorIds ?? []
    );
    return buildDisplayState({
      serverTime: now.toISOString(),
      timeZone: this.timeZone,
      clinicName: lookup.clinicName,
      display: lookup.display,
      doctors,
      rows,
    });
  }

  /** null/[] → «все врачи с очередью сегодня»; иначе уникальные id, и каждый должен быть врачом этой клиники. */
  private async parseDoctorIds(clinicId: number, value: unknown): Promise<number[] | null> {
    if (value === null) {
      return null;
    }
    if (!Array.isArray(value) || !value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      throw new ApiError(400, "Поле 'doctorIds' должно быть списком id врачей или null");
    }
    const ids = [...new Set(value as number[])];
    if (ids.length === 0) {
      return null;
    }
    const existing = new Set(await this.displays.existingDoctorIds(clinicId, ids));
    if (!ids.every((id) => existing.has(id))) {
      throw new ApiError(400, "Неизвестный врач в списке экрана");
    }
    return ids;
  }
}
```

- [ ] **Step 14: Create the public rate limiter and the public router**

Create `services/api/src/middleware/publicRateLimit.ts` (express-rate-limit 8.3.2 exports `rateLimit` and `ipKeyGenerator`; `limit` replaces the
deprecated `max`; a custom `keyGenerator` that reads `request.ip` must call `ipKeyGenerator`, otherwise the library logs `ERR_ERL_KEY_GEN_IPV6`):

```ts
import { isIP } from "node:net";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

/**
 * Лимит публичного ТВ-эндпоинта: 300 запросов в минуту на IP (ТВ опрашивает раз в 2 с = 30/мин).
 * trust proxy в app.ts не включён, поэтому req.ip на Render — адрес внутреннего прокси, общий для всех.
 * Реальный IP клиента берём из CF-Connecting-IP (Render стоит за Cloudflare), если это валидный IP;
 * иначе — req.ip. ipKeyGenerator сворачивает IPv6 в подсеть /56 (так требует express-rate-limit v8).
 */
export const publicQueueDisplayRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Повторите позже." },
  keyGenerator: (request) => {
    const cf = request.headers["cf-connecting-ip"];
    const ip = typeof cf === "string" && isIP(cf) ? cf : request.ip ?? "";
    return ipKeyGenerator(ip);
  },
});
```

Create `services/api/src/routes/publicRoutes.ts`:

```ts
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { publicQueueDisplayRateLimit } from "../middleware/publicRateLimit";
import { getPublicQueueDisplayController } from "../controllers/queueController";

// Публичные эндпоинты: без requireAuth и без гейта подписки (ТВ в холле не входит в систему).
// Доступ — только по коду экрана; подписку клиники экрана проверяет сервис (403).
const router = Router();

router.get("/queue-display/:code", publicQueueDisplayRateLimit, asyncHandler(getPublicQueueDisplayController));

export { router as publicRouter };
```

- [ ] **Step 15: Append the display controllers**

Append this block at the very end of `services/api/src/controllers/queueController.ts` (after the last controller Task 4 wrote; nothing existing changes, no new imports — it uses the `Request`/`Response`, `services` and `getAuthPayload` bindings checked in Step 11):
```ts
// ---------- ТВ-экраны очереди (управление — только superadmin) ----------

export const listQueueDisplaysController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.list(auth));
};

export const createQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.queueDisplays.create(auth, req.body));
};

export const updateQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.update(auth, Number(req.params.id), req.body));
};

export const deleteQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.remove(auth, Number(req.params.id)));
};

export const rotateQueueDisplayCodeController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.rotate(auth, Number(req.params.id)));
};

/** Публичный ТВ-эндпоинт: без авторизации. no-store ставится до сервиса, чтобы и 404/403 не кэшировались. */
export const getPublicQueueDisplayController = async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  return res.status(200).json(await services.queueDisplays.publicState(String(req.params.code ?? "")));
};
```

- [ ] **Step 16: Add the display routes to the queue router**

In `services/api/src/routes/queueRoutes.ts` (first line of the file Task 4 created; every routes file in the repo starts with it) replace:
```ts
import { Router } from "express";
```
with:
```ts
import { Router } from "express";
// Отдельный алиас: импорт не конфликтует с тем, что уже импортировано из permissionMiddleware ниже.
import { allowPermission as allowQueuePermission } from "../middleware/permissionMiddleware";
import {
  createQueueDisplayController,
  deleteQueueDisplayController,
  listQueueDisplaysController,
  rotateQueueDisplayCodeController,
  updateQueueDisplayController,
} from "../controllers/queueController";
```

The alias `allowQueuePermission` keeps this import from clashing with whatever Task 4 already imports from `permissionMiddleware`
(TypeScript rejects a second binding named `allowPermission`).

In `services/api/src/routes/queueRoutes.ts` (the last line of the file; the contract fixes it for Task 4) replace:
```ts
export { router as queueRouter };
```
with:
```ts
// ТВ-экраны: только superadmin. allowPermission не пропускает superadmin автоматически — он указан в QUEUE_DISPLAY_MANAGE явно.
router.get("/displays", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(listQueueDisplaysController));
router.post("/displays", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(createQueueDisplayController));
router.patch("/displays/:id", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(updateQueueDisplayController));
router.delete("/displays/:id", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(deleteQueueDisplayController));
router.post(
  "/displays/:id/rotate-code",
  allowQueuePermission("QUEUE_DISPLAY_MANAGE"),
  asyncHandler(rotateQueueDisplayCodeController)
);

export { router as queueRouter };
```

- [ ] **Step 17: Wire the service into the container and mount the public router**

The controllers from Step 15 read `services.queueDisplays`, so the typecheck stays red until this step is done.

In `services/api/src/container/services.ts` (original line, left intact by Task 4) replace:
```ts
import { dbPool } from "../config/database";
```
with:
```ts
import { QueueDisplaysService } from "../services/queueDisplaysService";
import { PostgresQueueDisplaysRepository } from "../repositories/postgres/PostgresQueueDisplaysRepository";
import { dbPool } from "../config/database";
```

In `services/api/src/container/services.ts` (the entry Task 4 added, fixed by the contract) replace:
```ts
  queue: new QueueService(queueRepository, env.reportsTimezone),
```
with:
```ts
  queue: new QueueService(queueRepository, env.reportsTimezone),
  queueDisplays: new QueueDisplaysService(
    new PostgresQueueDisplaysRepository(dbPool),
    queueRepository,
    env.reportsTimezone
  ),
```

In `services/api/src/routes/index.ts` (original line; Task 4 adds its own `queueRouter` import next to it and leaves this line intact) replace:
```ts
import { questionnairesRouter } from "./questionnairesRoutes";
```
with:
```ts
import { questionnairesRouter } from "./questionnairesRoutes";
import { publicRouter } from "./publicRoutes";
```

In `services/api/src/routes/index.ts` (original line) replace:
```ts
router.use("/auth", authRouter);
```
with:
```ts
router.use("/auth", authRouter);
// Публичные эндпоинты (ТВ-экран очереди): без requireAuth и без гейта подписки — проверки внутри, по коду экрана.
router.use("/public", publicRouter);
```

`/public` is mounted without `requireAuth` and without `subscriptionGuard` on purpose: the TV has no token; the service itself answers 404/403.

- [ ] **Step 18: Write the failing request-log test**

`app.ts` mounts `requestLogger` (morgan: `"tiny"` in production, `"dev"` locally) in front of every route, and it logs each URL. Every TV poll would
therefore write the secret screen code `/api/public/queue-display/<CODE>` into the Render logs, about 43 000 lines per TV per day. The staff page adds
`GET /api/queue/today` every 5 s on top. Create `services/api/src/middleware/requestLogger.test.ts`. The first two blocks test the pure helpers.
The third block runs the real `requestLogger` in the production format behind a throwaway Express app and captures `process.stdout.write`, which is
morgan's default stream:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
// Production format ("tiny"), as on Render.
vi.mock("../config/env", () => ({ env: { isProduction: true } }));
import { redactLoggedUrl, requestLogger, shouldSkipRequestLog } from "./requestLogger";

const CODE = "K7M2Q-9XR4P";

describe("shouldSkipRequestLog", () => {
  it.each([
    ["GET", `/api/public/queue-display/${CODE}`, 200, true],
    ["GET", `/api/public/queue-display/${CODE}?t=1`, 304, true],
    ["GET", `/API/Public/Queue-Display/${CODE}`, 200, true], // Express matches paths case-insensitively
    ["GET", "/api/queue/today", 200, true],
    ["GET", "/api/queue/today?doctorId=10", 200, true],
    ["GET", `/api/public/queue-display/${CODE}`, 404, false], // failures are always logged
    ["GET", `/api/public/queue-display/${CODE}`, 429, false],
    ["GET", "/api/queue/today?doctorId=11", 403, false],
    ["GET", "/api/queue/today", 500, false],
    ["POST", "/api/queue/today", 200, false], // only GET polls are skipped
    ["HEAD", `/api/public/queue-display/${CODE}`, 200, false],
    ["POST", "/api/queue/doctors/10/call-next", 200, false],
    ["GET", "/api/queue/today/extra", 200, false],
    ["GET", "/api/queue/todays", 200, false],
    ["GET", "/api/queue/displays", 200, false],
    ["GET", "/api/public/queue-display", 200, false], // no code segment: not the TV poll
    ["GET", "/api/appointments?date=2026-09-30", 200, false],
    ["GET", "/health", 200, false],
  ] as Array<[string, string, number, boolean]>)("%s %s %d → %s", (method, url, status, expected) => {
    expect(shouldSkipRequestLog(method, url, status)).toBe(expected);
  });
});

describe("redactLoggedUrl", () => {
  it.each([
    [`/api/public/queue-display/${CODE}`, "/api/public/queue-display/***"],
    ["/api/public/queue-display/k7m2q%209xr4p?lang=ru", "/api/public/queue-display/***"], // the query goes too
    [`/api/public/queue-display/${CODE}/extra`, "/api/public/queue-display/***"],
    [`/API/PUBLIC/QUEUE-DISPLAY/${CODE}`, "/API/PUBLIC/QUEUE-DISPLAY/***"],
    ["/api/queue/today?doctorId=10", "/api/queue/today?doctorId=10"], // every other URL is unchanged
    ["/api/queue/displays/7/rotate-code", "/api/queue/displays/7/rotate-code"],
    ["/api/patients?search=%D0%9A", "/api/patients?search=%D0%9A"],
    ["/api/public/queue-display", "/api/public/queue-display"],
  ])("%s → %s", (url, expected) => {
    expect(redactLoggedUrl(url)).toBe(expected);
  });
});

describe("requestLogger (production format)", () => {
  const lines: string[] = [];
  let server: Server;
  let root: string;

  beforeAll(async () => {
    // morgan writes to process.stdout: capture it for this block only.
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const app = express();
    app.use(requestLogger);
    app.get("/api/public/queue-display/:code", (req, res) => {
      res.status(req.params.code === CODE ? 200 : 404).json({});
    });
    app.get("/api/queue/today", (req, res) => {
      res.status(req.query.doctorId === "11" ? 403 : 200).json({});
    });
    app.get("/api/patients", (_req, res) => {
      res.status(200).json([]);
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((done) => server.once("listening", done));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((done) => server.close(() => done()));
  });

  const get = async (path: string) => (await fetch(`${root}${path}`)).status;
  /** morgan writes when the response has finished, which can be a moment after the client has read it. */
  const waitForLine = async (start: string) => {
    for (let i = 0; i < 200 && !lines.some((line) => line.startsWith(start)); i += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
    return lines.find((line) => line.startsWith(start));
  };

  it("skips successful queue polls, redacts the screen code of a failed one and logs other requests as before", async () => {
    expect(await get(`/api/public/queue-display/${CODE}`)).toBe(200); // skipped
    expect(await get("/api/queue/today?doctorId=10")).toBe(200); // skipped
    expect(await get("/api/public/queue-display/22222-22222")).toBe(404);
    expect(await get("/api/queue/today?doctorId=11")).toBe(403);
    expect(await get("/api/patients?search=abc")).toBe(200);

    // The unchanged morgan "tiny" format: ":method :url :status :res[content-length] - :response-time ms".
    expect(await waitForLine("GET /api/public/queue-display/*** ")).toMatch(/^GET \/api\/public\/queue-display\/\*\*\* 404 2 - \d+\.\d{3} ms\n$/);
    expect(await waitForLine("GET /api/queue/today?doctorId=11 ")).toMatch(/^GET \/api\/queue\/today\?doctorId=11 403 2 - \d+\.\d{3} ms\n$/);
    expect(await waitForLine("GET /api/patients?search=abc ")).toMatch(/^GET \/api\/patients\?search=abc 200 2 - \d+\.\d{3} ms\n$/);
    expect(lines).toHaveLength(3);
    expect(lines.join("")).not.toContain(CODE);
    expect(lines.join("")).not.toContain("22222");
  });
});
```

- [ ] **Step 19: Run the test to verify it fails**

Run: `cd services/api && npx vitest run src/middleware/requestLogger.test.ts`
Expected: FAIL — `Tests 27 failed (27)`. The 18 `shouldSkipRequestLog` cases fail with `TypeError: shouldSkipRequestLog is not a function` and the 8 `redactLoggedUrl` cases with `TypeError: redactLoggedUrl is not a function`. The HTTP test waits about 2 s for a redacted line that never comes, then fails with `TypeError: .toMatch() expects to receive a string, but got undefined`, because today's logger writes the raw URL with the code.

- [ ] **Step 20: Skip successful queue polls and redact the screen code**

`morgan.token` with the name of an existing token replaces it (documented in the morgan README), so `:url` is redefined once here and the `"tiny"`/`"dev"` formats stay as they are. For every other route the token returns `req.originalUrl || req.url` exactly as before, so those log lines do not change by a single byte. `skip` runs when the response has finished, so `res.statusCode` is final there. The path checks ignore case because Express routes paths case-insensitively: `/API/PUBLIC/QUEUE-DISPLAY/<code>` reaches the same handler.

In `services/api/src/middleware/requestLogger.ts` replace:
```ts
/** Dev: цветной; production: компактная строка без лишнего шума. */
export const requestLogger = morgan(env.isProduction ? "tiny" : "dev");
```
with:
```ts
/** Опрос ТВ-экрана очереди: всё после этого префикса — секретный код экрана. Express сравнивает пути без учёта регистра. */
const QUEUE_DISPLAY_URL = /^\/api\/public\/queue-display\//i;
/** Опрос страницы «Очередь» сотрудниками (каждые 5 с). */
const QUEUE_TODAY_PATH = "/api/queue/today";

/**
 * true — строку в лог не пишем: успешный (status < 400) GET-опрос очереди. ТВ опрашивает каждые 2 с
 * (≈ 43 тыс. строк в сутки на экран, и в URL — код экрана), страница «Очередь» — каждые 5 с. Ошибки пишутся всегда.
 */
export function shouldSkipRequestLog(method: string, originalUrl: string, statusCode: number): boolean {
  if (method !== "GET" || statusCode >= 400) {
    return false;
  }
  const path = originalUrl.split("?")[0];
  return QUEUE_DISPLAY_URL.test(path) || path.toLowerCase() === QUEUE_TODAY_PATH;
}

/** URL для лога: код ТВ-экрана и всё после него → "***"; остальные URL без изменений. */
export function redactLoggedUrl(originalUrl: string): string {
  const prefix = QUEUE_DISPLAY_URL.exec(originalUrl);
  return prefix ? `${prefix[0]}***` : originalUrl;
}

// morgan.token с именем существующего токена заменяет его (README morgan). Форматы "tiny"/"dev" прежние,
// и для всех маршрутов, кроме ТВ-экрана, строка лога та же байт в байт (req.originalUrl || req.url, как в morgan).
morgan.token<Request, Response>("url", (req) => redactLoggedUrl(req.originalUrl || req.url));

/** Dev: цветной; production: компактная строка без лишнего шума. Успешные опросы очереди не логируются. */
export const requestLogger = morgan<Request, Response>(env.isProduction ? "tiny" : "dev", {
  skip: (req, res) => shouldSkipRequestLog(req.method, req.originalUrl, res.statusCode),
});
```
The file already imports the `Request`/`Response` types from express (line 1), and `app.ts` needs no change.

- [ ] **Step 21: Run the test to verify it passes**

Run: `cd services/api && npx vitest run src/middleware/requestLogger.test.ts && npm run typecheck`
Expected: PASS (`Tests 27 passed (27)`); typecheck exits 0.

- [ ] **Step 22: Run the targeted tests and the typecheck to verify they pass**

Run: `cd services/api && npx vitest run src/repositories/postgres/queueDisplays.test.ts src/services/queue/displayState.test.ts src/middleware/subscriptionMiddleware.test.ts src/middleware/requestLogger.test.ts && npm run typecheck`
Expected: PASS (`Test Files 4 passed (4)`, `Tests 58 passed (58)`); typecheck exits 0.

- [ ] **Step 23: Run the whole API suite and the typecheck**

Run: `cd services/api && npm run typecheck && npm test`
Expected: typecheck exits 0; all test files PASS, `Test Files 20 passed (20)`, `Tests 337 passed (337)` (the suite reads `JWT_SECRET` from `services/api/.env` exactly as before this task).

- [ ] **Step 24: Commit**

```bash
git add services/api/src/middleware/subscriptionMiddleware.ts services/api/src/middleware/subscriptionMiddleware.test.ts \
  services/api/src/services/queue/displayState.ts services/api/src/services/queue/displayState.test.ts \
  services/api/src/repositories/postgres/PostgresQueueDisplaysRepository.ts services/api/src/services/queueDisplaysService.ts \
  services/api/src/middleware/publicRateLimit.ts services/api/src/routes/publicRoutes.ts \
  services/api/src/middleware/requestLogger.ts services/api/src/middleware/requestLogger.test.ts \
  services/api/src/controllers/queueController.ts services/api/src/routes/queueRoutes.ts \
  services/api/src/container/services.ts services/api/src/routes/index.ts \
  services/api/src/repositories/postgres/queueDisplays.test.ts \
  && git commit -m "feat(queue): TV display management and public queue display endpoint"
```

---

### Task 6: Web foundations — queue permissions, staff/public queue API clients, types, i18n namespace

**Files:**
- Modify: `apps/web/src/auth/permissions.ts` (module list ~lines 30–36, role grants ~48–124, `PERMISSIONS` ~179)
- Modify: `apps/web/src/auth/roleGroups.ts` (~lines 66–67 and the end of the file, ~168–169)
- Modify: `apps/web/src/auth/permissions.test.ts` (whole file, 10 lines)
- Create: `apps/web/src/modules/queue/api/queueTypes.ts`
- Create: `apps/web/src/modules/queue/api/publicQueueApi.ts`
- Create: `apps/web/src/modules/queue/api/queueApi.ts`
- Modify: `apps/web/src/modules/appointments/api/appointmentsFlowApi.ts` (~lines 38–39, type `Appointment`)
- Modify: `apps/web/src/locales/ru.json` (~line 229 in `pages`, last 4 lines of the file)
- Modify: `apps/web/src/locales/uz.json` (~line 229 in `pages`, last 4 lines of the file)
- Test: `apps/web/src/auth/permissions.test.ts`
- Test: `apps/web/src/modules/queue/api/publicQueueApi.test.ts`
- Test: `apps/web/src/modules/queue/api/queueApi.test.ts`

**Interfaces:**
- Consumes: nothing from earlier web tasks. Mirrors the API contract (§0.8 grants, §3 types, §6/§7 endpoints). The API side of the permissions (Task 4) is a separate file; this task only touches `apps/web`.
- Produces (exact names later tasks import):
  - `apps/web/src/auth/permissions.ts`: module `"queue"` in `PERMISSION_MODULES`; grants reception `["read","create","update"]`, doctor `["read","update"]`, nurse `["read","update"]`, manager `["read"]`, director `["read"]` (superadmin implicit); named key `PERMISSIONS.QUEUE_DISPLAY_MANAGE = ["superadmin"]`.
  - `apps/web/src/auth/roleGroups.ts`: `QUEUE_ROLES: UserRole[]` (= `["superadmin","reception","doctor","nurse","manager","director"]`), `canReadQueue(role)`, `canIssueQueue(role)`, `canCallQueue(role)`, `canManageQueueDisplays(role)` — all `(role: UserRole | undefined | null) => boolean`.
  - `apps/web/src/modules/queue/api/queueTypes.ts`: `QueueEntryState`, `QueueEntry`, `QueueDoctorDay`, `QueueToday`, `QueueTicket`, `QueueDisplayLanguage`, `QueueDisplay`, `QueueDisplayInput`, `QueueDisplayWithCode`, `QueueDisplayCabinet`, `QueueDisplayCall`, `QueueDisplayState`.
  - `apps/web/src/modules/queue/api/queueApi.ts`: `queueApi.{today(doctorId?, signal?), issue(appointmentId), call(appointmentId), callNext(doctorId), ticket(appointmentId), listDisplays(), createDisplay(input), updateDisplay(id, patch), deleteDisplay(id), rotateCode(id)}` (errors are `HttpError` from `src/api/http.ts`).
  - `apps/web/src/modules/queue/api/publicQueueApi.ts`: `type QueueDisplayErrorKind = "not_found" | "inactive" | "network"`, `class QueueDisplayError extends Error { readonly kind: QueueDisplayErrorKind }`, `fetchQueueDisplayState(code: string, signal?: AbortSignal): Promise<QueueDisplayState>`. Behaviour: 404 → `kind "not_found"`, 403 → `kind "inactive"`, any other non-2xx / network failure / unparsable JSON → `kind "network"`; an aborted request (signal) rejects with the ORIGINAL `AbortError` (`error.name === "AbortError"`, not a `QueueDisplayError`) so pollers can ignore it.
  - `appointmentsFlowApi.ts` `Appointment` gains optional `queueNumber?`, `queueCode?`, `queueDate?`, `queueIssuedAt?`, `queueCalledAt?`, `queueCallCount?`.
  - Locales: `pages.queue`, and a top-level `queue` object that ENDS both locale files. After this task the last lines of `ru.json` are exactly:
    ```
      "queue": {
        "title": "Электронная очередь",
        "subtitle": "Номера пациентов по кабинетам на сегодня"
      }
    }
    ```
    and of `uz.json`:
    ```
      "queue": {
        "title": "Elektron navbat",
        "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha"
      }
    }
    ```
    Later tasks add `queue.*` keys by anchoring on the `"subtitle": …` line above.

> Locale-file gotcha (read once, applies to every locale edit in this plan): in the working tree BOTH `apps/web/src/locales/ru.json` and `uz.json` have CRLF line endings (git stores LF; `core.autocrlf=true`). Make locale edits only with the Edit tool on the exact snippets given (it matches regardless of CRLF and keeps the file's endings). Never rewrite a locale file through `JSON.parse`/`JSON.stringify` or a formatter — that drops the CRLF endings and any hand formatting, so every one of the ~2000 lines shows as changed. `npm run check-i18n` (which `JSON.parse`s both files) is the syntax check.

> check-i18n gotcha: `scripts/check-i18n.cjs` builds its key regex from the top-level keys of `ru.json`. As soon as the `queue` namespace exists, ANY quoted literal in non-test `src/**` that starts with `queue.` (e.g. `"queue.actions.call"`) must exist in both files. URL strings like `"/api/queue"` do not match (they start with `/`). Keys built with template literals (`` `queue.states.${s}` ``) are NOT checked — add those keys by hand.

- [ ] **Step 1: Write the failing permissions test**

In `apps/web/src/auth/permissions.test.ts` replace:
```ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import { canCreateAppointmentWithPatientPicker } from "./roleGroups";
describe("call-center operator booking", () => {
  it("opens existing-patient booking without granting financial or user administration access", () => {
    expect(canCreateAppointmentWithPatientPicker("operator")).toBe(true);
    expect(hasPermission("operator", "payments", "create")).toBe(false);
    expect(hasPermission("operator", "users", "update")).toBe(false);
  });
});
```
with:
```ts
import { describe, expect, it } from "vitest";
import { USER_ROLES, hasPermission, roleHasPermissionKey, type PermissionAction, type UserRole } from "./permissions";
import {
  QUEUE_ROLES,
  canCallQueue,
  canCreateAppointmentWithPatientPicker,
  canIssueQueue,
  canManageQueueDisplays,
  canReadQueue,
} from "./roleGroups";
describe("call-center operator booking", () => {
  it("opens existing-patient booking without granting financial or user administration access", () => {
    expect(canCreateAppointmentWithPatientPicker("operator")).toBe(true);
    expect(hasPermission("operator", "payments", "create")).toBe(false);
    expect(hasPermission("operator", "users", "update")).toBe(false);
  });
});

const ACTIONS: PermissionAction[] = ["read", "create", "update", "delete"];
/** Mirrors the API matrix: services/api/src/auth/permissions.ts (queue module). */
const EXPECTED_QUEUE_ACTIONS: Record<UserRole, PermissionAction[]> = {
  superadmin: ["read", "create", "update", "delete"],
  reception: ["read", "create", "update"],
  doctor: ["read", "update"],
  nurse: ["read", "update"],
  cashier: [],
  operator: [],
  accountant: [],
  manager: ["read"],
  director: ["read"],
};

describe("electronic queue permissions", () => {
  it.each(USER_ROLES)("grants %s exactly its queue actions", (role) => {
    expect(ACTIONS.filter((action) => hasPermission(role, "queue", action))).toEqual(EXPECTED_QUEUE_ACTIONS[role]);
  });

  it("lets only superadmin manage TV displays", () => {
    expect(USER_ROLES.filter((role) => roleHasPermissionKey(role, "QUEUE_DISPLAY_MANAGE"))).toEqual(["superadmin"]);
    expect(USER_ROLES.filter((role) => canManageQueueDisplays(role))).toEqual(["superadmin"]);
    expect(canManageQueueDisplays(null)).toBe(false);
    expect(canManageQueueDisplays(undefined)).toBe(false);
  });

  it("derives the queue page roles and action helpers from the matrix", () => {
    expect(QUEUE_ROLES).toEqual(["superadmin", "reception", "doctor", "nurse", "manager", "director"]);
    expect(USER_ROLES.filter((role) => canReadQueue(role))).toEqual(QUEUE_ROLES);
    expect(USER_ROLES.filter((role) => canIssueQueue(role))).toEqual(["superadmin", "reception"]);
    expect(USER_ROLES.filter((role) => canCallQueue(role))).toEqual(["superadmin", "reception", "doctor", "nurse"]);
    expect(canReadQueue(null)).toBe(false);
    expect(canIssueQueue(undefined)).toBe(false);
    expect(canCallQueue(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/auth/permissions.test.ts`
Expected: FAIL — 7 of 12 tests fail: the per-role cases with `expected [] to deeply equal [ 'read', 'create', 'update' ]` (reception; same shape for doctor, nurse, manager, director) because `"queue"` is not in the matrix yet; "lets only superadmin manage TV displays" with `TypeError: Cannot read properties of undefined (reading 'includes')` (unknown key `QUEUE_DISPLAY_MANAGE`); "derives the queue page roles…" with `expected undefined to deeply equal [ 'superadmin', 'reception', …(4) ]` (`QUEUE_ROLES` not exported yet).

- [ ] **Step 3: Implement the permission matrix and role helpers**

In `apps/web/src/auth/permissions.ts` replace:
```ts
  // Анкеты пациентов: общая база для всех врачей. Шаблоны — отдельная политика QUESTIONNAIRE_TEMPLATE_MANAGE.
  "questionnaires",
] as const;
```
with:
```ts
  // Анкеты пациентов: общая база для всех врачей. Шаблоны — отдельная политика QUESTIONNAIRE_TEMPLATE_MANAGE.
  "questionnaires",
  // Электронная очередь: номера у врачей на день и вызов пациентов. ТВ-экраны — отдельная политика QUEUE_DISPLAY_MANAGE.
  // Врач и медсестра работают только с очередью своего врача (проверка в сервисе).
  "queue",
] as const;
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
    appointments: ["read", "create", "update", "delete"],
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  doctor: {
```
with:
```ts
    appointments: ["read", "create", "update", "delete"],
    questionnaires: ["read", "create", "update"],
    queue: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  doctor: {
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
    appointments: ["read", "create", "update"],
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  nurse: {
```
with:
```ts
    appointments: ["read", "create", "update"],
    questionnaires: ["read", "create", "update"],
    queue: ["read", "update"],
    ai: ["read", "create"],
  },

  nurse: {
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
  nurse: {
    patients: ["read", "create"],
    appointments: ["read", "update"],
    questionnaires: ["read", "create", "update"],
    ai: ["read", "create"],
  },
```
with:
```ts
  nurse: {
    patients: ["read", "create"],
    appointments: ["read", "update"],
    questionnaires: ["read", "create", "update"],
    queue: ["read", "update"],
    ai: ["read", "create"],
  },
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
    questionnaires: ["read", "create", "update", "delete"],
```
with:
```ts
    questionnaires: ["read", "create", "update", "delete"],
    queue: ["read"],
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
  director: {
    patients: ["read"],
    appointments: ["read"],
```
with:
```ts
  director: {
    patients: ["read"],
    appointments: ["read"],
    queue: ["read"],
```

In `apps/web/src/auth/permissions.ts` replace:
```ts
  QUESTIONNAIRE_TEMPLATE_MANAGE: ["superadmin", "manager", "doctor"] as const satisfies readonly UserRole[],
```
with:
```ts
  QUESTIONNAIRE_TEMPLATE_MANAGE: ["superadmin", "manager", "doctor"] as const satisfies readonly UserRole[],
  /** ТВ-экраны очереди: создание, новый код, удаление. */
  QUEUE_DISPLAY_MANAGE: ["superadmin"] as const satisfies readonly UserRole[],
```

In `apps/web/src/auth/roleGroups.ts` replace:
```ts
/** База анкет пациентов (общая для всех врачей). */
export const QUESTIONNAIRE_ROLES = rolesWithPermission("questionnaires", "read");
```
with:
```ts
/** База анкет пациентов (общая для всех врачей). */
export const QUESTIONNAIRE_ROLES = rolesWithPermission("questionnaires", "read");

/** Страница «Очередь»: все, у кого есть queue.read (manager/director — только просмотр). */
export const QUEUE_ROLES = rolesWithPermission("queue", "read");
```

In `apps/web/src/auth/roleGroups.ts` replace:
```ts
export const canManageQuestionnaireTemplates = (role: UserRole | undefined | null): boolean =>
  !!role && roleHasPermissionKey(role, "QUESTIONNAIRE_TEMPLATE_MANAGE");
```
with:
```ts
export const canManageQuestionnaireTemplates = (role: UserRole | undefined | null): boolean =>
  !!role && roleHasPermissionKey(role, "QUESTIONNAIRE_TEMPLATE_MANAGE");

/** Электронная очередь: просмотр очереди, талон. */
export const canReadQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "read");

/** Выдать номер / вернуть в очередь (регистратура). */
export const canIssueQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "create");

/** Вызвать пациента / «Вызвать следующего» (врач и медсестра — только своя очередь, проверяет API). */
export const canCallQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "update");

/** ТВ-экраны очереди — только superadmin. */
export const canManageQueueDisplays = (role: UserRole | undefined | null): boolean =>
  !!role && roleHasPermissionKey(role, "QUEUE_DISPLAY_MANAGE");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/auth/permissions.test.ts`
Expected: PASS (12 tests: 1 old + 9 per-role + 2).
Run: `cd apps/web && npm run typecheck`
Expected: PASS (no output from `tsc --noEmit`). No other file keys a `Record<PermissionModule, …>`, so adding a module does not break exhaustiveness anywhere.

- [ ] **Step 5: Write the failing public TV client test**

Create `apps/web/src/modules/queue/api/publicQueueApi.test.ts` with:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueDisplayError, fetchQueueDisplayState } from "./publicQueueApi";
import type { QueueDisplayState } from "./queueTypes";

const state: QueueDisplayState = {
  serverTime: "2026-09-30T06:00:00.000Z",
  timeZone: "Asia/Tashkent",
  clinicName: "Test clinic",
  display: { name: "Hall", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls: [],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stubFetch = (impl: () => Promise<Response>) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public queue display client", () => {
  it("GETs the display by code with no-store and without any auth or custom headers", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:4400");
    const storage = { getItem: vi.fn(() => "stale-staff-token") };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage, location: { pathname: "/tv/K7M2Q-9XR4P", assign: vi.fn() } });
    const fetchMock = stubFetch(async () => jsonResponse(state));

    await expect(fetchQueueDisplayState("K7M2Q-9XR4P")).resolves.toEqual(state);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4400/api/public/queue-display/K7M2Q-9XR4P");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toBeUndefined();
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("URL-encodes the code and forwards the abort signal", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:4400");
    const fetchMock = stubFetch(async () => jsonResponse(state));
    const controller = new AbortController();

    await fetchQueueDisplayState("a b/c", controller.signal);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4400/api/public/queue-display/a%20b%2Fc");
    expect(init?.signal).toBe(controller.signal);
  });

  it.each([
    [404, "not_found"],
    [403, "inactive"],
    [500, "network"],
    [429, "network"],
    [502, "network"],
  ] as const)("maps HTTP %i to the %s error kind", async (status, kind) => {
    stubFetch(async () => jsonResponse({ error: "x" }, status));
    const error = await fetchQueueDisplayState("K7M2Q9XR4P").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueDisplayError);
    expect(error).toMatchObject({ kind, name: "QueueDisplayError" });
  });

  it("maps a failed connection and an unreadable body to the network kind", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchQueueDisplayState("K7M2Q9XR4P")).rejects.toMatchObject({ kind: "network" });

    stubFetch(async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchQueueDisplayState("K7M2Q9XR4P")).rejects.toMatchObject({ kind: "network" });
  });

  it("rethrows an abort untouched so pollers can ignore it", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const error = await fetchQueueDisplayState("K7M2Q9XR4P", new AbortController().signal).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(QueueDisplayError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/api/publicQueueApi.test.ts`
Expected: FAIL with `Error: Cannot find module './publicQueueApi' imported from '…/publicQueueApi.test.ts'` (the module and `./queueTypes` do not exist yet).

- [ ] **Step 7: Create the shared web queue types and the public client**

Create `apps/web/src/modules/queue/api/queueTypes.ts` with:
```ts
/**
 * Mirrors services/api/src/repositories/interfaces/queueTypes.ts (web-facing types) — update both files together.
 * Time fields: `startAt` is clinic WALL CLOCK "YYYY-MM-DD HH:mm:ss" (format it without any time-zone conversion);
 * `issuedAt`, `calledAt`, `serverTime`, `createdAt`, `updatedAt` are real ISO instants (format in `timeZone`).
 */
export type QueueEntryState = "waiting" | "called" | "serving" | "missed" | "done";

export type QueueEntry = {
  appointmentId: number;
  doctorId: number;
  patientId: number;
  patientName: string;
  /** null only for "serving" without a ticket (doctor started the visit directly). */
  number: number | null;
  /** "К-05", "К-123", "07"; null when there is no number. */
  code: string | null;
  state: QueueEntryState;
  startAt: string;
  issuedAt: string | null;
  calledAt: string | null;
  callCount: number;
};

export type QueueDoctorDay = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  prefix: string | null;
  /** in_consultation today (latest by update time). */
  serving: QueueEntry | null;
  /** status arrived (states "waiting" and "called"), by number ascending. */
  waiting: QueueEntry[];
  /** no_show with today's number, by number ascending ("Вернуть в очередь"). */
  missed: QueueEntry[];
  doneCount: number;
};

export type QueueToday = { date: string; timeZone: string; serverTime: string; doctors: QueueDoctorDay[] };

export type QueueTicket = {
  appointmentId: number;
  clinicName: string;
  code: string;
  number: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  issuedAt: string;
  aheadCount: number;
  timeZone: string;
};

export type QueueDisplayLanguage = "uz" | "ru" | "uz_ru";

export type QueueDisplay = {
  id: number;
  name: string;
  /** null = every doctor who has a queue today. */
  doctorIds: number[] | null;
  showNames: boolean;
  language: QueueDisplayLanguage;
  voiceEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QueueDisplayInput = {
  name: string;
  doctorIds: number[] | null;
  showNames: boolean;
  language: QueueDisplayLanguage;
  voiceEnabled: boolean;
};

/** `code` is formatted "XXXXX-XXXXX" and is returned only by create and rotate-code (never stored in clear). */
export type QueueDisplayWithCode = { display: QueueDisplay; code: string };

export type QueueDisplayCabinet = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  current: null | { code: string | null; name: string | null; state: "called" | "serving" };
  /** First 5 entries in state "waiting". */
  waiting: Array<{ code: string; name: string | null }>;
  /** All entries in state "waiting". */
  waitingCount: number;
};

export type QueueDisplayCall = {
  /** `${appointmentId}:${callCount}` — a re-call produces a new key. */
  key: string;
  code: string;
  number: number;
  name: string | null;
  room: string | null;
  doctorName: string;
  calledAt: string;
};

export type QueueDisplayState = {
  serverTime: string;
  timeZone: string;
  clinicName: string;
  display: { name: string; language: QueueDisplayLanguage; voiceEnabled: boolean; showNames: boolean };
  cabinets: QueueDisplayCabinet[];
  /** Last 20 calls of the day, newest first. */
  recentCalls: QueueDisplayCall[];
};
```

Create `apps/web/src/modules/queue/api/publicQueueApi.ts` with:
```ts
import type { QueueDisplayState } from "./queueTypes";

export type QueueDisplayErrorKind = "not_found" | "inactive" | "network";

export class QueueDisplayError extends Error {
  constructor(public readonly kind: QueueDisplayErrorKind, message: string) {
    super(message);
    this.name = "QueueDisplayError";
  }
}

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/**
 * Public TV endpoint. Deliberately NOT `requestJson`: that helper attaches any stored staff token and
 * redirects to /login on 401. A bare GET without custom headers is also a CORS "simple request" (no preflight).
 * 404 → not_found (unknown or deleted screen), 403 → inactive (clinic subscription), anything else → network.
 * An aborted request rejects with the original AbortError so pollers can tell it apart from a failure.
 */
export async function fetchQueueDisplayState(code: string, signal?: AbortSignal): Promise<QueueDisplayState> {
  // Read at call time (not module load) so tests can vi.stubEnv without re-importing the module.
  const url = `${import.meta.env.VITE_API_URL}/api/public/queue-display/${encodeURIComponent(code)}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new QueueDisplayError("network", "Нет связи с сервером");
  }
  if (response.status === 404) throw new QueueDisplayError("not_found", "Экран не найден");
  if (response.status === 403) throw new QueueDisplayError("inactive", "Подписка клиники неактивна");
  if (!response.ok) throw new QueueDisplayError("network", `Сервер ответил ${response.status}`);
  try {
    return (await response.json()) as QueueDisplayState;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new QueueDisplayError("network", "Некорректный ответ сервера");
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/api/publicQueueApi.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 9: Write the failing staff queue API test**

Create `apps/web/src/modules/queue/api/queueApi.test.ts` with:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn(async () => ({})) }));
vi.mock("../../../api/http", () => ({ requestJson }));

import { queueApi } from "./queueApi";
import type { QueueDisplayInput } from "./queueTypes";

beforeEach(() => requestJson.mockClear());

describe("staff queue API", () => {
  it("maps every call to its /api/queue endpoint, method and body", async () => {
    const signal = new AbortController().signal;
    const input: QueueDisplayInput = { name: "Холл", doctorIds: [3, 4], showNames: true, language: "uz_ru", voiceEnabled: true };

    await queueApi.today(7, signal);
    await queueApi.today();
    await queueApi.today(null);
    await queueApi.issue(11);
    await queueApi.call(11);
    await queueApi.callNext(3);
    await queueApi.ticket(11);
    await queueApi.listDisplays();
    await queueApi.createDisplay(input);
    await queueApi.updateDisplay(5, { showNames: false });
    await queueApi.deleteDisplay(5);
    await queueApi.rotateCode(5);

    expect(requestJson.mock.calls).toEqual([
      ["/api/queue/today?doctorId=7", { signal }],
      ["/api/queue/today", { signal: undefined }],
      ["/api/queue/today", { signal: undefined }],
      ["/api/queue/appointments/11/issue", { method: "POST" }],
      ["/api/queue/appointments/11/call", { method: "POST" }],
      ["/api/queue/doctors/3/call-next", { method: "POST" }],
      ["/api/queue/appointments/11/ticket"],
      ["/api/queue/displays"],
      ["/api/queue/displays", { method: "POST", body: input }],
      ["/api/queue/displays/5", { method: "PATCH", body: { showNames: false } }],
      ["/api/queue/displays/5", { method: "DELETE" }],
      ["/api/queue/displays/5/rotate-code", { method: "POST" }],
    ]);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/api/queueApi.test.ts`
Expected: FAIL with `Error: Cannot find module './queueApi' imported from '…/queueApi.test.ts'`.

- [ ] **Step 11: Create the staff queue API client**

Create `apps/web/src/modules/queue/api/queueApi.ts` with:
```ts
import { requestJson } from "../../../api/http";
import type {
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayWithCode,
  QueueEntry,
  QueueTicket,
  QueueToday,
} from "./queueTypes";

/**
 * Staff queue endpoints (/api/queue). Like the call-center workspaceApi, the token is taken from storage by
 * requestJson. Failures are HttpError (src/api/http.ts) with the server's Russian `error` text and `status`.
 */
const base = "/api/queue";
export const queueApi = {
  today: (doctorId?: number | null, signal?: AbortSignal) =>
    requestJson<QueueToday>(`${base}/today${doctorId ? `?doctorId=${doctorId}` : ""}`, { signal }),
  issue: (appointmentId: number) =>
    requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/issue`, { method: "POST" }),
  call: (appointmentId: number) =>
    requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/call`, { method: "POST" }),
  callNext: (doctorId: number) =>
    requestJson<{ entry: QueueEntry | null }>(`${base}/doctors/${doctorId}/call-next`, { method: "POST" }),
  ticket: (appointmentId: number) => requestJson<QueueTicket>(`${base}/appointments/${appointmentId}/ticket`),
  listDisplays: () => requestJson<QueueDisplay[]>(`${base}/displays`),
  createDisplay: (input: QueueDisplayInput) =>
    requestJson<QueueDisplayWithCode>(`${base}/displays`, { method: "POST", body: input }),
  updateDisplay: (id: number, patch: Partial<QueueDisplayInput>) =>
    requestJson<QueueDisplay>(`${base}/displays/${id}`, { method: "PATCH", body: patch }),
  deleteDisplay: (id: number) =>
    requestJson<{ success: boolean; id: number }>(`${base}/displays/${id}`, { method: "DELETE" }),
  rotateCode: (id: number) =>
    requestJson<QueueDisplayWithCode>(`${base}/displays/${id}/rotate-code`, { method: "POST" }),
};
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/api/queueApi.test.ts`
Expected: PASS (1 test).

- [ ] **Step 13: Add the queue fields to the web `Appointment` type and seed the i18n namespace**

The API returns these fields on every appointment once Task 3 is in; they are optional here so older payloads and test fixtures still type-check.

In `apps/web/src/modules/appointments/api/appointmentsFlowApi.ts` replace:
```ts
  recommendedReturnDate?: string | null;
  notes: string | null;
```
with:
```ts
  recommendedReturnDate?: string | null;
  notes: string | null;
  /** Electronic queue — written only by the API (issued when the visit becomes "arrived" today). */
  queueNumber?: number | null;
  /** Ready ticket code, e.g. "К-05" (doctor letter snapshot taken at issue time). */
  queueCode?: string | null;
  /** Clinic day "YYYY-MM-DD" the number belongs to. */
  queueDate?: string | null;
  /** ISO instants. */
  queueIssuedAt?: string | null;
  queueCalledAt?: string | null;
  queueCallCount?: number;
```

In `apps/web/src/locales/ru.json` replace:
```json
    "callCenter": "Колл-центр"
  },
  "patients": {
```
with:
```json
    "callCenter": "Колл-центр",
    "queue": "Очередь"
  },
  "patients": {
```

In `apps/web/src/locales/ru.json` replace:
```json
      "optionsInvalid": "Вопрос «{{label}}»: нужно минимум 2 разных варианта ответа"
    }
  }
}
```
with:
```json
      "optionsInvalid": "Вопрос «{{label}}»: нужно минимум 2 разных варианта ответа"
    }
  },
  "queue": {
    "title": "Электронная очередь",
    "subtitle": "Номера пациентов по кабинетам на сегодня"
  }
}
```

In `apps/web/src/locales/uz.json` replace:
```json
    "callCenter": "Call-markaz"
  },
  "patients": {
```
with:
```json
    "callCenter": "Call-markaz",
    "queue": "Navbat"
  },
  "patients": {
```

In `apps/web/src/locales/uz.json` replace:
```json
      "optionsInvalid": "«{{label}}» savoli: kamida 2 ta turli javob varianti kerak"
    }
  }
}
```
with:
```json
      "optionsInvalid": "«{{label}}» savoli: kamida 2 ta turli javob varianti kerak"
    }
  },
  "queue": {
    "title": "Elektron navbat",
    "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha"
  }
}
```

- [ ] **Step 14: Run the whole web suite, typecheck and i18n check**

Run: `cd apps/web && npx vitest run src/auth/permissions.test.ts src/modules/queue/api`
Expected: PASS (3 files, 22 tests).
Run: `cd apps/web && npm test`
Expected: PASS — 12 test files (10 existing + 2 new), 67 tests, 0 failures.
Run: `cd apps/web && npm run typecheck`
Expected: PASS (no output).
Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1718 keys, full ru/uz parity, all code references resolve.`
Run: `git diff --stat -- apps/web/src/locales`
Expected: each locale file shows only a handful of changed lines (`7 ++++++-` per file); a diff touching ~2000 lines means the file was re-serialized — revert it (`git checkout -- <file>`) and redo the edit with the Edit tool.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/auth/permissions.ts apps/web/src/auth/roleGroups.ts apps/web/src/auth/permissions.test.ts apps/web/src/modules/queue/api/queueTypes.ts apps/web/src/modules/queue/api/publicQueueApi.ts apps/web/src/modules/queue/api/publicQueueApi.test.ts apps/web/src/modules/queue/api/queueApi.ts apps/web/src/modules/queue/api/queueApi.test.ts apps/web/src/modules/appointments/api/appointmentsFlowApi.ts apps/web/src/locales/ru.json apps/web/src/locales/uz.json && git commit -m "feat(web): queue permissions, queue API clients and types"
```

---

---

### Task 7: Doctor room and queue letter on the Doctors page

**Files:**
- Create: `apps/web/src/modules/doctors/utils/queueFields.ts`
- Test: `apps/web/src/modules/doctors/utils/queueFields.test.ts`
- Modify: `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` (imports lines 3 and 13; types/initial state 15–49; `openEdit` 150–163; `validateForm` 165–175; payload 188–200; after `busy` 246; card 351–355; form grid 476–489)
- Test: `apps/web/src/modules/doctors/pages/DoctorsPage.test.tsx` (new)
- Modify: `apps/web/src/locales/ru.json` (`doctors` block, ~lines 573 and 588)
- Modify: `apps/web/src/locales/uz.json` (`doctors` block, ~lines 573 and 588)

**Interfaces:**
- Consumes: API contract §4 (Task 2): `GET /api/doctors` rows carry `room: string | null` and `queuePrefix: string | null`; `POST /api/doctors` and `PUT /api/doctors/:id` accept `room` (≤ 20 chars, "" / null → null) and `queuePrefix` (one letter or null, stored upper-cased). Only roles with `doctors.create` (today: superadmin) see the edit form.
- Produces:
  - `apps/web/src/modules/doctors/utils/queueFields.ts`: `normalizeQueuePrefixInput(value: string): string` and `validateDoctorQueueFields(room: string, queuePrefix: string): "roomTooLong" | "queuePrefixOneLetter" | null`.
  - i18n keys (ru + uz): `doctors.room`, `doctors.roomShort` (interpolation `{{room}}`), `doctors.queuePrefix`, `doctors.queuePrefixHint`, `doctors.validation.roomTooLong`, `doctors.validation.queuePrefixOneLetter`.
  - DOM ids in the doctor form: `doctor-room`, `doctor-queue-prefix`.

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/src/modules/doctors/utils/queueFields.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import { normalizeQueuePrefixInput, validateDoctorQueueFields } from "./queueFields";

describe("queue letter input", () => {
  it("upper-cases a typed Cyrillic or Latin letter", () => {
    expect(normalizeQueuePrefixInput("к")).toBe("К");
    expect(normalizeQueuePrefixInput("a")).toBe("A");
    expect(normalizeQueuePrefixInput("Ш")).toBe("Ш");
    expect(normalizeQueuePrefixInput("ў")).toBe("Ў");
  });

  it("keeps only the last typed letter and drops digits, spaces and punctuation", () => {
    expect(normalizeQueuePrefixInput("кб")).toBe("Б");
    // typing "У" after the stored "к" (or pasting over it) replaces the letter
    expect(normalizeQueuePrefixInput("кУ")).toBe("У");
    expect(normalizeQueuePrefixInput("к-5")).toBe("К");
    expect(normalizeQueuePrefixInput("7")).toBe("");
    expect(normalizeQueuePrefixInput(" -")).toBe("");
    expect(normalizeQueuePrefixInput("")).toBe("");
  });

  it("never turns one letter into two when upper-casing", () => {
    expect(normalizeQueuePrefixInput("ß")).toBe("ß");
  });
});

describe("doctor queue fields validation", () => {
  it("accepts empty fields, a 20-character room and a single letter", () => {
    expect(validateDoctorQueueFields("", "")).toBeNull();
    expect(validateDoctorQueueFields("   ", "")).toBeNull();
    expect(validateDoctorQueueFields("12345678901234567890", "К")).toBeNull();
    expect(validateDoctorQueueFields("  5  ", "a")).toBeNull();
    expect(validateDoctorQueueFields("Хирургия-2", " Б ")).toBeNull();
  });

  it("rejects a room longer than 20 characters after trimming", () => {
    expect(validateDoctorQueueFields("123456789012345678901", "")).toBe("roomTooLong");
    expect(validateDoctorQueueFields("  Кабинет стоматологии 2  ", "")).toBe("roomTooLong");
  });

  it("rejects a prefix that is not exactly one letter", () => {
    expect(validateDoctorQueueFields("5", "7")).toBe("queuePrefixOneLetter");
    expect(validateDoctorQueueFields("5", "КБ")).toBe("queuePrefixOneLetter");
    expect(validateDoctorQueueFields("5", "-")).toBe("queuePrefixOneLetter");
  });

  it("reports the room problem first", () => {
    expect(validateDoctorQueueFields("x".repeat(21), "77")).toBe("roomTooLong");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/doctors/utils/queueFields.test.ts`
Expected: FAIL with `Error: Cannot find module './queueFields' imported from '…/queueFields.test.ts'`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/modules/doctors/utils/queueFields.ts` with:
```ts
/** Cabinet (room) and queue-letter rules for the doctor form; mirrors the API validation in doctorsValidators. */
const ONE_LETTER = /^\p{L}$/u;
const ROOM_MAX_CHARS = 20;

/**
 * Value for the one-letter input: the last letter typed or pasted, upper-cased ("к" → "К", "к-5" → "К");
 * digits, spaces and punctuation are dropped, so "" means "no letter".
 */
export function normalizeQueuePrefixInput(value: string): string {
  const letters = Array.from(value).filter((char) => ONE_LETTER.test(char));
  const last = letters[letters.length - 1];
  if (!last) return "";
  const upper = last.toUpperCase();
  // "ß".toUpperCase() === "SS": keep the original so the prefix stays one character (DB CHECK length = 1).
  return Array.from(upper).length === 1 ? upper : last;
}

/** null when valid. Room: ≤ 20 characters after trim (counted by code point, like the API). Prefix: empty or one letter. */
export function validateDoctorQueueFields(
  room: string,
  queuePrefix: string
): "roomTooLong" | "queuePrefixOneLetter" | null {
  if (Array.from(room.trim()).length > ROOM_MAX_CHARS) return "roomTooLong";
  const prefix = queuePrefix.trim();
  if (prefix && !ONE_LETTER.test(prefix)) return "queuePrefixOneLetter";
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/doctors/utils/queueFields.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing Doctors page test**

The web tests run in the node environment: `Modal` renders `null` without `document`, so the test replaces it with a pass-through; `PhoneInput` and the service picker are stubbed out; `requestJson` is mocked (it would otherwise read `VITE_API_URL` at import).

Create `apps/web/src/modules/doctors/pages/DoctorsPage.test.tsx` with:
```tsx
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestJson: vi.fn(), doctors: [] as unknown[] }));
const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../api/http", () => ({ requestJson: mocks.requestJson }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "superadmin" } }) }));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock("../../../components/ui/SelectableItemsModal", () => ({ SelectableItemsModal: () => null }));
vi.mock("../../../shared/ui/PhoneInput", () => ({ PhoneInput: () => null }));
import { DoctorsPage } from "./DoctorsPage";

const doctorRows = [
  { id: 1, name: "Karimov Aziz", speciality: "Терапевт", percent: 30, active: true, serviceIds: [], room: "5", queuePrefix: "К" },
  { id: 2, name: "Aliyeva Nodira", speciality: "ЛОР", percent: 20, active: true, serviceIds: [], room: null, queuePrefix: null },
  { id: 3, name: "Rahimov Bek", speciality: "Хирург", percent: 25, active: true, serviceIds: [], room: "12", queuePrefix: null },
];

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.doctors = doctorRows;
  vi.stubGlobal("window", { setTimeout, clearTimeout, innerWidth: 1280, confirm: vi.fn(() => true) });
  mocks.requestJson.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === "/api/services") return [];
    if (path === "/api/doctors" && !options?.method) return mocks.doctors;
    return { id: 1 };
  });
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const render = async () => {
  await act(async () => {
    view = create(<DoctorsPage />);
  });
};
/** Clicks and lets the async handler (request + reload) finish inside act. */
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const type = (props: Record<string, string>, value: string) =>
  act(() => {
    view.root.findByProps(props).props.onChange({ target: { value } });
  });
const writes = (method: string) =>
  mocks.requestJson.mock.calls.filter(([, options]) => options?.method === method);

describe("doctor cabinet and queue letter", () => {
  it("shows the cabinet and the letter on the doctor card", async () => {
    await render();
    const cards = view.root.findAllByType("article").map(textOf);
    expect(cards[0]).toContain('doctors.roomShort {"room":"5"} · К');
    expect(cards[1]).not.toContain("doctors.roomShort");
    expect(cards[2]).toContain('doctors.roomShort {"room":"12"}');
    expect(cards[2]).not.toContain("·");
  });

  it("prefills both fields on edit, upper-cases the letter and saves them", async () => {
    await render();
    act(() => {
      buttons("common.edit")[0].props.onClick();
    });
    expect(view.root.findByProps({ id: "doctor-room" }).props.value).toBe("5");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("К");

    // No maxLength on the letter field: typing after the stored letter gives "Кб", and the last letter wins.
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.maxLength).toBeUndefined();
    type({ id: "doctor-queue-prefix" }, "Кб");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("Б");
    type({ id: "doctor-queue-prefix" }, "кУ");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("У");
    type({ id: "doctor-room" }, " 7А ");
    await click(buttons("common.save")[0]);

    const [path, options] = writes("PUT")[0];
    expect(path).toBe("/api/doctors/1");
    expect(options.body).toMatchObject({ room: "7А", queuePrefix: "У" });
  });

  it("sends null for an empty cabinet and letter", async () => {
    await render();
    act(() => {
      buttons("doctors.addDoctor")[0].props.onClick();
    });
    type({ "aria-label": "Имя врача" }, "Yusupova Dilnoza");
    type({ "aria-label": "Специальность" }, "Педиатр");
    await click(buttons("common.save")[0]);

    const [path, options] = writes("POST")[0];
    expect(path).toBe("/api/doctors");
    expect(options.body).toMatchObject({ room: null, queuePrefix: null });
  });

  it("blocks saving a cabinet longer than 20 characters", async () => {
    await render();
    act(() => {
      buttons("doctors.addDoctor")[0].props.onClick();
    });
    type({ "aria-label": "Имя врача" }, "Yusupova Dilnoza");
    type({ "aria-label": "Специальность" }, "Педиатр");
    type({ id: "doctor-room" }, "x".repeat(21));
    await click(buttons("common.save")[0]);

    expect(textOf(view.root)).toContain("doctors.validation.roomTooLong");
    expect(writes("POST")).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/doctors/pages/DoctorsPage.test.tsx`
Expected: FAIL — 4 of 4: the card test with `expected 'Karimov AzizТерапевтdoctors.activedoc…' to contain 'doctors.roomShort {"room":"5"} · К'`, the edit test and the too-long test with `No instances found with props: {"id":"doctor-room"}`, the null test with `expected { name: 'Yusupova Dilnoza', …(6) } to match object { room: null, queuePrefix: null }`.

- [ ] **Step 7: Add the fields to the Doctors page**

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
import { Plus, Search, Stethoscope, X } from "lucide-react";
```
with:
```tsx
import { DoorOpen, Plus, Search, Stethoscope, X } from "lucide-react";
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
import { phoneToApiValue, storedPhoneToNormalized } from "../../../utils/phoneInput";
```
with:
```tsx
import { phoneToApiValue, storedPhoneToNormalized } from "../../../utils/phoneInput";
import { normalizeQueuePrefixInput, validateDoctorQueueFields } from "../utils/queueFields";
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
  birth_date?: string | null;
  active: boolean;
  serviceIds?: number[];
};
```
with:
```tsx
  birth_date?: string | null;
  active: boolean;
  serviceIds?: number[];
  /** Cabinet shown on the TV and the ticket (≤ 20 chars). */
  room?: string | null;
  /** One upper-case letter used in ticket codes ("К-05"). */
  queuePrefix?: string | null;
};
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
  birthDate: string;
  active: boolean;
  serviceIds: number[];
};

const initialFormState: DoctorFormState = {
  name: "",
  speciality: "",
  percent: "0",
  phone: "",
  birthDate: "",
  active: true,
  serviceIds: [],
};
```
with:
```tsx
  birthDate: string;
  active: boolean;
  serviceIds: number[];
  room: string;
  queuePrefix: string;
};

const initialFormState: DoctorFormState = {
  name: "",
  speciality: "",
  percent: "0",
  phone: "",
  birthDate: "",
  active: true,
  serviceIds: [],
  room: "",
  queuePrefix: "",
};
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
      active: doctor.active,
      serviceIds: doctor.serviceIds ?? [],
    });
```
with:
```tsx
      active: doctor.active,
      serviceIds: doctor.serviceIds ?? [],
      room: doctor.room ?? "",
      queuePrefix: doctor.queuePrefix ?? "",
    });
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return t("doctors.validation.percentRange");
    }
    return null;
  };
```
with:
```tsx
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return t("doctors.validation.percentRange");
    }
    const queueFieldsError = validateDoctorQueueFields(formState.room, formState.queuePrefix);
    if (queueFieldsError === "roomTooLong") return t("doctors.validation.roomTooLong");
    if (queueFieldsError === "queuePrefixOneLetter") return t("doctors.validation.queuePrefixOneLetter");
    return null;
  };
```

The letter is already upper-cased by `normalizeQueuePrefixInput`, so the payload does not call `toUpperCase()` again (that would turn "ß" into the two-letter "SS" and hit the DB CHECK).

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
        active: formState.active,
        serviceIds: formState.serviceIds,
      };
```
with:
```tsx
        active: formState.active,
        serviceIds: formState.serviceIds,
        room: formState.room.trim() || null,
        queuePrefix: formState.queuePrefix.trim() || null,
      };
```

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
  const busy = loading || isSaving || isDeletingId !== null;
```
with:
```tsx
  const busy = loading || isSaving || isDeletingId !== null;
  /** Card line: "Кабинет 5 · К", "Кабинет 5", or "Буква очереди: К" when only the letter is set. */
  const doctorQueueLine = (doctor: Doctor): string | null => {
    const room = doctor.room?.trim();
    const prefix = doctor.queuePrefix?.trim();
    if (room && prefix) return `${t("doctors.roomShort", { room })} · ${prefix}`;
    if (room) return t("doctors.roomShort", { room });
    if (prefix) return `${t("doctors.queuePrefix")}: ${prefix}`;
    return null;
  };
```

The new card line uses `flex` (block level), not `inline-flex` like the speciality line above it, so it always starts on its own line.

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#64748b]">
                      <Stethoscope className="h-3.5 w-3.5 text-[#94a3b8]" strokeWidth={1.75} />
                      {doctor.speciality}
                    </p>
```
with:
```tsx
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#64748b]">
                      <Stethoscope className="h-3.5 w-3.5 text-[#94a3b8]" strokeWidth={1.75} />
                      {doctor.speciality}
                    </p>
                    {doctorQueueLine(doctor) ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-[#64748b]">
                        <DoorOpen className="h-3.5 w-3.5 text-[#94a3b8]" strokeWidth={1.75} />
                        {doctorQueueLine(doctor)}
                      </p>
                    ) : null}
```

The two new cells go before the "active" checkbox cell, so the two-column grid stays balanced (birth date | cabinet, letter | active).

The letter input deliberately has no `maxLength`: `maxLength={1}` would make the browser block typing a new letter while one is already there (select-all first would be the only way). `normalizeQueuePrefixInput` keeps only the last letter typed or pasted, so the field still never holds more than one letter.

In `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` replace:
```tsx
                  aria-label="Дата рождения врача"
                  disabled={isSaving}
                />
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm text-[#334155]">
```
with:
```tsx
                  aria-label="Дата рождения врача"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                {t("doctors.room")}
                <input
                  id="doctor-room"
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.room}
                  maxLength={20}
                  onChange={(event) => setFormState((prev) => ({ ...prev, room: event.target.value }))}
                  placeholder="5"
                  autoComplete="off"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                {t("doctors.queuePrefix")}
                <input
                  id="doctor-queue-prefix"
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.queuePrefix}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, queuePrefix: normalizeQueuePrefixInput(event.target.value) }))
                  }
                  placeholder="К"
                  autoComplete="off"
                  disabled={isSaving}
                />
                <span className="mt-1 block text-xs text-[#94a3b8]">{t("doctors.queuePrefixHint")}</span>
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm text-[#334155]">
```

- [ ] **Step 8: Add the doctor i18n keys (ru + uz)**

Use the Edit tool (both locale files are CRLF in the working tree — see the gotcha in Task 6).

In `apps/web/src/locales/ru.json` replace:
```json
    "confirmActivate": "Активировать врача {{name}}?",
```
with:
```json
    "confirmActivate": "Активировать врача {{name}}?",
    "room": "Кабинет",
    "roomShort": "Кабинет {{room}}",
    "queuePrefix": "Буква очереди",
    "queuePrefixHint": "Необязательно. Одна буква: К → номера К-01, К-02…",
```

In `apps/web/src/locales/ru.json` replace:
```json
      "percentRange": "Процент должен быть от 0 до 100"
    },
```
with:
```json
      "percentRange": "Процент должен быть от 0 до 100",
      "roomTooLong": "Кабинет — не больше 20 символов",
      "queuePrefixOneLetter": "Буква очереди — ровно одна буква"
    },
```

In `apps/web/src/locales/uz.json` replace:
```json
    "confirmActivate": "{{name}} shifokorni faollashtirasizmi?",
```
with:
```json
    "confirmActivate": "{{name}} shifokorni faollashtirasizmi?",
    "room": "Xona",
    "roomShort": "Xona {{room}}",
    "queuePrefix": "Navbat harfi",
    "queuePrefixHint": "Ixtiyoriy. Bitta harf: K → K-01, K-02… raqamlar",
```

In `apps/web/src/locales/uz.json` replace:
```json
      "percentRange": "Foiz 0 dan 100 gacha bo'lishi kerak"
    },
```
with:
```json
      "percentRange": "Foiz 0 dan 100 gacha bo'lishi kerak",
      "roomTooLong": "Xona — 20 belgidan oshmasin",
      "queuePrefixOneLetter": "Navbat harfi — faqat bitta harf"
    },
```

- [ ] **Step 9: Run the tests, the full suite, typecheck and i18n check**

Run: `cd apps/web && npx vitest run src/modules/doctors`
Expected: PASS (2 files, 11 tests), no `act(...)` warnings (the `click` helper keeps the async save + reload inside `act`).
Run: `cd apps/web && npm test`
Expected: PASS — 14 test files, 78 tests, 0 failures.
Run: `cd apps/web && npm run typecheck`
Expected: PASS (no output).
Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1724 keys, full ru/uz parity, all code references resolve.`

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/modules/doctors/utils/queueFields.ts apps/web/src/modules/doctors/utils/queueFields.test.ts apps/web/src/modules/doctors/pages/DoctorsPage.tsx apps/web/src/modules/doctors/pages/DoctorsPage.test.tsx apps/web/src/locales/ru.json apps/web/src/locales/uz.json && git commit -m "feat(web): doctor cabinet and queue letter fields"
```

---

### Task 8: Queue code on appointments, «Отметить приход» wording, ticket printing (web)

**Files:**
- Create: `apps/web/src/modules/queue/print/ticketHtml.ts`
- Test: `apps/web/src/modules/queue/print/ticketHtml.test.ts` (new)
- Create: `apps/web/src/modules/queue/print/printTicket.ts`
- Test: `apps/web/src/modules/queue/print/printTicket.test.ts` (new)
- Create: `apps/web/src/modules/queue/components/QueueCodeBadge.tsx`
- Test: `apps/web/src/modules/queue/components/QueueCodeBadge.test.tsx` (new)
- Modify: `apps/web/src/modules/appointments/components/appointmentActions.ts` (lines 25–28)
- Test: `apps/web/src/modules/appointments/components/appointmentActions.test.ts` (new)
- Modify: `apps/web/src/locales/ru.json` (line 325, start of the `appointments` block)
- Modify: `apps/web/src/locales/uz.json` (line 325, start of the `appointments` block)
- Modify: `apps/web/src/modules/appointments/components/AppointmentCard.tsx` (imports 8–9; Props 54–56; destructuring 81–83; status label 105–113; header 174–178; action row 260–261)
- Test: `apps/web/src/modules/appointments/components/AppointmentCard.test.tsx` (new)
- Modify: `apps/web/src/modules/appointments/components/AppointmentMobileCard.tsx` (imports 5–6; Props 47–49; destructuring 67–70; status pill 121–126; action column 152–153)
- Modify: `apps/web/src/modules/appointments/pages/AppointmentsPage.tsx` (imports 11–12 and 55; constants 62; role flags 281; state 307; effects 406–410; `updateStatus` 663–667; `openConsultation` 696–698; toast render 1045–1049; mobile card 1127–1128; desktop card 1184–1185; details modal 1311, 1324–1326, 1435–1441, 1458–1459)
- Create: `apps/web/src/modules/appointments/utils/queueIssue.ts` («Выдать номер» call + row patch)
- Test: `apps/web/src/modules/appointments/utils/queueIssue.test.ts` (new)
- Create: `apps/web/src/modules/dashboard/utils/arrivalToast.ts`
- Test: `apps/web/src/modules/dashboard/utils/arrivalToast.test.ts` (new)
- Modify: `apps/web/src/modules/dashboard/pages/DashboardPage.tsx` (import 42; `runAppointmentAction` 264)

**Interfaces:**
- Consumes (Task 6, exact names):
  - `apps/web/src/modules/queue/api/queueTypes.ts`: `export type QueueTicket = { appointmentId: number; clinicName: string; code: string; number: number; doctorName: string; specialty: string; room: string | null; issuedAt: string; aheadCount: number; timeZone: string }` and `QueueEntry` (`number: number | null; code: string | null; issuedAt: string | null; …`).
  - `apps/web/src/modules/queue/api/queueApi.ts`: `queueApi.ticket(appointmentId: number): Promise<QueueTicket>` and `queueApi.issue(appointmentId: number): Promise<{ entry: QueueEntry }>` (token taken from storage by `requestJson`; failures are `HttpError` carrying the server's Russian `error` text).
  - `apps/web/src/auth/roleGroups.ts`: `canReadQueue(role)` (every queue role) and `canIssueQueue(role)` (superadmin, reception), both `(role: UserRole | undefined | null) => boolean`.
  - `apps/web/src/modules/appointments/api/appointmentsFlowApi.ts`: `Appointment` has optional `queueNumber?: number | null; queueCode?: string | null; queueDate?; queueIssuedAt?; queueCalledAt?; queueCallCount?`.
  - (Task 3, API) `PUT /api/appointments/:id` with `{ status: "arrived" }` returns the updated appointment including `queueCode` when a number was issued for today.
  - (Task 4, API) `POST /api/queue/appointments/:id/issue` (queue.create) backfills today's number for an `arrived` visit and is idempotent; 409 «Номер выдаётся только пришедшему пациенту» / «Запись не на сегодня».
- Produces:
  - `apps/web/src/modules/queue/components/QueueCodeBadge.tsx`: `export function QueueCodeBadge({ code }: { code: string | null | undefined }): ReactElement | null` (null for null/undefined/blank).
  - `apps/web/src/modules/queue/print/ticketHtml.ts`: `export function buildTicketHtml(ticket: QueueTicket): string` (full HTML document) and `export function formatTicketDateTime(isoInstant: string, timeZone: string): string` ("30.09.2026 11:05").
  - `apps/web/src/modules/queue/print/printTicket.ts`: `export function printQueueTicket(ticket: QueueTicket): void`.
  - `AppointmentCard` gains REQUIRED props `canPrintQueueTicket: boolean; isPrintingTicket: boolean; onPrintTicket: () => void; canIssueQueueNumber: boolean; isIssuingQueueNumber: boolean; onIssueQueueNumber: () => void`; `AppointmentMobileCard` gains the same props as OPTIONAL.
  - `apps/web/src/modules/appointments/utils/queueIssue.ts`: `issueQueueNumber(appointmentId: number, fallbackMessage: string): Promise<QueueIssueResult>` (never throws; `QueueIssueResult = { ok: true; code: string; entry: QueueEntry } | { ok: false; message: string }`) and `withIssuedQueueNumber(appointment: Appointment, entry: QueueEntry): Appointment`.
  - `apps/web/src/modules/dashboard/utils/arrivalToast.ts`: `arrivalToastMessage(appointment: Pick<Appointment, "queueCode"> | null | undefined, t: ArrivalToastTranslate): string | null`.
  - i18n keys (ru + uz): `appointments.queue.issued` (`{{code}}`), `appointments.queue.printTicket`, `appointments.queue.ticket`, `appointments.queue.dismiss`, `appointments.queue.printFailed`, `appointments.queue.issue`, `appointments.queue.issueFailed`.

> Gotchas for this task (read once):
> - Web vitest runs in the plain `node` environment: no `window`, no `document`. Pure builders are tested directly; the iframe printer is tested with a fake `document`/`window` stubbed via `vi.stubGlobal`; components are rendered with `react-test-renderer`.
> - Both locale files and every appointments file this task modifies are checked out with CRLF line endings (`core.autocrlf=true`, git stores LF; a few other files, e.g. `DoctorsPage.tsx` and `DashboardPage.tsx`, are LF). Use the Edit tool with the exact snippets below — it matches regardless of CRLF and keeps the file's endings. Never rewrite a locale file through `JSON.stringify` or a formatter.
> - «Выдать номер» exists for visits that are already `arrived` but have no number: marked «Пришёл» before this release, or on a day the number could not be issued. Only `canIssueQueue` roles (superadmin, reception) see it; «Талон» replaces it as soon as the visit has a code.
> - `scripts/check-i18n.cjs` checks every quoted `"<namespace>.<key>"` literal in non-test `src/**` files. All keys used below already exist (`appointment.markArrived`, `appointments.statusLabels.*`, `appointments.startConsultation`, `appointmentActions.startConsultation`) or are added in Steps 13 and 21. Ticket labels are bilingual constants, not keys.
> - The status button that moves `scheduled`/`confirmed` to `arrived` is the same `updateStatus` handler that later moves `arrived` → `in_consultation`; only the LABEL changes here (action key stays `"start"`).

- [ ] **Step 1: Write the failing test for the ticket HTML builder**

Create `apps/web/src/modules/queue/print/ticketHtml.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { QueueTicket } from "../api/queueTypes";
import { buildTicketHtml, formatTicketDateTime } from "./ticketHtml";

const ticket = (patch: Partial<QueueTicket> = {}): QueueTicket => ({
  appointmentId: 42,
  clinicName: "Kamilovs Clinic",
  code: "К-05",
  number: 5,
  doctorName: "Каримов Азиз",
  specialty: "Терапевт",
  room: "12",
  issuedAt: "2026-09-30T06:05:00.000Z",
  aheadCount: 3,
  timeZone: "Asia/Tashkent",
  ...patch,
});

describe("formatTicketDateTime", () => {
  it("formats the issue instant in the clinic time zone", () => {
    expect(formatTicketDateTime("2026-09-30T06:05:00.000Z", "Asia/Tashkent")).toBe("30.09.2026 11:05");
    expect(formatTicketDateTime("2026-09-30T19:00:00.000Z", "Asia/Tashkent")).toBe("01.10.2026 00:00");
  });

  it("falls back to Asia/Tashkent for an unknown zone and to a dash for a broken instant", () => {
    expect(formatTicketDateTime("2026-09-30T06:05:00.000Z", "Not/AZone")).toBe("30.09.2026 11:05");
    expect(formatTicketDateTime("not-a-date", "Asia/Tashkent")).toBe("—");
  });
});

describe("buildTicketHtml", () => {
  it("prints a 58 mm bilingual ticket with the big code, doctor, room, time and people ahead", () => {
    const html = buildTicketHtml(ticket());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: 58mm auto; margin: 0; }");
    expect(html).toContain("width: 58mm;");
    expect(html).toContain('<div class="clinic">Kamilovs Clinic</div>');
    expect(html).toContain('<div class="label">Navbat raqami / Номер очереди</div>');
    expect(html).toContain('<div class="code">К-05</div>');
    expect(html).toContain('<div class="label">Shifokor / Врач</div>');
    expect(html).toContain('<div class="value">Каримов Азиз</div>');
    expect(html).toContain('<div class="specialty">Терапевт</div>');
    expect(html).toContain('<div class="label">Xona / Кабинет</div>');
    expect(html).toContain('<div class="value">12</div>');
    expect(html).toContain('<div class="label">Oldingizda / Перед вами</div>');
    expect(html).toContain('<div class="value">3</div>');
    expect(html).toContain('<div class="when">30.09.2026 11:05</div>');
  });

  it("shows a dash for a doctor without a room and skips an empty specialty", () => {
    const html = buildTicketHtml(ticket({ room: null, specialty: "  ", aheadCount: 0 }));
    expect(html).toContain('<div class="value">—</div>');
    expect(html).not.toContain('class="specialty"');
    expect(html).toContain('<div class="value">0</div>');
  });

  it("escapes every value written into the print document", () => {
    const html = buildTicketHtml(
      ticket({
        clinicName: '<img src=x onerror="alert(1)">',
        doctorName: `"Tom" & 'Jerry'`,
        specialty: "<b>ЛОР</b>",
        room: "<script>",
        code: "<i>К-05</i>",
      })
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>ЛОР</b>");
    expect(html).not.toContain("<i>К-05</i>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&quot;Tom&quot; &amp; &#39;Jerry&#39;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;i&gt;К-05&lt;/i&gt;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/print/ticketHtml.test.ts`
Expected: FAIL with `Error: Cannot find module './ticketHtml' imported from '…/ticketHtml.test.ts'`.

- [ ] **Step 3: Implement the ticket HTML builder**

Create `apps/web/src/modules/queue/print/ticketHtml.ts`:
```ts
import type { QueueTicket } from "../api/queueTypes";

/**
 * Printed queue ticket (58 mm thermal paper; fits 80 mm too). Labels are bilingual constants, not i18n keys:
 * the patient reads the ticket in either language whatever the receptionist's UI language is.
 */
const LABEL_NUMBER = "Navbat raqami / Номер очереди";
const LABEL_DOCTOR = "Shifokor / Врач";
const LABEL_ROOM = "Xona / Кабинет";
const LABEL_AHEAD = "Oldingizda / Перед вами";
const DOCUMENT_TITLE = "Navbat taloni / Талон очереди";
const DEFAULT_CLINIC_NAME = "Klinika / Клиника";
const FALLBACK_TIME_ZONE = "Asia/Tashkent";
const EMPTY = "—";

/** The ticket is written into a same-origin frame: every value must be escaped. */
const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatInZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
};

/** "30.09.2026 11:05" for an ISO instant in the clinic time zone; unknown zone → Asia/Tashkent; bad instant → "—". */
export function formatTicketDateTime(isoInstant: string, timeZone: string): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return EMPTY;
  try {
    return formatInZone(date, timeZone);
  } catch {
    // RangeError: the server sent a zone this browser's ICU does not know.
    return formatInZone(date, FALLBACK_TIME_ZONE);
  }
}

const field = (label: string, value: string): string =>
  `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;

/** Full HTML document for one ticket, ready for document.write into the print frame. */
export function buildTicketHtml(ticket: QueueTicket): string {
  const clinicName = ticket.clinicName?.trim() || DEFAULT_CLINIC_NAME;
  const specialty = ticket.specialty?.trim() ?? "";
  const room = ticket.room?.trim() || EMPTY;
  const ahead = String(Math.max(0, Math.trunc(Number(ticket.aheadCount) || 0)));
  const when = formatTicketDateTime(ticket.issuedAt, ticket.timeZone);

  // `size: 58mm auto` mirrors printReceipt (`80mm auto`). Chrome drops that declaration as invalid and takes the
  // paper size from the printer driver, which is what a roll printer needs. Never change it to `size: 58mm`:
  // that means a 58x58 mm page and splits a tall ticket across pages.
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(DOCUMENT_TITLE)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { color: #000; font-family: Arial, "Segoe UI", sans-serif; }
  .ticket { width: 58mm; box-sizing: border-box; padding: 3mm 3mm 6mm; text-align: center; }
  .clinic { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; overflow-wrap: break-word; }
  .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .label { font-size: 10px; letter-spacing: 0.02em; }
  .code { font-size: 42px; font-weight: 800; line-height: 1.1; margin: 1mm 0; white-space: nowrap; }
  .field { margin: 1.5mm 0; }
  .value { font-size: 13px; font-weight: 700; overflow-wrap: break-word; }
  .specialty { font-size: 11px; margin-top: 0.5mm; overflow-wrap: break-word; }
  .when { font-size: 11px; margin-top: 2mm; }
</style>
</head>
<body>
<div class="ticket">
<div class="clinic">${escapeHtml(clinicName)}</div>
<div class="rule"></div>
<div class="label">${escapeHtml(LABEL_NUMBER)}</div>
<div class="code">${escapeHtml(ticket.code)}</div>
<div class="rule"></div>
<div class="field"><div class="label">${escapeHtml(LABEL_DOCTOR)}</div><div class="value">${escapeHtml(ticket.doctorName)}</div>${
    specialty ? `<div class="specialty">${escapeHtml(specialty)}</div>` : ""
  }</div>
${field(LABEL_ROOM, room)}
${field(LABEL_AHEAD, ahead)}
<div class="rule"></div>
<div class="when">${escapeHtml(when)}</div>
</div>
</body>
</html>`;
}
```
`issuedAt` is a real instant (timestamptz → ISO), so it IS converted to `ticket.timeZone`; do not apply this to wall-clock `startAt` strings. `hourCycle: "h23"` (not `hour12: false`) avoids the "24:05" midnight rendering some ICU builds produce.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/print/ticketHtml.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the iframe printer**

Create `apps/web/src/modules/queue/print/printTicket.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueTicket } from "../api/queueTypes";
import { printQueueTicket } from "./printTicket";

const ticket: QueueTicket = {
  appointmentId: 42,
  clinicName: "Kamilovs Clinic",
  code: "К-05",
  number: 5,
  doctorName: "Каримов Азиз",
  specialty: "Терапевт",
  room: "12",
  issuedAt: "2026-09-30T06:05:00.000Z",
  aheadCount: 3,
  timeZone: "Asia/Tashkent",
};

/** Minimal stand-in for a same-origin iframe: vitest runs in node, there is no DOM. */
function fakeFrame(readyState: "complete" | "loading") {
  const listeners: Record<string, Array<() => void>> = {};
  const doc = { readyState, open: vi.fn(), write: vi.fn(), close: vi.fn() };
  const win = {
    document: doc,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    }),
    focus: vi.fn(),
    print: vi.fn(),
  };
  const frame = { style: { cssText: "" }, tabIndex: 0, setAttribute: vi.fn(), contentWindow: win, remove: vi.fn() };
  const fire = (type: string) => (listeners[type] ?? []).forEach((listener) => listener());
  return { frame, win, doc, fire };
}

let fake: ReturnType<typeof fakeFrame>;
let appendChild: ReturnType<typeof vi.fn>;

function setup(readyState: "complete" | "loading") {
  fake = fakeFrame(readyState);
  appendChild = vi.fn();
  vi.stubGlobal("document", { createElement: vi.fn(() => fake.frame), body: { appendChild } });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Delegate at call time so the fake timers installed above are used.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("printQueueTicket", () => {
  it("writes the ticket into a hidden frame and prints once when the document is ready at once (Chrome)", () => {
    setup("complete");
    printQueueTicket(ticket);
    expect(appendChild).toHaveBeenCalledWith(fake.frame);
    expect(fake.frame.style.cssText).toContain("visibility:hidden");
    expect(fake.doc.write).toHaveBeenCalledTimes(1);
    expect(fake.doc.write.mock.calls[0][0]).toContain('<div class="code">К-05</div>');
    expect(fake.doc.close).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(fake.win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("waits for load when the document is still loading", () => {
    setup("loading");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(200);
    expect(fake.win.print).not.toHaveBeenCalled();
    fake.fire("load");
    vi.advanceTimersByTime(100);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("still prints after 500 ms when load never fires", () => {
    setup("loading");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(499);
    expect(fake.win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.win.print).toHaveBeenCalledTimes(1);
  });

  it("removes the frame after the print dialog closes", () => {
    setup("complete");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(100);
    expect(fake.frame.remove).not.toHaveBeenCalled();
    fake.fire("afterprint");
    vi.advanceTimersByTime(0);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
  });

  it("removes the frame after 60 s when afterprint never fires", () => {
    setup("complete");
    printQueueTicket(ticket);
    vi.advanceTimersByTime(59_999);
    expect(fake.frame.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.frame.remove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/print/printTicket.test.ts`
Expected: FAIL with `Error: Cannot find module './printTicket' imported from '…/printTicket.test.ts'`.

- [ ] **Step 7: Implement the iframe printer**

Create `apps/web/src/modules/queue/print/printTicket.ts`:
```ts
import type { QueueTicket } from "../api/queueTypes";
import { buildTicketHtml } from "./ticketHtml";

/** Remove the frame even when the browser never fires afterprint. */
const CLEANUP_AFTER_MS = 60_000;
/** Let the written document lay out before the print dialog snapshots it. */
const PRINT_DELAY_MS = 100;
/** Safety net: print even if the frame's load event was missed. */
const PRINT_FALLBACK_MS = 500;

/**
 * Prints one queue ticket through a hidden same-origin iframe. Unlike window.open this is not a popup,
 * so it still works after an awaited API call (popup blockers only allow window.open inside the click).
 */
export function printQueueTicket(ticket: QueueTicket): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Zero-size but rendered: some browsers print a blank page for a display:none frame.
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  let removed = false;
  let printed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    window.clearTimeout(cleanupTimer);
    frame.remove();
  };
  const cleanupTimer = window.setTimeout(cleanup, CLEANUP_AFTER_MS);

  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    cleanup();
    throw new Error("Print frame is not available");
  }

  const runPrint = () => {
    if (printed || removed) return;
    printed = true;
    frameWindow.addEventListener("afterprint", () => window.setTimeout(cleanup, 0));
    frameWindow.focus();
    frameWindow.print();
  };

  const frameDocument = frameWindow.document;
  frameDocument.open();
  frameDocument.write(buildTicketHtml(ticket));
  frameDocument.close();
  // Chrome finishes a written document synchronously (readyState "complete", no load event follows);
  // other engines may still fire load. document.open() drops listeners added before it, so listen only now.
  if (frameDocument.readyState === "complete") {
    window.setTimeout(runPrint, PRINT_DELAY_MS);
  } else {
    frameWindow.addEventListener("load", () => window.setTimeout(runPrint, PRINT_DELAY_MS));
  }
  window.setTimeout(runPrint, PRINT_FALLBACK_MS);
}
```
Why not "wait for load" only: verified in Chromium — after `document.close()` on an about:blank frame the document is already `complete` and NO load event is fired, and a `load` listener added before `document.open()` is erased (HTML spec "document open steps"). The `printed` flag keeps the 500 ms safety timer from printing twice. Chrome's `print()` blocks until the dialog closes and fires `afterprint`; removal is deferred with `setTimeout(…, 0)` so the frame outlives the `print()` call.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/print/printTicket.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Write the failing test for the queue code badge**

Create `apps/web/src/modules/queue/components/QueueCodeBadge.test.tsx`:
```tsx
import React from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { QueueCodeBadge } from "./QueueCodeBadge";

describe("QueueCodeBadge", () => {
  it("renders the ticket code as one pill", () => {
    const tree = create(<QueueCodeBadge code="К-05" />).toJSON();
    expect(tree).toMatchObject({ type: "span", children: ["К-05"] });
  });

  it("renders nothing when the appointment has no queue code", () => {
    expect(create(<QueueCodeBadge code={null} />).toJSON()).toBeNull();
    expect(create(<QueueCodeBadge code={undefined} />).toJSON()).toBeNull();
    expect(create(<QueueCodeBadge code="  " />).toJSON()).toBeNull();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails, then implement the badge**

Run: `cd apps/web && npx vitest run src/modules/queue/components/QueueCodeBadge.test.tsx`
Expected: FAIL with `Error: Cannot find module './QueueCodeBadge' imported from '…/QueueCodeBadge.test.tsx'`.

Create `apps/web/src/modules/queue/components/QueueCodeBadge.tsx` (no i18n inside, so it needs no mocks and the Queue page can reuse it):
```tsx
import type { ReactElement } from "react";

type Props = { code: string | null | undefined };

/** Queue ticket code ("К-05") as a compact pill; renders nothing when the appointment has no number. */
export function QueueCodeBadge({ code }: Props): ReactElement | null {
  const value = code?.trim();
  if (!value) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-sky-800">
      {value}
    </span>
  );
}
```

Run: `cd apps/web && npx vitest run src/modules/queue/components/QueueCodeBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 11: Write the failing test for the arrival wording**

Create `apps/web/src/modules/appointments/components/appointmentActions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";
import { buildUnifiedAppointmentActions } from "./appointmentActions";

const t = (key: string) => key;

const appointment = (status: AppointmentStatus): Appointment => ({
  id: 1,
  patientId: 1,
  doctorId: 1,
  serviceId: 1,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status,
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
});

const actionsFor = (status: AppointmentStatus, flags: { canCreateInvoice?: boolean; hasInvoice?: boolean } = {}) =>
  buildUnifiedAppointmentActions({
    appointment: appointment(status),
    canCreateInvoice: flags.canCreateInvoice ?? false,
    hasInvoice: flags.hasInvoice ?? false,
    t,
  });

describe("buildUnifiedAppointmentActions", () => {
  it("labels the first step «Отметить приход» for booked visits (it moves them to arrived and issues a queue number)", () => {
    expect(actionsFor("scheduled")).toEqual([{ key: "start", label: "appointment.markArrived", tone: "primary" }]);
    expect(actionsFor("confirmed")).toEqual([{ key: "start", label: "appointment.markArrived", tone: "primary" }]);
  });

  it("labels the next step «Начать приём» once the patient has arrived", () => {
    expect(actionsFor("arrived")).toEqual([
      { key: "start", label: "appointmentActions.startConsultation", tone: "primary" },
    ]);
  });

  it("keeps the later stages unchanged", () => {
    expect(actionsFor("in_consultation").map((a) => a.key)).toEqual(["workspace", "complete"]);
    expect(actionsFor("completed", { canCreateInvoice: true }).map((a) => a.key)).toEqual(["workspace", "invoice"]);
    expect(actionsFor("completed", { canCreateInvoice: true, hasInvoice: true }).map((a) => a.key)).toEqual([
      "workspace",
    ]);
    expect(actionsFor("cancelled").map((a) => a.key)).toEqual(["open"]);
    expect(actionsFor("no_show").map((a) => a.key)).toEqual(["open"]);
  });
});
```
The test imports only the `Appointment` TYPE, so `api/http.ts` (which throws at import time without `VITE_API_URL`) is never loaded.

- [ ] **Step 12: Run it (red), change the label, run it (green)**

Run: `cd apps/web && npx vitest run src/modules/appointments/components/appointmentActions.test.ts`
Expected: FAIL — 1 failed, 2 passed: `AssertionError: expected [ { key: 'start', …(2) } ] to deeply equal [ { key: 'start', …(2) } ]` with `- "label": "appointment.markArrived"` / `+ "label": "appointmentActions.startConsultation"`.

In `apps/web/src/modules/appointments/components/appointmentActions.ts` replace:
```ts
  if (status === "scheduled" || status === "arrived" || status === "confirmed") {
    actions.push({ key: "start", label: t("appointmentActions.startConsultation"), tone: "primary" });
    return actions;
  }
```
with:
```ts
  if (status === "scheduled" || status === "confirmed") {
    // «Отметить приход»: the next status is arrived, which issues today's queue number on the server.
    actions.push({ key: "start", label: t("appointment.markArrived"), tone: "primary" });
    return actions;
  }

  if (status === "arrived") {
    actions.push({ key: "start", label: t("appointmentActions.startConsultation"), tone: "primary" });
    return actions;
  }
```

Run: `cd apps/web && npx vitest run src/modules/appointments/components/appointmentActions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 13: Add the `appointments.queue.*` keys (ru + uz)**

In `apps/web/src/locales/ru.json` replace:
```json
  "appointments": {
    "today": "Сегодня",
```
with:
```json
  "appointments": {
    "queue": {
      "issued": "Выдан номер {{code}}",
      "printTicket": "Печать талона",
      "ticket": "Талон",
      "dismiss": "Скрыть",
      "printFailed": "Не удалось напечатать талон"
    },
    "today": "Сегодня",
```

In `apps/web/src/locales/uz.json` replace:
```json
  "appointments": {
    "today": "Bugun",
```
with:
```json
  "appointments": {
    "queue": {
      "issued": "Navbat raqami berildi: {{code}}",
      "printTicket": "Talonni chop etish",
      "ticket": "Talon",
      "dismiss": "Yopish",
      "printFailed": "Talonni chop etib bo'lmadi"
    },
    "today": "Bugun",
```
(`"appointments": {` occurs exactly once in each file; Tasks 6 and 7 do not touch these lines. uz.json uses the ASCII apostrophe (`bo'lmadi`) like the rest of the file.)

Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1729 keys, full ru/uz parity, all code references resolve.` (5 more than after Task 7.)

Run (line-ending sanity check, from `apps/web`): `node -e "for (const f of ['src/locales/ru.json','src/locales/uz.json']) { const s = require('fs').readFileSync(f, 'utf8'); const crlf = (s.match(/\r\n/g) || []).length, lf = (s.match(/\n/g) || []).length; console.log(f, crlf === lf ? 'CRLF ok' : 'MIXED ' + crlf + '/' + lf); }"`
Expected: `src/locales/ru.json CRLF ok` and `src/locales/uz.json CRLF ok`.

- [ ] **Step 14: Write the failing test for the desktop card (status label + «Талон»)**

Create `apps/web/src/modules/appointments/components/AppointmentCard.test.tsx`:
```tsx
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// shared/ui (Logo -> useClinic) imports api/http, which imports ../i18n and initialises i18next at import time.
vi.mock("../../../i18n", () => ({ default: { t: (key: string) => key } }));
import { AppointmentCard } from "./AppointmentCard";

const appointment = (status: AppointmentStatus, queueCode: string | null = null): Appointment => ({
  id: 7,
  patientId: 1,
  doctorId: 2,
  serviceId: 3,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status,
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
  queueNumber: queueCode ? 5 : null,
  queueCode,
});

const render = (item: Appointment, canPrintQueueTicket = true) => {
  const onPrintTicket = vi.fn();
  const view: ReactTestRenderer = create(
    <AppointmentCard
      appointment={item}
      invoice={null}
      patientName="Test patient"
      doctorName="Test doctor"
      service={undefined}
      timeLabel="10:00"
      glassPanelClass=""
      isSubmitting={false}
      canManageAppointmentFlow
      showFinancialDetails={false}
      canCreateInvoice={false}
      onMarkArrived={vi.fn()}
      onCompleteConsultation={vi.fn()}
      onCreateInvoice={vi.fn()}
      onCancelAppointment={vi.fn()}
      onEditPrice={vi.fn()}
      canHardDeleteAppointment={false}
      onDeleteAppointment={vi.fn()}
      showCancelButton={false}
      canEditAppointmentPrice={false}
      onOpenDoctorWorkspace={vi.fn()}
      onCardClick={vi.fn()}
      canPrintQueueTicket={canPrintQueueTicket}
      isPrintingTicket={false}
      onPrintTicket={onPrintTicket}
    />
  );
  const button = (label: string) => view.root.findAllByType("button").find((b) => b.props.children === label);
  const texts = (): string[] =>
    view.root.findAll((node) => typeof node.type === "string").flatMap((node) =>
      node.children.filter((child): child is string => typeof child === "string")
    );
  return { view, button, texts, onPrintTicket };
};

describe("AppointmentCard queue details", () => {
  it("shows the real status label for every status", () => {
    const statuses: AppointmentStatus[] = ["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "no_show"];
    for (const status of statuses) {
      expect(render(appointment(status)).texts()).toContain(`appointments.statusLabels.${status}`);
    }
  });

  it("shows the queue code and a «Талон» button for an arrived patient with a number", () => {
    const card = render(appointment("arrived", "К-05"));
    expect(card.texts()).toContain("К-05");
    card.button("appointments.queue.ticket")!.props.onClick();
    expect(card.onPrintTicket).toHaveBeenCalledTimes(1);
  });

  it("hides «Талон» without a number, after arrival, or without queue access", () => {
    expect(render(appointment("arrived")).button("appointments.queue.ticket")).toBeUndefined();
    expect(render(appointment("in_consultation", "К-05")).button("appointments.queue.ticket")).toBeUndefined();
    expect(render(appointment("arrived", "К-05"), false).button("appointments.queue.ticket")).toBeUndefined();
  });

  it("labels the first step «Отметить приход» for a booked visit", () => {
    expect(render(appointment("scheduled")).button("appointment.markArrived")).toBeDefined();
  });
});
```
`api/http.ts` still loads (through `shared/ui/Logo`) and needs `VITE_API_URL`; vitest reads it from the tracked `apps/web/.env`, as for the existing tests.

- [ ] **Step 15: Run the card test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/appointments/components/AppointmentCard.test.tsx`
Expected: FAIL — 2 failed, 2 passed: `shows the real status label for every status` (`AssertionError: expected [ '10:00', … ] to include 'appointments.statusLabels.scheduled'` — the card still uses `appointment.status.*`) and `shows the queue code and a «Талон» button…` (`… to include 'К-05'`).

- [ ] **Step 16: Implement the desktop card changes**

In `apps/web/src/modules/appointments/components/AppointmentCard.tsx` replace:
```tsx
import { ActionButtons, SectionCard, StatusBadge } from "../../../shared/ui";
import { buildUnifiedAppointmentActions } from "./appointmentActions";
```
with:
```tsx
import { ActionButtons, SectionCard, StatusBadge } from "../../../shared/ui";
import { QueueCodeBadge } from "../../queue/components/QueueCodeBadge";
import { buildUnifiedAppointmentActions } from "./appointmentActions";
```

In the same file replace:
```tsx
  onOpenDoctorWorkspace: () => void;
  onCardClick: () => void;
};
```
with:
```tsx
  onOpenDoctorWorkspace: () => void;
  onCardClick: () => void;
  /** «Талон»: роль видит очередь (queue.read); кнопка только у записи «Пришёл» с номером. */
  canPrintQueueTicket: boolean;
  isPrintingTicket: boolean;
  onPrintTicket: () => void;
};
```

In the same file replace:
```tsx
  onOpenDoctorWorkspace,
  onCardClick,
}) => {
```
with:
```tsx
  onOpenDoctorWorkspace,
  onCardClick,
  canPrintQueueTicket,
  isPrintingTicket,
  onPrintTicket,
}) => {
```

In the same file replace (the old chain mapped only four statuses from the singular `appointment.status.*` namespace, so «Пришёл» rendered as «Запланировано»):
```tsx
  const statusLabel =
    appointment.status === "in_consultation"
      ? t("appointment.status.in_consultation")
      : appointment.status === "completed"
        ? t("appointment.status.completed")
        : appointment.status === "cancelled"
          ? t("appointment.status.cancelled")
          : t("appointment.status.scheduled");
  const isCancelled = appointment.status === "cancelled";
```
with:
```tsx
  const statusLabelMap: Record<Appointment["status"], string> = {
    scheduled: t("appointments.statusLabels.scheduled"),
    confirmed: t("appointments.statusLabels.confirmed"),
    arrived: t("appointments.statusLabels.arrived"),
    in_consultation: t("appointments.statusLabels.in_consultation"),
    completed: t("appointments.statusLabels.completed"),
    cancelled: t("appointments.statusLabels.cancelled"),
    no_show: t("appointments.statusLabels.no_show"),
  };
  const statusLabel = statusLabelMap[appointment.status] ?? appointment.status;
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
  const isCancelled = appointment.status === "cancelled";
```

In the same file replace:
```tsx
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5 text-sm font-semibold tabular-nums text-[#111827]">
              {timeLabel}
            </div>
            <StatusBadge
```
with:
```tsx
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5 text-sm font-semibold tabular-nums text-[#111827]">
                {timeLabel}
              </div>
              <QueueCodeBadge code={appointment.queueCode} />
            </div>
            <StatusBadge
```

In the same file replace (end of the unified-actions map inside `<ActionButtons>`; the wrapper `div` already calls `e.stopPropagation()`, so the button does not open the details modal):
```tsx
              ))}
              {showCancelButton ? (
```
with:
```tsx
              ))}
              {showTicketButton ? (
                <button
                  type="button"
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                  disabled={isSubmitting || isPrintingTicket}
                  onClick={onPrintTicket}
                >
                  {t("appointments.queue.ticket")}
                </button>
              ) : null}
              {showCancelButton ? (
```

Run: `cd apps/web && npx vitest run src/modules/appointments/components/AppointmentCard.test.tsx`
Expected: PASS (4 tests). (Do not run the typecheck yet: `AppointmentsPage` does not pass the three new required props until Step 18.)

- [ ] **Step 17: Mobile card — badge and «Талон»**

In `apps/web/src/modules/appointments/components/AppointmentMobileCard.tsx` replace:
```tsx
import { getAllServices } from "../../../shared/lib/appointments/getAllServices";
import { buildUnifiedAppointmentActions } from "./appointmentActions";
```
with:
```tsx
import { getAllServices } from "../../../shared/lib/appointments/getAllServices";
import { QueueCodeBadge } from "../../queue/components/QueueCodeBadge";
import { buildUnifiedAppointmentActions } from "./appointmentActions";
```

In the same file replace:
```tsx
  onCancelAppointment?: () => void;
  onCopyPatientPhone?: (phone: string) => void;
};
```
with:
```tsx
  onCancelAppointment?: () => void;
  onCopyPatientPhone?: (phone: string) => void;
  /** «Талон»: роль видит очередь (queue.read); кнопка только у записи «Пришёл» с номером. */
  canPrintQueueTicket?: boolean;
  isPrintingTicket?: boolean;
  onPrintTicket?: () => void;
};
```

In the same file replace:
```tsx
  onCancelAppointment,
  onCopyPatientPhone,
}) => {
  const { t } = useTranslation();
```
with:
```tsx
  onCancelAppointment,
  onCopyPatientPhone,
  canPrintQueueTicket = false,
  isPrintingTicket = false,
  onPrintTicket,
}) => {
  const { t } = useTranslation();
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
```

In the same file replace:
```tsx
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone[appointment.status]}`}
          >
            {getStatusLabel(appointment.status, t)}
          </span>
        </div>
```
with:
```tsx
          <div className="flex shrink-0 items-center gap-1.5">
            <QueueCodeBadge code={appointment.queueCode} />
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone[appointment.status]}`}
            >
              {getStatusLabel(appointment.status, t)}
            </span>
          </div>
        </div>
```

In the same file replace:
```tsx
          ))}
          {showCancelButton && onCancelAppointment ? (
```
with:
```tsx
          ))}
          {showTicketButton && onPrintTicket ? (
            <button
              type="button"
              onClick={onPrintTicket}
              disabled={isSubmitting || isPrintingTicket}
              className="inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"
            >
              {t("appointments.queue.ticket")}
            </button>
          ) : null}
          {showCancelButton && onCancelAppointment ? (
```
(The mobile status pill already uses the correct `appointments.status*` labels; only the badge is added.)

- [ ] **Step 18: AppointmentsPage — issued-ticket banner, «Талон» buttons, modal wording**

In `apps/web/src/modules/appointments/pages/AppointmentsPage.tsx` make the replacements 18a–18n below (every "Replace:" in this step targets this file). All anchors are original lines; no earlier task edits this file.

18a. Imports. Replace:
```tsx
  canReadPatients,
  canSetAppointmentCommercialPrice,
```
with:
```tsx
  canReadPatients,
  canReadQueue,
  canSetAppointmentCommercialPrice,
```

Replace:
```tsx
import { formatSum } from "../../../utils/formatMoney";
```
with:
```tsx
import { formatSum } from "../../../utils/formatMoney";
import { queueApi } from "../../queue/api/queueApi";
import { QueueCodeBadge } from "../../queue/components/QueueCodeBadge";
import { printQueueTicket } from "../../queue/print/printTicket";
```

18b. Constants. Replace:
```tsx
const MOBILE_WINDOW_STEP = 40;
```
with:
```tsx
const MOBILE_WINDOW_STEP = 40;
/** «Выдан номер К-05» stays long enough to press «Печать талона» (the plain toast hides after 2.5 s). */
const ISSUED_TICKET_VISIBLE_MS = 30_000;

type IssuedTicketState = { appointmentId: number; code: string };
```

18c. Role flag. Replace:
```tsx
  const canCreateInvoice = !!ur && hasPermission(ur, "invoices", "create");
```
with:
```tsx
  const canCreateInvoice = !!ur && hasPermission(ur, "invoices", "create");
  const canPrintQueueTicket = canReadQueue(ur);
```

18d. State. Replace:
```tsx
  const [toast, setToast] = React.useState<string | null>(null);
```
with:
```tsx
  const [toast, setToast] = React.useState<string | null>(null);
  const [issuedTicket, setIssuedTicket] = React.useState<IssuedTicketState | null>(null);
  const [printingTicketId, setPrintingTicketId] = React.useState<number | null>(null);
```

18e. Auto-dismiss after 30 s (a new ticket object restarts the timer). Replace:
```tsx
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);
```
with:
```tsx
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!issuedTicket) return;
    const timer = window.setTimeout(() => setIssuedTicket(null), ISSUED_TICKET_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [issuedTicket]);
```

18f. `updateStatus`: show the banner instead of the plain toast when the PUT returned a number. Replace:
```tsx
      setDetailsModal((d) =>
        d.appointment?.id === updated.id ? { open: d.open, appointment: updated } : d
      );
      setToast(t("appointments.messages.statusUpdated"));
```
with:
```tsx
      setDetailsModal((d) =>
        d.appointment?.id === updated.id ? { open: d.open, appointment: updated } : d
      );
      if (nextStatus === "arrived" && updated.queueCode) {
        // The server issued today's queue number in the same request (records for another day get none).
        setIssuedTicket({ appointmentId: updated.id, code: updated.queueCode });
      } else {
        setToast(t("appointments.messages.statusUpdated"));
      }
```

18g. Print handler (the iframe printer is not a popup, so awaiting the API first is fine). Replace:
```tsx
  const openConsultation = (appointment: Appointment) => {
    navigate(`/doctor-workspace/${appointment.id}`);
  };
```
with:
```tsx
  const openConsultation = (appointment: Appointment) => {
    navigate(`/doctor-workspace/${appointment.id}`);
  };

  const printTicket = async (appointmentId: number) => {
    if (!canPrintQueueTicket) return;
    setPrintingTicketId(appointmentId);
    setError(null);
    try {
      const ticket = await queueApi.ticket(appointmentId);
      printQueueTicket(ticket);
    } catch {
      setError(t("appointments.queue.printFailed"));
    } finally {
      setPrintingTicketId(null);
    }
  };
```

18h. Banner next to the toast. Replace:
```tsx
        {toast && (
          <SectionCard className="border-[#bbf7d0] bg-[#f0fdf4] p-4 text-sm text-[#166534]">
            {toast}
          </SectionCard>
        )}
```
with:
```tsx
        {toast && (
          <SectionCard className="border-[#bbf7d0] bg-[#f0fdf4] p-4 text-sm text-[#166534]">
            {toast}
          </SectionCard>
        )}
        {issuedTicket && (
          <SectionCard className="flex flex-wrap items-center gap-3 border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a8a]">
            <span className="font-semibold">{t("appointments.queue.issued", { code: issuedTicket.code })}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {canPrintQueueTicket ? (
                <button
                  type="button"
                  disabled={printingTicketId === issuedTicket.appointmentId}
                  onClick={() => void printTicket(issuedTicket.appointmentId)}
                  className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50"
                >
                  {t("appointments.queue.printTicket")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIssuedTicket(null)}
                className="rounded-lg border border-[#bfdbfe] bg-white px-3 py-1.5 text-xs font-medium text-[#1e3a8a] shadow-sm transition hover:bg-[#dbeafe]"
              >
                {t("appointments.queue.dismiss")}
              </button>
            </div>
          </SectionCard>
        )}
```

18i. Mobile card props. `onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}` appears twice; the mobile one is the one followed by `/>`. Replace:
```tsx
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                  />
                );
```
with:
```tsx
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                    canPrintQueueTicket={canPrintQueueTicket}
                    isPrintingTicket={printingTicketId === appointment.id}
                    onPrintTicket={() => void printTicket(appointment.id)}
                  />
                );
```

18j. Desktop card props. Replace:
```tsx
                    onOpenDoctorWorkspace={() => openConsultation(appointment)}
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
```
with:
```tsx
                    onOpenDoctorWorkspace={() => openConsultation(appointment)}
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
                    canPrintQueueTicket={canPrintQueueTicket}
                    isPrintingTicket={printingTicketId === appointment.id}
                    onPrintTicket={() => void printTicket(appointment.id)}
```

18k. Details modal — «Талон» visibility (queue.read only; not tied to `showActions`, so read-only queue roles can reprint). Replace:
```tsx
            const showCancelBtn = showActions && shouldOfferCancel(ap);
```
with:
```tsx
            const showCancelBtn = showActions && shouldOfferCancel(ap);
            const showTicketBtn = canPrintQueueTicket && ap.status === "arrived" && Boolean(ap.queueCode);
```

18l. Details modal header — code next to the status. Replace:
```tsx
                    <StatusBadge tone={appointmentStatusToneForBadge(ap.status)} className="shrink-0">
                      {appointmentStatusDetailedRu(ap.status, t)}
                    </StatusBadge>
```
with:
```tsx
                    <div className="flex shrink-0 items-center gap-2">
                      <QueueCodeBadge code={ap.queueCode} />
                      <StatusBadge tone={appointmentStatusToneForBadge(ap.status)} className="shrink-0">
                        {appointmentStatusDetailedRu(ap.status, t)}
                      </StatusBadge>
                    </div>
```

18m. Details modal — the green button moves scheduled/confirmed to arrived, so label it accordingly. Replace:
```tsx
                          onClick={() => void updateStatus(ap)}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {t("appointments.startConsultation")}
                        </button>
```
with:
```tsx
                          onClick={() => void updateStatus(ap)}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {ap.status === "arrived"
                            ? t("appointments.startConsultation")
                            : t("appointment.markArrived")}
                        </button>
```

18n. Details modal footer — «Талон» on the left of «Закрыть». Replace:
```tsx
                  <div className="flex justify-end pt-1">
                    <button
```
with:
```tsx
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {showTicketBtn ? (
                      <button
                        type="button"
                        disabled={printingTicketId === ap.id}
                        onClick={() => void printTicket(ap.id)}
                        className="mr-auto inline-flex min-h-[40px] items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                      >
                        {t("appointments.queue.ticket")}
                      </button>
                    ) : null}
                    <button
```
(After «Отметить приход» inside the modal, `updateStatus` already swaps the modal's appointment for the returned one, so the modal immediately shows the code badge and «Талон»; the banner appears on the page behind it.)

- [ ] **Step 19: Write the failing tests for «Выдать номер»**

A visit marked «Пришёл» before this release (or whose number could not be issued) is `arrived` with `queueCode: null`: it never gets a ticket unless reception can backfill it with `POST /api/queue/appointments/:id/issue`. The card test renders the card with the real role helpers, so it proves the role rule too.

In `apps/web/src/modules/appointments/components/AppointmentCard.test.tsx` replace:
```tsx
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";
```
with:
```tsx
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";
import type { UserRole } from "../../../auth/types";
import { canIssueQueue, canReadQueue } from "../../../auth/roleGroups";
```

In the same file replace:
```tsx
const render = (item: Appointment, canPrintQueueTicket = true) => {
  const onPrintTicket = vi.fn();
```
with:
```tsx
const render = (item: Appointment, canPrintQueueTicket = true, canIssueQueueNumber = false) => {
  const onPrintTicket = vi.fn();
  const onIssueQueueNumber = vi.fn();
```

In the same file replace:
```tsx
      onPrintTicket={onPrintTicket}
    />
```
with:
```tsx
      onPrintTicket={onPrintTicket}
      canIssueQueueNumber={canIssueQueueNumber}
      isIssuingQueueNumber={false}
      onIssueQueueNumber={onIssueQueueNumber}
    />
```

In the same file replace:
```tsx
  return { view, button, texts, onPrintTicket };
};
```
with:
```tsx
  return { view, button, texts, onPrintTicket, onIssueQueueNumber };
};
/** The page passes canReadQueue(role) / canIssueQueue(role); the card only sees the booleans. */
const renderAs = (item: Appointment, role: UserRole) => render(item, canReadQueue(role), canIssueQueue(role));
```

In the same file replace:
```tsx
  it("labels the first step «Отметить приход» for a booked visit", () => {
    expect(render(appointment("scheduled")).button("appointment.markArrived")).toBeDefined();
  });
});
```
with:
```tsx
  it("labels the first step «Отметить приход» for a booked visit", () => {
    expect(render(appointment("scheduled")).button("appointment.markArrived")).toBeDefined();
  });
});

describe("AppointmentCard «Выдать номер»", () => {
  it("offers reception «Выдать номер» for an arrived patient without a number", () => {
    const card = renderAs(appointment("arrived"), "reception");
    card.button("appointments.queue.issue")!.props.onClick();
    expect(card.onIssueQueueNumber).toHaveBeenCalledTimes(1);
    expect(card.button("appointments.queue.ticket")).toBeUndefined();
  });

  it("shows «Талон» instead once the visit has a number", () => {
    const card = renderAs(appointment("arrived", "К-05"), "reception");
    expect(card.button("appointments.queue.issue")).toBeUndefined();
    expect(card.button("appointments.queue.ticket")).toBeDefined();
  });

  it("hides it from read-only queue roles and for visits that are not waiting", () => {
    expect(renderAs(appointment("arrived"), "manager").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("arrived"), "doctor").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("scheduled"), "reception").button("appointments.queue.issue")).toBeUndefined();
    expect(renderAs(appointment("in_consultation"), "reception").button("appointments.queue.issue")).toBeUndefined();
  });
});
```

Create `apps/web/src/modules/appointments/utils/queueIssue.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueEntry } from "../../queue/api/queueTypes";
import type { Appointment } from "../api/appointmentsFlowApi";

const mocks = vi.hoisted(() => ({ issue: vi.fn() }));
// The real queueApi would load api/http (VITE_API_URL, i18n); only issue() is used here.
vi.mock("../../queue/api/queueApi", () => ({ queueApi: { issue: mocks.issue } }));
import { issueQueueNumber, withIssuedQueueNumber } from "./queueIssue";

const entry = (code: string | null): QueueEntry => ({
  appointmentId: 7,
  doctorId: 2,
  patientId: 1,
  patientName: "Test patient",
  number: code ? 5 : null,
  code,
  state: "waiting",
  startAt: "2026-09-30 10:00:00",
  issuedAt: code ? "2026-09-30T05:10:00.000Z" : null,
  calledAt: null,
  callCount: 0,
});

const arrived: Appointment = {
  id: 7,
  patientId: 1,
  doctorId: 2,
  serviceId: 3,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status: "arrived",
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
  queueNumber: null,
  queueCode: null,
};

beforeEach(() => {
  mocks.issue.mockReset();
});

describe("issueQueueNumber («Выдать номер»)", () => {
  it("asks the server for today's number and returns the issued code", async () => {
    mocks.issue.mockResolvedValue({ entry: entry("К-05") });
    await expect(issueQueueNumber(7, "fallback")).resolves.toEqual({ ok: true, code: "К-05", entry: entry("К-05") });
    expect(mocks.issue).toHaveBeenCalledWith(7);
  });

  it("passes the server's refusal through (409 «Запись не на сегодня»)", async () => {
    mocks.issue.mockRejectedValue(Object.assign(new Error("Запись не на сегодня"), { status: 409 }));
    await expect(issueQueueNumber(7, "fallback")).resolves.toEqual({ ok: false, message: "Запись не на сегодня" });
  });

  it("falls back to the generic text for an unknown failure or an answer without a code", async () => {
    mocks.issue.mockRejectedValueOnce("boom").mockResolvedValueOnce({ entry: entry(null) });
    await expect(issueQueueNumber(7, "Не удалось выдать номер")).resolves.toEqual({ ok: false, message: "Не удалось выдать номер" });
    await expect(issueQueueNumber(7, "Не удалось выдать номер")).resolves.toEqual({ ok: false, message: "Не удалось выдать номер" });
  });
});

describe("withIssuedQueueNumber", () => {
  it("puts the issued number on the row shown in the list and in the details modal", () => {
    expect(withIssuedQueueNumber(arrived, entry("К-05"))).toEqual({
      ...arrived,
      queueNumber: 5,
      queueCode: "К-05",
      queueIssuedAt: "2026-09-30T05:10:00.000Z",
    });
    expect(arrived.queueCode).toBeNull(); // the input row is not mutated
  });
});
```
The test only imports the `Appointment`/`QueueEntry` TYPES and a mocked `queueApi`, so `api/http.ts` is never loaded.

- [ ] **Step 20: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/modules/appointments/components/AppointmentCard.test.tsx src/modules/appointments/utils/queueIssue.test.ts`
Expected: FAIL — `queueIssue.test.ts` with `Error: Cannot find module './queueIssue' imported from '…/queueIssue.test.ts'`; in `AppointmentCard.test.tsx` 1 of the 3 new tests fails (`offers reception «Выдать номер» …` with `TypeError: Cannot read properties of undefined (reading 'props')`, because the card has no such button yet); the other 2 new tests and the 4 older ones pass (`Tests  1 failed | 6 passed (7)`).

- [ ] **Step 21: Add the `appointments.queue.issue*` keys (ru + uz)**

In `apps/web/src/locales/ru.json` replace:
```json
      "printFailed": "Не удалось напечатать талон"
    },
```
with:
```json
      "printFailed": "Не удалось напечатать талон",
      "issue": "Выдать номер",
      "issueFailed": "Не удалось выдать номер"
    },
```

In `apps/web/src/locales/uz.json` replace:
```json
      "printFailed": "Talonni chop etib bo'lmadi"
    },
```
with:
```json
      "printFailed": "Talonni chop etib bo'lmadi",
      "issue": "Raqam berish",
      "issueFailed": "Navbat raqamini berib bo'lmadi"
    },
```

- [ ] **Step 22: Implement the issue helper**

Create `apps/web/src/modules/appointments/utils/queueIssue.ts`:
```ts
import { queueApi } from "../../queue/api/queueApi";
import type { QueueEntry } from "../../queue/api/queueTypes";
import type { Appointment } from "../api/appointmentsFlowApi";

export type QueueIssueResult = { ok: true; code: string; entry: QueueEntry } | { ok: false; message: string };

/**
 * «Выдать номер»: backfills today's queue number for a visit that is already «Пришёл» but has none
 * (POST /api/queue/appointments/:id/issue, idempotent on the server). Never throws: a refusal comes back as the
 * server's Russian text (409 «Запись не на сегодня», «Номер выдаётся только пришедшему пациенту») or `fallbackMessage`.
 */
export async function issueQueueNumber(appointmentId: number, fallbackMessage: string): Promise<QueueIssueResult> {
  try {
    const { entry } = await queueApi.issue(appointmentId);
    return entry.code ? { ok: true, code: entry.code, entry } : { ok: false, message: fallbackMessage };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : fallbackMessage };
  }
}

/** The row as the page shows it right after «Выдать номер», until the silent reload brings the server's copy. */
export function withIssuedQueueNumber(appointment: Appointment, entry: QueueEntry): Appointment {
  return { ...appointment, queueNumber: entry.number, queueCode: entry.code, queueIssuedAt: entry.issuedAt };
}
```

- [ ] **Step 23: «Выдать номер» on the desktop card, the mobile card and the details modal**

In `apps/web/src/modules/appointments/components/AppointmentCard.tsx` replace:
```tsx
  isPrintingTicket: boolean;
  onPrintTicket: () => void;
};
```
with:
```tsx
  isPrintingTicket: boolean;
  onPrintTicket: () => void;
  /** «Выдать номер»: роль выдаёт номера (queue.create); кнопка только у записи «Пришёл» без номера. */
  canIssueQueueNumber: boolean;
  isIssuingQueueNumber: boolean;
  onIssueQueueNumber: () => void;
};
```

In the same file replace:
```tsx
  isPrintingTicket,
  onPrintTicket,
}) => {
```
with:
```tsx
  isPrintingTicket,
  onPrintTicket,
  canIssueQueueNumber,
  isIssuingQueueNumber,
  onIssueQueueNumber,
}) => {
```

In the same file replace:
```tsx
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
```
with:
```tsx
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
  const showIssueButton = canIssueQueueNumber && appointment.status === "arrived" && !appointment.queueCode;
```

In the same file replace:
```tsx
              ))}
              {showTicketButton ? (
```
with:
```tsx
              ))}
              {showIssueButton ? (
                <button
                  type="button"
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                  disabled={isSubmitting || isIssuingQueueNumber}
                  onClick={onIssueQueueNumber}
                >
                  {t("appointments.queue.issue")}
                </button>
              ) : null}
              {showTicketButton ? (
```

In `apps/web/src/modules/appointments/components/AppointmentMobileCard.tsx` replace:
```tsx
  isPrintingTicket?: boolean;
  onPrintTicket?: () => void;
};
```
with:
```tsx
  isPrintingTicket?: boolean;
  onPrintTicket?: () => void;
  /** «Выдать номер»: роль выдаёт номера (queue.create); кнопка только у записи «Пришёл» без номера. */
  canIssueQueueNumber?: boolean;
  isIssuingQueueNumber?: boolean;
  onIssueQueueNumber?: () => void;
};
```

In the same file replace:
```tsx
  isPrintingTicket = false,
  onPrintTicket,
}) => {
  const { t } = useTranslation();
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
```
with:
```tsx
  isPrintingTicket = false,
  onPrintTicket,
  canIssueQueueNumber = false,
  isIssuingQueueNumber = false,
  onIssueQueueNumber,
}) => {
  const { t } = useTranslation();
  const showTicketButton =
    canPrintQueueTicket && appointment.status === "arrived" && Boolean(appointment.queueCode);
  const showIssueButton = canIssueQueueNumber && appointment.status === "arrived" && !appointment.queueCode;
```

In the same file replace:
```tsx
          ))}
          {showTicketButton && onPrintTicket ? (
```
with:
```tsx
          ))}
          {showIssueButton && onIssueQueueNumber ? (
            <button
              type="button"
              onClick={onIssueQueueNumber}
              disabled={isSubmitting || isIssuingQueueNumber}
              className="inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"
            >
              {t("appointments.queue.issue")}
            </button>
          ) : null}
          {showTicketButton && onPrintTicket ? (
```

In `apps/web/src/modules/appointments/pages/AppointmentsPage.tsx` make the replacements 23a–23h below (every "Replace:" in this step targets this file; the anchors include the lines Step 18 added).

23a. Imports. Replace:
```tsx
  canCreatePatients,
  canReadBilling,
```
with:
```tsx
  canCreatePatients,
  canIssueQueue,
  canReadBilling,
```

Replace:
```tsx
import { printQueueTicket } from "../../queue/print/printTicket";
```
with:
```tsx
import { printQueueTicket } from "../../queue/print/printTicket";
import { issueQueueNumber, withIssuedQueueNumber } from "../utils/queueIssue";
```

23b. Role flag. Replace:
```tsx
  const canPrintQueueTicket = canReadQueue(ur);
```
with:
```tsx
  const canPrintQueueTicket = canReadQueue(ur);
  const canIssueQueueNumber = canIssueQueue(ur);
```

23c. State. Replace:
```tsx
  const [printingTicketId, setPrintingTicketId] = React.useState<number | null>(null);
```
with:
```tsx
  const [printingTicketId, setPrintingTicketId] = React.useState<number | null>(null);
  const [issuingQueueId, setIssuingQueueId] = React.useState<number | null>(null);
```

23d. Handler, after `printTicket`: on success it patches the row and the open details modal at once (so «Талон» replaces the button), shows the same banner as «Отметить приход», then reloads silently; on failure the page error card shows the server's text. Replace:
```tsx
      setPrintingTicketId(null);
    }
  };
```
with:
```tsx
      setPrintingTicketId(null);
    }
  };

  const handleIssueQueueNumber = async (appointment: Appointment) => {
    if (!canIssueQueueNumber) return;
    setIssuingQueueId(appointment.id);
    setError(null);
    const result = await issueQueueNumber(appointment.id, t("appointments.queue.issueFailed"));
    setIssuingQueueId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const { code, entry } = result;
    const patch = (row: Appointment) => (row.id === appointment.id ? withIssuedQueueNumber(row, entry) : row);
    setAppointments((prev) => prev.map(patch));
    setDetailsModal((d) => (d.appointment ? { open: d.open, appointment: patch(d.appointment) } : d));
    setIssuedTicket({ appointmentId: appointment.id, code });
    void loadData({ silent: true });
  };
```

23e. Mobile card props. Replace:
```tsx
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                    canPrintQueueTicket={canPrintQueueTicket}
```
with:
```tsx
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                    canIssueQueueNumber={canIssueQueueNumber}
                    isIssuingQueueNumber={issuingQueueId === appointment.id}
                    onIssueQueueNumber={() => void handleIssueQueueNumber(appointment)}
                    canPrintQueueTicket={canPrintQueueTicket}
```

23f. Desktop card props. Replace:
```tsx
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
                    canPrintQueueTicket={canPrintQueueTicket}
```
with:
```tsx
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
                    canIssueQueueNumber={canIssueQueueNumber}
                    isIssuingQueueNumber={issuingQueueId === appointment.id}
                    onIssueQueueNumber={() => void handleIssueQueueNumber(appointment)}
                    canPrintQueueTicket={canPrintQueueTicket}
```

23g. Details modal visibility. Replace:
```tsx
            const showTicketBtn = canPrintQueueTicket && ap.status === "arrived" && Boolean(ap.queueCode);
```
with:
```tsx
            const showTicketBtn = canPrintQueueTicket && ap.status === "arrived" && Boolean(ap.queueCode);
            const showIssueBtn = canIssueQueueNumber && ap.status === "arrived" && !ap.queueCode;
```

23h. Details modal footer — «Выдать номер» takes the place «Талон» gets once the number exists. Replace:
```tsx
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {showTicketBtn ? (
```
with:
```tsx
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {showIssueBtn ? (
                      <button
                        type="button"
                        disabled={isSubmitting || issuingQueueId === ap.id}
                        onClick={() => void handleIssueQueueNumber(ap)}
                        className="mr-auto inline-flex min-h-[40px] items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                      >
                        {t("appointments.queue.issue")}
                      </button>
                    ) : null}
                    {showTicketBtn ? (
```
(`loadData({ silent: true })` starts with `setError(null)`, which is why the handler reloads only on success: after a failure the error card must stay.)

- [ ] **Step 24: Run the «Выдать номер» tests to verify they pass**

Run: `cd apps/web && npx vitest run src/modules/appointments/components/AppointmentCard.test.tsx src/modules/appointments/utils/queueIssue.test.ts && npm run typecheck && npm run check-i18n`
Expected: PASS — `AppointmentCard.test.tsx` (7), `queueIssue.test.ts` (4); `tsc --noEmit` prints nothing; `[i18n] OK: 1731 keys, full ru/uz parity, all code references resolve.` (2 more than after Step 13.)

- [ ] **Step 25: Write the failing dashboard arrival-toast test**

The dashboard's «Отметить приход» (`runAppointmentAction(id, "arrived")`) discarded the PUT response, so the receptionist never saw the issued number there. The message is built by a pure helper so it can be tested without rendering the dashboard.

Create `apps/web/src/modules/dashboard/utils/arrivalToast.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { arrivalToastMessage } from "./arrivalToast";

const t = (key: string, options?: { code: string }) => (options ? `${key} ${JSON.stringify(options)}` : key);

describe("arrivalToastMessage", () => {
  it("announces the queue number the server issued with the arrival", () => {
    expect(arrivalToastMessage({ queueCode: "К-05" }, t)).toBe('appointments.queue.issued {"code":"К-05"}');
  });

  it("stays quiet when no number was issued (visit on another day, older API) or the answer is missing", () => {
    expect(arrivalToastMessage({ queueCode: null }, t)).toBeNull();
    expect(arrivalToastMessage({ queueCode: "  " }, t)).toBeNull();
    expect(arrivalToastMessage({}, t)).toBeNull();
    expect(arrivalToastMessage(null, t)).toBeNull();
  });
});
```

- [ ] **Step 26: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/dashboard/utils/arrivalToast.test.ts`
Expected: FAIL with `Error: Cannot find module './arrivalToast' imported from '…/arrivalToast.test.ts'`.

- [ ] **Step 27: Show the issued number after «Отметить приход» on the dashboard**

`dashboardApi.markArrived` already returns `requestJson<Appointment>`, and Task 6 added `queueCode?: string | null` to `Appointment`, so its return type needs no change.

Create `apps/web/src/modules/dashboard/utils/arrivalToast.ts`:
```ts
import type { Appointment } from "../../appointments/api/appointmentsFlowApi";

/** The dashboard's `t` (react-i18next) satisfies this; tests pass a plain function. */
export type ArrivalToastTranslate = (key: string, options?: { code: string }) => string;

/**
 * Toast after the dashboard's «Отметить приход»: «Выдан номер К-05» when the PUT response carries today's queue
 * code, otherwise null (no toast, as before the queue existed).
 */
export function arrivalToastMessage(
  appointment: Pick<Appointment, "queueCode"> | null | undefined,
  t: ArrivalToastTranslate
): string | null {
  const code = appointment?.queueCode?.trim();
  return code ? t("appointments.queue.issued", { code }) : null;
}
```

`DashboardPage.tsx` is LF in the working tree (the Edit tool keeps that).

In `apps/web/src/modules/dashboard/pages/DashboardPage.tsx` replace:
```tsx
import { useDashboardData } from "../hooks/useDashboardData";
```
with:
```tsx
import { useDashboardData } from "../hooks/useDashboardData";
import { arrivalToastMessage } from "../utils/arrivalToast";
```

In the same file replace:
```tsx
      if (action === "arrived") await dashboardApi.markArrived(appointmentId);
```
with:
```tsx
      if (action === "arrived") {
        const updated = await dashboardApi.markArrived(appointmentId);
        // «Выдан номер К-05» in the dashboard's usual 2.5 s toast; no number (another day) → no toast, as before.
        const issuedMessage = arrivalToastMessage(updated, t);
        if (issuedMessage) setToast(issuedMessage);
      }
```
The toast is set before `await reload()`, so the number shows while the lists refresh; a failing reload still shows `actionError` as before.

- [ ] **Step 28: Run it to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/dashboard/utils/arrivalToast.test.ts && npm run typecheck`
Expected: PASS (2 tests); `tsc --noEmit` prints nothing (the react-i18next `t` is accepted as `ArrivalToastTranslate`).

- [ ] **Step 29: Run the targeted tests, the full web suite, typecheck and i18n check**

Run: `cd apps/web && npx vitest run src/modules/queue/print src/modules/queue/components/QueueCodeBadge.test.tsx src/modules/appointments/components src/modules/appointments/utils/queueIssue.test.ts src/modules/dashboard/utils`
Expected: PASS — 7 files, 28 tests: `ticketHtml.test.ts` (5), `printTicket.test.ts` (5), `QueueCodeBadge.test.tsx` (2), `appointmentActions.test.ts` (3), `AppointmentCard.test.tsx` (7), `queueIssue.test.ts` (4), `arrivalToast.test.ts` (2).

Run: `cd apps/web && npm test`
Expected: PASS — 21 test files, 106 tests, 0 failures (no existing test renders `AppointmentsPage`, `DashboardPage` or the cards).

Run: `cd apps/web && npm run typecheck`
Expected: exits 0 with no output.

Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1731 keys, full ru/uz parity, all code references resolve.`

- [ ] **Step 30: Commit**

```bash
git add apps/web/src/modules/queue/print/ticketHtml.ts apps/web/src/modules/queue/print/ticketHtml.test.ts apps/web/src/modules/queue/print/printTicket.ts apps/web/src/modules/queue/print/printTicket.test.ts apps/web/src/modules/queue/components/QueueCodeBadge.tsx apps/web/src/modules/queue/components/QueueCodeBadge.test.tsx apps/web/src/modules/appointments/components/appointmentActions.ts apps/web/src/modules/appointments/components/appointmentActions.test.ts apps/web/src/modules/appointments/components/AppointmentCard.tsx apps/web/src/modules/appointments/components/AppointmentCard.test.tsx apps/web/src/modules/appointments/components/AppointmentMobileCard.tsx apps/web/src/modules/appointments/pages/AppointmentsPage.tsx apps/web/src/modules/appointments/utils/queueIssue.ts apps/web/src/modules/appointments/utils/queueIssue.test.ts apps/web/src/modules/dashboard/utils/arrivalToast.ts apps/web/src/modules/dashboard/utils/arrivalToast.test.ts apps/web/src/modules/dashboard/pages/DashboardPage.tsx apps/web/src/locales/ru.json apps/web/src/locales/uz.json && git commit -m "feat(web): queue code on appointments, «Выдать номер», arrival wording and ticket printing"
```

---

### Task 9: TV screens management panel (superadmin)

**Files:**
- Create: `apps/web/src/modules/queue/components/DisplayFormModal.tsx`
- Create: `apps/web/src/modules/queue/components/DisplaysPanel.tsx`
- Test: `apps/web/src/modules/queue/components/DisplaysPanel.test.tsx` (new)
- Modify: `apps/web/src/locales/ru.json` (the `queue` block Task 6 put at the very end of the file, last 3 lines)
- Modify: `apps/web/src/locales/uz.json` (same place)

**Interfaces:**
- Consumes:
  - Task 6: `queueApi.listDisplays(): Promise<QueueDisplay[]>`, `queueApi.createDisplay(input: QueueDisplayInput): Promise<QueueDisplayWithCode>`, `queueApi.updateDisplay(id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay>`, `queueApi.deleteDisplay(id: number): Promise<{ success: boolean; id: number }>`, `queueApi.rotateCode(id: number): Promise<QueueDisplayWithCode>` from `apps/web/src/modules/queue/api/queueApi.ts`; types `QueueDisplay`, `QueueDisplayInput`, `QueueDisplayLanguage` from `apps/web/src/modules/queue/api/queueTypes.ts`; the locale files end with the `queue` object (`title`, `subtitle`).
  - Task 7: i18n key `doctors.roomShort` ("Кабинет {{room}}" / "Xona {{room}}"); `GET /api/doctors` rows carry `room: string | null` (Task 2).
  - Existing: `requestJson` from `apps/web/src/api/http.ts`, `Modal` from `apps/web/src/ui/Modal.tsx`, `modalInputClass` / `modalLabelClass` / `modalSelectClass` from `apps/web/src/modules/appointments/utils/modalFieldClasses.ts`, i18n keys `common.save`, `common.saving`, `common.cancel`, `common.edit`, `common.delete`, `common.close`.
- Produces (Task 10 mounts the panel):
  - `apps/web/src/modules/queue/components/DisplaysPanel.tsx`: `export function DisplaysPanel({ onClose }: { onClose: () => void })`.
  - `apps/web/src/modules/queue/components/DisplayFormModal.tsx`: `export type DisplayDoctor = { id: number; name: string; room?: string | null; active?: boolean }`, `export const DISPLAY_LANGUAGE_KEYS: Record<QueueDisplayLanguage, string>`, `export function DisplayFormModal({ display, doctors, onClose, onSaved }: { display: QueueDisplay | null; doctors: DisplayDoctor[]; onClose: () => void; onSaved: (display: QueueDisplay, code: string | null) => void })`.
  - i18n (ru + uz): `queue.displays.*` — 25 flat keys plus `queue.displays.languages.{uz_ru,uz,ru}` and 16 `queue.displays.form.*` keys (44 keys).
  - After this task both locale files end with `…"saveFailed": "…"\n      }\n    }\n  }\n}` and the `queue` block starts with `"title"`, `"subtitle": "…",`, `"displays": {` — Task 10 anchors on the `"subtitle"` line + `"displays": {`.

Design notes (read before coding):
- The panel is an inline `<section>` on the Queue page, not a `Modal`: `src/ui/Modal.tsx` closes on a window-level Escape listener, so a create/edit `Modal` stacked on a panel `Modal` would close both on one Escape. Only the create/edit form is a `Modal`.
- The API stores only the SHA-256 of a screen code, so the code (and therefore the `/tv/<code>` link and «Открыть экран») exists only in the create / rotate-code response. The panel keeps it in local state, shows it once in a green banner, and forgets it on «Готово», on delete of that screen, or when the panel unmounts. The list rows never show codes.
- Clipboard (`navigator.clipboard`) works only in a secure context (https or localhost); on failure the banner says so and the link stays in a read-only, auto-selecting input.
- `requestJson<DisplayDoctor[]>("/api/doctors")` feeds doctor names and the «У врача не указан кабинет» warning; if it fails the screens still load (the doctor list becomes `[]`). Inactive doctors (`active: false`) are offered only when the screen already lists them; on save, ids of doctors missing from the loaded list are dropped (the API answers 400 «Неизвестный врач в списке экрана» for them), unless the list failed to load.
- Language labels go through the literal map `DISPLAY_LANGUAGE_KEYS`, because `npm run check-i18n` does not verify template-literal keys such as `` `queue.displays.languages.${value}` ``.

- [ ] **Step 1: Write the failing test**

The web tests run in the node environment: `Modal` renders `null` there (no `document`), so the test swaps it for a pass-through; `requestJson` is mocked (importing `src/api/http.ts` would pull in i18n and read `VITE_API_URL`); `window` is stubbed with timers, `confirm` and `location.origin`.

Create `apps/web/src/modules/queue/components/DisplaysPanel.test.tsx` with:
```tsx
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplay } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  listDisplays: vi.fn(),
  createDisplay: vi.fn(),
  updateDisplay: vi.fn(),
  deleteDisplay: vi.fn(),
  rotateCode: vi.fn(),
  confirm: vi.fn(() => true),
}));
const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../api/http", () => ({ requestJson: mocks.requestJson }));
vi.mock("../api/queueApi", () => ({
  queueApi: {
    listDisplays: mocks.listDisplays,
    createDisplay: mocks.createDisplay,
    updateDisplay: mocks.updateDisplay,
    deleteDisplay: mocks.deleteDisplay,
    rotateCode: mocks.rotateCode,
  },
}));
// Modal portals into document.body, which does not exist in the node test environment.
vi.mock("../../../ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
import { DisplaysPanel } from "./DisplaysPanel";

const hall: QueueDisplay = {
  id: 1, name: "Холл", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
  createdAt: "2026-09-30T05:00:00.000Z", updatedAt: "2026-09-30T05:00:00.000Z",
};
const floor2: QueueDisplay = {
  id: 2, name: "2 этаж", doctorIds: [3, 4], showNames: false, language: "ru", voiceEnabled: false,
  createdAt: "2026-09-30T05:00:00.000Z", updatedAt: "2026-09-30T05:00:00.000Z",
};
const doctors = [
  { id: 3, name: "Karimov Aziz", room: "5", active: true },
  { id: 4, name: "Aliyeva Nodira", room: null, active: true },
];

let view: ReactTestRenderer;
const onClose = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal("window", { setTimeout, clearTimeout, confirm: mocks.confirm, location: { origin: "https://crm.test" } });
  mocks.listDisplays.mockResolvedValue([hall, floor2]);
  mocks.requestJson.mockResolvedValue(doctors);
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const rows = () => view.root.findAllByType("li").map(textOf);
const render = async () => {
  await act(async () => {
    view = create(<DisplaysPanel onClose={onClose} />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
const tvLinks = (href: string) => view.root.findAll((node) => node.type === "a" && node.props.href === href);

describe("TV screens panel", () => {
  it("lists the clinic's screens with their doctors and settings", async () => {
    await render();
    expect(mocks.requestJson).toHaveBeenCalledWith("/api/doctors");
    const [first, second] = rows();
    expect(first).toContain("Холл");
    expect(first).toContain("queue.displays.allDoctors");
    expect(first).toContain("queue.displays.languages.uz_ru");
    expect(first).toContain("queue.displays.namesOn");
    expect(first).toContain("queue.displays.voiceOn");
    expect(second).toContain("Karimov Aziz, Aliyeva Nodira");
    expect(second).toContain("queue.displays.languages.ru");
    expect(second).toContain("queue.displays.namesOff");
    expect(second).toContain("queue.displays.voiceOff");
    act(() => view.root.findByProps({ "aria-label": "common.close" }).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creating a screen shows the returned code and its /tv link once, until dismissed", async () => {
    mocks.createDisplay.mockResolvedValue({
      display: { ...hall, id: 3, name: "Холл 2" },
      code: "K7M2Q-9XR4P",
    });
    await render();
    await click(buttons("queue.displays.add")[0]);
    act(() => view.root.findByProps({ id: "queue-display-name" }).props.onChange({ target: { value: "  Холл 2 " } }));
    await click(buttons("common.save")[0]);

    expect(mocks.createDisplay).toHaveBeenCalledWith({
      name: "Холл 2", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
    });
    expect(view.root.findAllByProps({ id: "queue-display-name" })).toHaveLength(0);
    expect(occurrences(textOf(view.root), "K7M2Q-9XR4P")).toBe(1);
    expect(tvLinks("https://crm.test/tv/K7M2Q-9XR4P")).toHaveLength(1);
    expect(view.root.findAllByProps({ value: "https://crm.test/tv/K7M2Q-9XR4P" })).toHaveLength(1);
    expect(rows()).toHaveLength(3);

    await click(buttons("queue.displays.done")[0]);
    expect(occurrences(textOf(view.root), "K7M2Q-9XR4P")).toBe(0);
    expect(tvLinks("https://crm.test/tv/K7M2Q-9XR4P")).toHaveLength(0);
  });

  it("does not send a screen without a name or, in pick mode, without doctors", async () => {
    await render();
    await click(buttons("queue.displays.add")[0]);
    await click(buttons("common.save")[0]);
    expect(textOf(view.root)).toContain("queue.displays.form.nameRequired");

    act(() => view.root.findByProps({ id: "queue-display-name" }).props.onChange({ target: { value: "Холл 2" } }));
    act(() => view.root.findByProps({ id: "queue-display-pick-doctors" }).props.onChange());
    await click(buttons("common.save")[0]);
    expect(textOf(view.root)).toContain("queue.displays.form.doctorsRequired");
    expect(mocks.createDisplay).not.toHaveBeenCalled();
  });

  it("asks before issuing a new code and then shows only the new code", async () => {
    mocks.rotateCode.mockResolvedValue({ display: hall, code: "ABCDE-23456" });
    await render();

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("queue.displays.rotate")[0]);
    expect(mocks.confirm).toHaveBeenCalledWith('queue.displays.confirmRotate {"name":"Холл"}');
    expect(mocks.rotateCode).not.toHaveBeenCalled();

    await click(buttons("queue.displays.rotate")[0]);
    expect(mocks.rotateCode).toHaveBeenCalledWith(1);
    expect(occurrences(textOf(view.root), "ABCDE-23456")).toBe(1);
    expect(tvLinks("https://crm.test/tv/ABCDE-23456")).toHaveLength(1);
  });

  it("deletes a screen only after window.confirm", async () => {
    mocks.deleteDisplay.mockResolvedValue({ success: true, id: 2 });
    await render();

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("common.delete")[1]);
    expect(mocks.confirm).toHaveBeenCalledWith('queue.displays.confirmDelete {"name":"2 этаж"}');
    expect(mocks.deleteDisplay).not.toHaveBeenCalled();

    await click(buttons("common.delete")[1]);
    expect(mocks.deleteDisplay).toHaveBeenCalledWith(2);
    expect(rows()).toHaveLength(1);
    expect(textOf(view.root)).toContain("queue.displays.deleted");
  });

  it("warns about selected doctors without a cabinet and saves the edited doctor list", async () => {
    mocks.updateDisplay.mockImplementation(async (id: number, patch: Partial<QueueDisplay>) => ({ ...floor2, ...patch, id }));
    await render();
    await click(buttons("common.edit")[1]);

    const warnings = () => view.root.findAll((node) => node.type === "div" && node.props.role === "note").map(textOf);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("Aliyeva Nodira");
    expect(warnings()[0]).not.toContain("Karimov Aziz");

    act(() => view.root.findByProps({ "aria-label": "Aliyeva Nodira" }).props.onChange({ target: { checked: false } }));
    expect(warnings()).toHaveLength(0);
    await click(buttons("common.save")[0]);

    expect(mocks.updateDisplay).toHaveBeenCalledWith(2, {
      name: "2 этаж", doctorIds: [3], showNames: false, language: "ru", voiceEnabled: false,
    });
    expect(textOf(view.root)).toContain("queue.displays.saved");
    expect(rows()[1]).toContain("Karimov Aziz");
    expect(rows()[1]).not.toContain("Aliyeva Nodira");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/components/DisplaysPanel.test.tsx`
Expected: FAIL with `Error: Cannot find module './DisplaysPanel' imported from '…/src/modules/queue/components/DisplaysPanel.test.tsx'`.

- [ ] **Step 3: Create the screen form modal**

Create `apps/web/src/modules/queue/components/DisplayFormModal.tsx` with:
```tsx
import React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../ui/Modal";
import {
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
} from "../../appointments/utils/modalFieldClasses";
import { queueApi } from "../api/queueApi";
import type { QueueDisplay, QueueDisplayInput, QueueDisplayLanguage } from "../api/queueTypes";

/** Row of GET /api/doctors — only the fields the screen settings need. */
export type DisplayDoctor = { id: number; name: string; room?: string | null; active?: boolean };

const NAME_MAX = 100;

/** Literal keys (not a template literal) so `npm run check-i18n` verifies every one of them. */
export const DISPLAY_LANGUAGE_KEYS: Record<QueueDisplayLanguage, string> = {
  uz_ru: "queue.displays.languages.uz_ru",
  uz: "queue.displays.languages.uz",
  ru: "queue.displays.languages.ru",
};
const LANGUAGES: QueueDisplayLanguage[] = ["uz_ru", "uz", "ru"];

type Props = {
  /** null — a new screen. */
  display: QueueDisplay | null;
  doctors: DisplayDoctor[];
  onClose: () => void;
  /** `code` is the one-time screen code returned by create; null after an edit. */
  onSaved: (display: QueueDisplay, code: string | null) => void;
};

export function DisplayFormModal({ display, doctors, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(display?.name ?? "");
  const [pickDoctors, setPickDoctors] = React.useState(display?.doctorIds != null);
  const [selected, setSelected] = React.useState<number[]>(display?.doctorIds ?? []);
  const [showNames, setShowNames] = React.useState(display?.showNames ?? true);
  const [language, setLanguage] = React.useState<QueueDisplayLanguage>(display?.language ?? "uz_ru");
  const [voiceEnabled, setVoiceEnabled] = React.useState(display?.voiceEnabled ?? true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Inactive doctors are offered only when this screen already lists them.
  const choices = doctors.filter((doctor) => doctor.active !== false || selected.includes(doctor.id));
  const shown = pickDoctors
    ? choices.filter((doctor) => selected.includes(doctor.id))
    : doctors.filter((doctor) => doctor.active !== false);
  const withoutRoom = shown.filter((doctor) => !doctor.room?.trim());

  const toggleDoctor = (id: number, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev.filter((value) => value !== id), id] : prev.filter((value) => value !== id)));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("queue.displays.form.nameRequired"));
      return;
    }
    // Drop ids of doctors that no longer exist (the API rejects unknown doctors with 400); keep all if the list failed to load.
    const doctorIds = selected
      .filter((id) => doctors.length === 0 || doctors.some((doctor) => doctor.id === id))
      .sort((a, b) => a - b);
    if (pickDoctors && doctorIds.length === 0) {
      setError(t("queue.displays.form.doctorsRequired"));
      return;
    }
    const input: QueueDisplayInput = {
      name: trimmed,
      doctorIds: pickDoctors ? doctorIds : null,
      showNames,
      language,
      voiceEnabled,
    };
    setSaving(true);
    setError(null);
    try {
      if (display) {
        onSaved(await queueApi.updateDisplay(display.id, input), null);
      } else {
        const created = await queueApi.createDisplay(input);
        onSaved(created.display, created.code);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const checkboxClass = "h-4 w-4 accent-emerald-600";

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(94dvh,780px)] w-[min(560px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="queue-display-form-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="queue-display-form-title" className="text-base font-semibold text-slate-900">
            {display ? t("queue.displays.form.editTitle") : t("queue.displays.form.createTitle")}
          </h2>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="queue-display-name" className={modalLabelClass}>
              {t("queue.displays.form.name")}
            </label>
            <input
              id="queue-display-name"
              className={modalInputClass}
              value={name}
              maxLength={NAME_MAX}
              placeholder={t("queue.displays.form.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
          </div>

          <fieldset className="space-y-2" disabled={saving}>
            <legend className={modalLabelClass}>{t("queue.displays.form.doctors")}</legend>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                id="queue-display-all-doctors"
                type="radio"
                name="queue-display-doctors"
                className={checkboxClass}
                checked={!pickDoctors}
                onChange={() => setPickDoctors(false)}
              />
              {t("queue.displays.form.allDoctors")}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                id="queue-display-pick-doctors"
                type="radio"
                name="queue-display-doctors"
                className={checkboxClass}
                checked={pickDoctors}
                onChange={() => setPickDoctors(true)}
              />
              {t("queue.displays.form.pickDoctors")}
            </label>
            {pickDoctors ? (
              choices.length ? (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
                  {choices.map((doctor) => (
                    <li key={doctor.id}>
                      <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={selected.includes(doctor.id)}
                          onChange={(event) => toggleDoctor(doctor.id, event.target.checked)}
                          aria-label={doctor.name}
                        />
                        <span className="min-w-0 flex-1 truncate">{doctor.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {doctor.room?.trim()
                            ? t("doctors.roomShort", { room: doctor.room.trim() })
                            : t("queue.displays.form.noRoom")}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">{t("queue.displays.form.noDoctors")}</p>
              )
            ) : null}
          </fieldset>

          {withoutRoom.length ? (
            <div
              className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              role="note"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {t("queue.displays.form.noRoomWarning", { names: withoutRoom.map((doctor) => doctor.name).join(", ") })}
              </span>
            </div>
          ) : null}

          <div>
            <label htmlFor="queue-display-language" className={modalLabelClass}>
              {t("queue.displays.form.language")}
            </label>
            <select
              id="queue-display-language"
              className={modalSelectClass}
              value={language}
              onChange={(event) => setLanguage(event.target.value as QueueDisplayLanguage)}
              disabled={saving}
            >
              {LANGUAGES.map((value) => (
                <option key={value} value={value}>
                  {t(DISPLAY_LANGUAGE_KEYS[value])}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              id="queue-display-show-names"
              type="checkbox"
              className={checkboxClass}
              checked={showNames}
              onChange={(event) => setShowNames(event.target.checked)}
              disabled={saving}
            />
            {t("queue.displays.form.showNames")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              id="queue-display-voice"
              type="checkbox"
              className={checkboxClass}
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
              disabled={saving}
            />
            {t("queue.displays.form.voice")}
          </label>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Create the screens panel**

Create `apps/web/src/modules/queue/components/DisplaysPanel.tsx` with:
```tsx
import React from "react";
import { Copy, ExternalLink, KeyRound, Pencil, Plus, Trash2, Tv, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestJson } from "../../../api/http";
import { queueApi } from "../api/queueApi";
import type { QueueDisplay } from "../api/queueTypes";
import { DISPLAY_LANGUAGE_KEYS, DisplayFormModal, type DisplayDoctor } from "./DisplayFormModal";

/** A code is known only right after create / rotate-code: the API stores just its hash. */
type RevealedCode = { displayId: number; name: string; code: string };

const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const chip = "rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600";

/** Superadmin panel on the Queue page: TV screens list, create/edit, one-time code, new code, delete. */
export function DisplaysPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [displays, setDisplays] = React.useState<QueueDisplay[]>([]);
  const [doctors, setDoctors] = React.useState<DisplayDoctor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ display: QueueDisplay | null } | null>(null);
  const [revealed, setRevealed] = React.useState<RevealedCode | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      queueApi.listDisplays(),
      // Doctors only feed names and the "no cabinet" warning: their failure must not hide the screens.
      requestJson<DisplayDoctor[]>("/api/doctors").catch(() => [] as DisplayDoctor[]),
    ])
      .then(([list, doctorRows]) => {
        if (cancelled) return;
        setDisplays(list);
        setDoctors(doctorRows);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : t("queue.displays.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const doctorNames = (ids: number[] | null): string =>
    ids === null
      ? t("queue.displays.allDoctors")
      : ids.map((id) => doctors.find((doctor) => doctor.id === id)?.name ?? `#${id}`).join(", ");

  const reveal = (display: QueueDisplay, code: string) => {
    setRevealed({ displayId: display.id, name: display.name, code });
    setCopyState("idle");
  };

  const rotate = async (display: QueueDisplay) => {
    if (busyId !== null || !window.confirm(t("queue.displays.confirmRotate", { name: display.name }))) return;
    setBusyId(display.id);
    setError(null);
    try {
      const result = await queueApi.rotateCode(display.id);
      setDisplays((prev) => prev.map((row) => (row.id === result.display.id ? result.display : row)));
      reveal(result.display, result.code);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.actionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (display: QueueDisplay) => {
    if (busyId !== null || !window.confirm(t("queue.displays.confirmDelete", { name: display.name }))) return;
    setBusyId(display.id);
    setError(null);
    try {
      await queueApi.deleteDisplay(display.id);
      setDisplays((prev) => prev.filter((row) => row.id !== display.id));
      setRevealed((current) => (current?.displayId === display.id ? null : current));
      setNotice(t("queue.displays.deleted"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.actionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const origin = window.location.origin;
  const link = revealed ? `${origin}/tv/${revealed.code}` : "";

  const copyLink = async () => {
    try {
      // Clipboard needs a secure context (https or localhost); otherwise the link stays selectable below.
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
      aria-labelledby="queue-displays-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Tv className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="queue-displays-title" className="text-base font-semibold text-slate-900">
              {t("queue.displays.title")}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{t("queue.displays.subtitle")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditor({ display: null })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("queue.displays.add")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {revealed ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-emerald-900">{t("queue.displays.codeTitle", { name: revealed.name })}</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-[0.18em] text-slate-900">{revealed.code}</p>
          <p className="mt-2 text-xs text-emerald-900/80">{t("queue.displays.codeHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={link}
              aria-label={t("queue.displays.linkLabel")}
              onFocus={(event) => event.target.select()}
              className="h-9 min-w-[14rem] flex-1 rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-slate-800"
            />
            <button type="button" onClick={() => void copyLink()} className={secondaryButton}>
              <Copy className="h-4 w-4" aria-hidden />
              {t("queue.displays.copyLink")}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("queue.displays.openScreen")}
            </a>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              {t("queue.displays.done")}
            </button>
          </div>
          {copyState === "copied" ? (
            <p className="mt-2 text-xs text-emerald-800">{t("queue.displays.copied")}</p>
          ) : copyState === "failed" ? (
            <p className="mt-2 text-xs text-rose-700">{t("queue.displays.copyFailed")}</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : displays.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {t("queue.displays.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {displays.map((display) => (
            <li
              key={display.id}
              className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{display.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{doctorNames(display.doctorIds)}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  <span className={chip}>{t(DISPLAY_LANGUAGE_KEYS[display.language])}</span>
                  <span className={chip}>{display.showNames ? t("queue.displays.namesOn") : t("queue.displays.namesOff")}</span>
                  <span className={chip}>{display.voiceEnabled ? t("queue.displays.voiceOn") : t("queue.displays.voiceOff")}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditor({ display })}
                  disabled={busyId !== null}
                  className={secondaryButton}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => void rotate(display)}
                  disabled={busyId !== null}
                  className={secondaryButton}
                >
                  <KeyRound className="h-4 w-4" aria-hidden />
                  {t("queue.displays.rotate")}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(display)}
                  disabled={busyId !== null}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">{t("queue.displays.tvHint", { url: `${origin}/tv` })}</p>

      {editor ? (
        <DisplayFormModal
          display={editor.display}
          doctors={doctors}
          onClose={() => setEditor(null)}
          onSaved={(saved, code) => {
            setEditor(null);
            setDisplays((prev) =>
              prev.some((row) => row.id === saved.id)
                ? prev.map((row) => (row.id === saved.id ? saved : row))
                : [...prev, saved]
            );
            if (code) reveal(saved, code);
            else setNotice(t("queue.displays.saved"));
          }}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Add the `queue.displays.*` keys (ru + uz)**

Use the Edit tool: in the working tree both locale files have CRLF line endings, and the Edit tool matches these LF snippets and keeps the file's endings. Never re-serialize a locale file (`JSON.stringify`, a formatter) — that rewrites all ~2000 lines. The old snippet is the end of the file exactly as Task 6 left it.

In `apps/web/src/locales/ru.json` replace:
```json
    "subtitle": "Номера пациентов по кабинетам на сегодня"
  }
}
```
with:
```json
    "subtitle": "Номера пациентов по кабинетам на сегодня",
    "displays": {
      "title": "ТВ-экраны",
      "subtitle": "Телевизор в холле открывает экран по ссылке с кодом. Код показывается только при создании и при выдаче нового кода.",
      "add": "Новый экран",
      "empty": "Экранов пока нет. Создайте экран и откройте ссылку на телевизоре.",
      "allDoctors": "Все врачи, у кого сегодня есть очередь",
      "namesOn": "С именами",
      "namesOff": "Без имён",
      "voiceOn": "С голосом",
      "voiceOff": "Без голоса",
      "rotate": "Новый код",
      "confirmRotate": "Выдать экрану «{{name}}» новый код? Старая ссылка перестанет работать.",
      "confirmDelete": "Удалить экран «{{name}}»? Телевизор с этой ссылкой отключится.",
      "codeTitle": "Код экрана «{{name}}»",
      "codeHint": "Откройте ссылку на телевизоре или введите код на странице /tv. Код больше не покажется — сохраните его сейчас.",
      "linkLabel": "Ссылка на экран",
      "copyLink": "Копировать ссылку",
      "copied": "Ссылка скопирована",
      "copyFailed": "Не удалось скопировать — выделите ссылку и скопируйте вручную",
      "openScreen": "Открыть экран",
      "done": "Готово",
      "tvHint": "На телевизоре откройте {{url}} и введите код экрана.",
      "saved": "Экран сохранён",
      "deleted": "Экран удалён",
      "loadFailed": "Не удалось загрузить экраны",
      "actionFailed": "Не удалось выполнить действие",
      "languages": {
        "uz_ru": "Узбекский и русский",
        "uz": "Узбекский",
        "ru": "Русский"
      },
      "form": {
        "createTitle": "Новый экран",
        "editTitle": "Настройки экрана",
        "name": "Название",
        "namePlaceholder": "Холл, 1 этаж",
        "doctors": "Какие кабинеты показывать",
        "allDoctors": "Всех врачей, у кого сегодня есть очередь",
        "pickDoctors": "Только выбранных врачей",
        "noDoctors": "Врачей пока нет",
        "noRoom": "Кабинет не указан",
        "noRoomWarning": "У врача не указан кабинет: {{names}}. На экране будет «Кабинет —», а голос не назовёт номер кабинета.",
        "language": "Язык надписей и голоса",
        "showNames": "Показывать имена пациентов («Алишер К.»)",
        "voice": "Объявлять вызов голосом",
        "nameRequired": "Укажите название экрана",
        "doctorsRequired": "Выберите хотя бы одного врача",
        "saveFailed": "Не удалось сохранить экран"
      }
    }
  }
}
```

In `apps/web/src/locales/uz.json` replace:
```json
    "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha"
  }
}
```
with:
```json
    "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha",
    "displays": {
      "title": "TV ekranlar",
      "subtitle": "Zaldagi televizor ekranni kodli havola orqali ochadi. Kod faqat yaratishda va yangi kod berilganda ko'rsatiladi.",
      "add": "Yangi ekran",
      "empty": "Hozircha ekranlar yo'q. Ekran yarating va havolani televizorda oching.",
      "allDoctors": "Bugun navbati bor barcha shifokorlar",
      "namesOn": "Ismlar bilan",
      "namesOff": "Ismlarsiz",
      "voiceOn": "Ovoz bilan",
      "voiceOff": "Ovozsiz",
      "rotate": "Yangi kod",
      "confirmRotate": "«{{name}}» ekraniga yangi kod berilsinmi? Eski havola ishlamay qoladi.",
      "confirmDelete": "«{{name}}» ekrani o'chirilsinmi? Shu havoladagi televizor o'chadi.",
      "codeTitle": "«{{name}}» ekran kodi",
      "codeHint": "Havolani televizorda oching yoki /tv sahifasida kodni kiriting. Kod qayta ko'rsatilmaydi — uni hozir saqlab qo'ying.",
      "linkLabel": "Ekran havolasi",
      "copyLink": "Havolani nusxalash",
      "copied": "Havola nusxalandi",
      "copyFailed": "Nusxalab bo'lmadi — havolani belgilab, qo'lda nusxalang",
      "openScreen": "Ekranni ochish",
      "done": "Tayyor",
      "tvHint": "Televizorda {{url}} sahifasini oching va ekran kodini kiriting.",
      "saved": "Ekran saqlandi",
      "deleted": "Ekran o'chirildi",
      "loadFailed": "Ekranlarni yuklab bo'lmadi",
      "actionFailed": "Amalni bajarib bo'lmadi",
      "languages": {
        "uz_ru": "O'zbek va rus",
        "uz": "O'zbek",
        "ru": "Rus"
      },
      "form": {
        "createTitle": "Yangi ekran",
        "editTitle": "Ekran sozlamalari",
        "name": "Nomi",
        "namePlaceholder": "Zal, 1-qavat",
        "doctors": "Qaysi xonalar ko'rsatilsin",
        "allDoctors": "Bugun navbati bor barcha shifokorlar",
        "pickDoctors": "Faqat tanlangan shifokorlar",
        "noDoctors": "Hozircha shifokorlar yo'q",
        "noRoom": "Xona ko'rsatilmagan",
        "noRoomWarning": "Shifokorning xonasi ko'rsatilmagan: {{names}}. Ekranda «Xona —» chiqadi, ovoz esa xona raqamini aytmaydi.",
        "language": "Yozuvlar va ovoz tili",
        "showNames": "Bemor ismlarini ko'rsatish («Alisher K.»)",
        "voice": "Chaqiruvni ovoz bilan e'lon qilish",
        "nameRequired": "Ekran nomini kiriting",
        "doctorsRequired": "Kamida bitta shifokorni tanlang",
        "saveFailed": "Ekranni saqlab bo'lmadi"
      }
    }
  }
}
```

- [ ] **Step 6: Run the tests, the whole web suite, typecheck and the i18n check**

Run: `cd apps/web && npx vitest run src/modules/queue/components/DisplaysPanel.test.tsx`
Expected: PASS (6 tests), no `act(...)` warnings in the output.
Run: `cd apps/web && npm test`
Expected: PASS — 22 test files, 112 tests, 0 failures (one more file and 6 more tests than at the end of Task 8).
Run: `cd apps/web && npm run typecheck`
Expected: PASS (no output).
Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1775 keys, full ru/uz parity, all code references resolve.` (44 more than the 1731 printed at the end of Task 8).
Run: `git diff --numstat -- apps/web/src/locales`
Expected: `51  1  apps/web/src/locales/ru.json` and `51  1  apps/web/src/locales/uz.json` (51 added lines, 1 removed: the old `"subtitle"` line gains a comma); a diff of ~2000 lines means the file was re-serialized — `git checkout -- <file>` and redo Step 5 with the Edit tool.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/queue/components/DisplayFormModal.tsx apps/web/src/modules/queue/components/DisplaysPanel.tsx apps/web/src/modules/queue/components/DisplaysPanel.test.tsx apps/web/src/locales/ru.json apps/web/src/locales/uz.json && git commit -m "feat(web): TV screens panel for the electronic queue"
```

---

---

### Task 10: Staff Queue page (`/queue`)

**Files:**
- Create: `apps/web/src/modules/queue/utils/queueView.ts`
- Test: `apps/web/src/modules/queue/utils/queueView.test.ts` (new)
- Create: `apps/web/src/modules/queue/hooks/usePolling.ts`
- Test: `apps/web/src/modules/queue/hooks/usePolling.test.tsx` (new)
- Create: `apps/web/src/modules/queue/components/QueueEntryRow.tsx`
- Create: `apps/web/src/modules/queue/components/CabinetQueueCard.tsx`
- Create: `apps/web/src/modules/queue/pages/QueuePage.tsx`
- Test: `apps/web/src/modules/queue/pages/QueuePage.test.tsx` (new)
- Modify: `apps/web/src/router/AppRouter.tsx` (lazy import line 20, role import ~line 44, route after `/call-center` ~lines 192–199)
- Modify: `apps/web/src/navigation/navigationConfig.tsx` (icon import ~line 13, role import ~line 34, item after appointments line 62)
- Test: `apps/web/src/navigation/navigationConfig.test.ts` (new)
- Modify: `apps/web/src/layouts/MainLayout.tsx` (`getRouteKey` map, line 30)
- Modify: `apps/web/src/locales/ru.json`, `apps/web/src/locales/uz.json` (the `queue` block: after `"subtitle"`, before `"displays"`)

**Interfaces:**
- Consumes:
  - Task 6: `queueApi.today(doctorId?: number | null, signal?: AbortSignal): Promise<QueueToday>`, `queueApi.call(appointmentId: number): Promise<{ entry: QueueEntry }>`, `queueApi.callNext(doctorId: number): Promise<{ entry: QueueEntry | null }>`; types `QueueToday`, `QueueDoctorDay`, `QueueEntry`, `QueueEntryState`; `canCallQueue`, `canIssueQueue`, `canManageQueueDisplays`, `QUEUE_ROLES` from `apps/web/src/auth/roleGroups.ts`; `Appointment.queueCode?: string | null` in `appointmentsFlowApi.ts`; i18n `pages.queue`, `queue.title`, `queue.subtitle`.
  - Task 9: `DisplaysPanel({ onClose })` from `apps/web/src/modules/queue/components/DisplaysPanel.tsx`; the `queue` block ends with `"displays": {…}`.
  - Existing: `appointmentsFlowApi.updateAppointmentStatus(token: string, appointmentId: number, status: AppointmentStatus): Promise<Appointment>` (PUT `/api/appointments/:id`), `appointmentsFlowApi.completeAppointment(token: string, appointmentId: number, payload: Partial<Pick<Appointment, "diagnosis" | "treatment" | "notes" | "recommendedReturnDate">>): Promise<Appointment>` (PATCH `/api/appointments/:id/complete`), `DOCTOR_WORKSPACE_ROLES`, `useAuth()` (`{ token, user }`), `ListEmptyState`, `PageLoader`, i18n `common.actions.refresh`.
  - API behaviour (Tasks 3–4): `GET /api/queue/today` scopes doctor/nurse to their doctor and always includes that doctor's card; `PUT status arrived` on a `no_show` visit of today issues a new number (response `queueCode`).
- Produces:
  - `apps/web/src/modules/queue/utils/queueView.ts`: `nextWaiting(day: QueueDoctorDay): QueueEntry | null`, `waitMinutes(issuedAt: string | null, serverTime: string, clientSkewMs: number, nowMs: number): number | null`, `formatWallTime(startAt: string): string`, plus `entryLabel(entry: QueueEntry): string` and `type QueueAction` (union of `callNext | call | start | notCame | returnToQueue | complete | openWorkspace`).
  - `apps/web/src/modules/queue/hooks/usePolling.ts`: `usePolling<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: React.DependencyList): { data: T | null; error: string | null; loading: boolean; refresh: () => void }`.
  - `apps/web/src/modules/queue/components/QueueEntryRow.tsx`: `QueueEntryRow({ entry, waitMinutes, children })`.
  - `apps/web/src/modules/queue/components/CabinetQueueCard.tsx`: `type CabinetPermissions = { canCall: boolean; canIssue: boolean; canOpenWorkspace: boolean }`, `CabinetQueueCard({ day, permissions, disabled, waitOf, onAction })`; every action button carries `data-action="<QueueAction kind>"`.
  - `apps/web/src/modules/queue/pages/QueuePage.tsx`: `export const QueuePage: React.FC`.
  - Route `/queue` (lazy, `RoleGuard roles={QUEUE_ROLES}`), menu item in `nav.main` right after appointments (`labelKey: "pages.queue"`, icon `ListOrdered`), `MainLayout` title map `"/queue": "pages.queue"`.
  - i18n (ru + uz): `queue.cabinet.*` (6), `queue.states.*` (6), `queue.actions.*` (11), `queue.entry.*` (3), `queue.empty.*` (2), `queue.errors.*` (2), `queue.notices.*` (6) — 36 keys.

Behaviour notes:
- Polling: `GET /api/queue/today` every 5000 ms through `usePolling` (a `setTimeout` chain started after each answer, so a slow API never gets overlapping requests; the last good data stays on screen when a poll fails; hidden tabs skip the request). After every action the page calls `refresh()` (also after a failure — a 409 usually means someone else already moved that patient).
- Who sees what (the API enforces the same scope): doctor/nurse — only their doctor's card (the API returns it even when empty); reception and superadmin — every cabinet with actions; manager/director — read-only, no action buttons at all. Actions: «Вызвать следующего · К-06» (`queueApi.callNext`), «Вызвать» / «Повторить вызов» (`queueApi.call`), «Начать приём» (PUT `in_consultation`), «Не пришёл» (PUT `no_show`, after `window.confirm`), «Вернуть в очередь» for missed (PUT `arrived`, only `canIssueQueue` = reception/superadmin), «Завершить приём» for the patient in the cabinet (PATCH complete with `{}`, after `window.confirm`), «Открыть приём» (navigate `/doctor-workspace/:id`) only for `canCallQueue` roles that are also in `DOCTOR_WORKSPACE_ROLES` (superadmin, doctor, nurse) — `DOCTOR_WORKSPACE_ROLES` alone would also give it to the read-only manager.
- Time: `startAt` is clinic wall clock stored as if UTC → `formatWallTime` slices "HH:MM" (no `Date`/`Intl`, which would shift it by the browser offset). "ждёт N мин" is computed on the server clock: `waitMinutes(issuedAt, serverTime, skew, Date.now())` with `skew = Date.now() - Date.parse(serverTime)` measured when the snapshot arrived.
- `appointmentsFlowApi.*` take an explicit `token: string`; `requestJson` treats `""` as "no token" and would send no `Authorization` header, so the page never calls them without a token.

- [ ] **Step 1: Write the failing view-helpers test**

Create `apps/web/src/modules/queue/utils/queueView.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";
import { entryLabel, formatWallTime, nextWaiting, waitMinutes } from "./queueView";

const entry = (number: number | null, state: QueueEntry["state"], extra: Partial<QueueEntry> = {}): QueueEntry => ({
  appointmentId: 100 + (number ?? 0),
  doctorId: 10,
  patientId: 200 + (number ?? 0),
  patientName: `Patient ${number ?? "direct"}`,
  number,
  code: number === null ? null : `К-${String(number).padStart(2, "0")}`,
  state,
  startAt: "2026-09-30 10:00:00",
  issuedAt: "2026-09-30T05:00:00.000Z",
  calledAt: state === "called" ? "2026-09-30T05:30:00.000Z" : null,
  callCount: state === "called" ? 1 : 0,
  ...extra,
});
const day = (waiting: QueueEntry[]): QueueDoctorDay => ({
  doctorId: 10, doctorName: "Karimov Aziz", specialty: "Терапевт", room: "5", prefix: "К",
  serving: null, waiting, missed: [], doneCount: 0,
});

describe("next patient to call", () => {
  it("skips called entries and takes the first still-waiting one", () => {
    expect(nextWaiting(day([entry(4, "called"), entry(5, "waiting"), entry(6, "waiting")]))?.code).toBe("К-05");
  });
  it("is null when everyone was already called or nobody waits", () => {
    expect(nextWaiting(day([entry(4, "called")]))).toBeNull();
    expect(nextWaiting(day([]))).toBeNull();
  });
});

describe("waiting time on the server clock", () => {
  const serverTime = "2026-09-30T06:00:00.000Z";
  const serverMs = Date.parse(serverTime);

  it("counts whole minutes since the number was issued", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs)).toBe(12);
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs + 59_000)).toBe(12);
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs + 60_000)).toBe(13);
  });
  it("ignores a client clock that is an hour fast", () => {
    const skew = 3_600_000;
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, skew, serverMs + skew + 120_000)).toBe(14);
  });
  it("never goes below the snapshot time when the client clock moves backwards", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", serverTime, 0, serverMs - 600_000)).toBe(12);
  });
  it("is never negative and null without a valid issue time", () => {
    expect(waitMinutes("2026-09-30T06:05:00.000Z", serverTime, 0, serverMs)).toBe(0);
    expect(waitMinutes(null, serverTime, 0, serverMs)).toBeNull();
    expect(waitMinutes("not a date", serverTime, 0, serverMs)).toBeNull();
  });
  it("falls back to the client estimate when serverTime is unparsable", () => {
    expect(waitMinutes("2026-09-30T05:48:00.000Z", "", 0, serverMs)).toBe(12);
  });
});

describe("appointment wall-clock time", () => {
  it("slices HH:MM without any time-zone conversion", () => {
    expect(formatWallTime("2026-09-30 10:05:00")).toBe("10:05");
    expect(formatWallTime("2026-09-30T08:30:00")).toBe("08:30");
    expect(formatWallTime("2026-09-30 00:00:00")).toBe("00:00");
  });
  it("shows a dash for anything else", () => {
    expect(formatWallTime("")).toBe("—");
    expect(formatWallTime("10:05")).toBe("—");
  });
});

describe("entry label", () => {
  it("uses the ticket code, or the patient's name for a visit without a number", () => {
    expect(entryLabel(entry(7, "waiting"))).toBe("К-07");
    expect(entryLabel(entry(null, "serving"))).toBe("Patient direct");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/utils/queueView.test.ts`
Expected: FAIL with `Error: Cannot find module './queueView' imported from '…/src/modules/queue/utils/queueView.test.ts'`.

- [ ] **Step 3: Implement the view helpers**

Create `apps/web/src/modules/queue/utils/queueView.ts` with:
```ts
import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";

/** Actions of the staff Queue page; CabinetQueueCard emits them, QueuePage performs them. */
export type QueueAction =
  | { kind: "callNext"; doctorId: number }
  | { kind: "call"; entry: QueueEntry }
  | { kind: "start"; entry: QueueEntry }
  | { kind: "notCame"; entry: QueueEntry }
  | { kind: "returnToQueue"; entry: QueueEntry }
  | { kind: "complete"; entry: QueueEntry }
  | { kind: "openWorkspace"; entry: QueueEntry };

/** The patient «Вызвать следующего» will call: the first never-called entry (the API sorts `waiting` by number). */
export function nextWaiting(day: QueueDoctorDay): QueueEntry | null {
  return day.waiting.find((entry) => entry.state === "waiting") ?? null;
}

/**
 * Whole minutes since the number was issued, on the SERVER clock (a reception PC with a wrong clock must not
 * show "waits 65 min"). `serverTime` is `QueueToday.serverTime` of the snapshot, `clientSkewMs` is the client
 * clock minus the server clock measured when that snapshot arrived, `nowMs` is the current client clock.
 * Server "now" = nowMs - clientSkewMs, but never earlier than `serverTime` (client clock moved backwards).
 * Never negative; null when `issuedAt` is missing or unparsable.
 */
export function waitMinutes(
  issuedAt: string | null,
  serverTime: string,
  clientSkewMs: number,
  nowMs: number
): number | null {
  if (!issuedAt) return null;
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return null;
  const snapshotMs = Date.parse(serverTime);
  const estimatedServerNow = nowMs - clientSkewMs;
  const serverNow = Number.isFinite(snapshotMs) ? Math.max(snapshotMs, estimatedServerNow) : estimatedServerNow;
  return Math.max(0, Math.floor((serverNow - issuedMs) / 60_000));
}

/**
 * "2026-09-30 10:05:00" → "10:05". `startAt` is clinic WALL CLOCK stored as if UTC, so it is sliced,
 * never passed through Date/Intl (that would shift it by the browser's offset). "—" when unparsable.
 */
export function formatWallTime(startAt: string): string {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(startAt);
  return match ? `${match[1]}:${match[2]}` : "—";
}

/** How notices and confirmations name an entry: its ticket code, or the patient's name when it has no number. */
export function entryLabel(entry: QueueEntry): string {
  return entry.code ?? entry.patientName;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/utils/queueView.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing polling-hook test**

The hook schedules through `window.setTimeout` like the rest of the app, and `window` does not exist in the node test environment, so the test installs fake timers first and then stubs `window` with the (now fake) `setTimeout` / `clearTimeout`.

Create `apps/web/src/modules/queue/hooks/usePolling.test.tsx` with:
```tsx
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

type Snapshot = { data: string | null; error: string | null; loading: boolean; refresh: () => void };
let latest: Snapshot;
function Probe({ load }: { load: (signal: AbortSignal) => Promise<string> }) {
  latest = usePolling(load, 5000, []);
  return null;
}

let view: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  // The hook schedules through window.* (like the rest of the app); hand it the fake timers.
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = async (load: (signal: AbortSignal) => Promise<string>) => {
  await act(async () => {
    view = create(<Probe load={load} />);
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("usePolling", () => {
  it("loads at once, then every interval, and keeps the last data while a poll fails", async () => {
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("second");
    await mount(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(latest).toMatchObject({ data: "first", error: null, loading: false });

    await advance(4999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ data: "first", error: "offline", loading: false });

    await advance(5000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(latest).toMatchObject({ data: "second", error: null });
  });

  it("refresh aborts the request in flight and polls immediately; unmount stops polling", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<string>(() => undefined) : Promise.resolve(`answer ${signals.length}`);
    });
    await mount(load);
    expect(latest.loading).toBe(true);

    await act(async () => latest.refresh());
    expect(signals[0].aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ data: "answer 2", loading: false });

    act(() => view!.unmount());
    view = null;
    await advance(20_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/hooks/usePolling.test.tsx`
Expected: FAIL with `Error: Cannot find module './usePolling' imported from '…/src/modules/queue/hooks/usePolling.test.tsx'`.

- [ ] **Step 7: Implement the polling hook**

`timer` is typed `number` (the DOM `window.setTimeout` signature); `ReturnType<typeof window.setTimeout>` resolves to Node's `Timeout` here because `@types/node` is loaded, and fails `npm run typecheck`.

Create `apps/web/src/modules/queue/hooks/usePolling.ts` with:
```ts
import React from "react";

/**
 * Loads now, then again `intervalMs` after each answer (a setTimeout chain, so slow answers never overlap).
 * Keeps the last good `data` when a later poll fails; `error` holds the latest failure message until the next
 * success. `loading` is true only until the first answer after mount or a `deps` change, so background polls do
 * not flash skeletons. `refresh()` aborts the request in flight and polls immediately. While the browser tab is
 * hidden the request is skipped (the timer keeps running), so a forgotten tab does not load the API.
 * `load` may change every render; the latest one is used.
 */
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: React.DependencyList
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const pollNowRef = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (!disposed) timer = window.setTimeout(poll, intervalMs);
    };
    function poll() {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      const current = new AbortController();
      controller = current;
      loadRef.current(current.signal).then(
        (value) => {
          if (disposed || current.signal.aborted) return;
          setData(value);
          setError(null);
          setLoading(false);
          schedule();
        },
        (reason: unknown) => {
          if (disposed || current.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
          schedule();
        }
      );
    }

    pollNowRef.current = poll;
    setLoading(true);
    poll();
    return () => {
      disposed = true;
      pollNowRef.current = () => undefined;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
    // `deps` are the caller's inputs of `load`; `load` itself is read through the ref.
  }, [intervalMs, ...deps]);

  const refresh = React.useCallback(() => pollNowRef.current(), []);
  return { data, error, loading, refresh };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/hooks/usePolling.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing Queue page test**

This test translates with the real `ru.json` (async `vi.mock` factory), so it asserts the texts staff actually see («Вызвать следующего · К-05», «Вернуть в очередь», «Экраны»); the translator is created once inside the factory, so `t` keeps a stable identity across renders. `DisplaysPanel` is replaced by a marker `div` (its own test is Task 9's).

Create `apps/web/src/modules/queue/pages/QueuePage.test.tsx` with:
```tsx
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../../../auth/types";
import type { QueueEntry, QueueToday } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  today: vi.fn(),
  call: vi.fn(),
  callNext: vi.fn(),
  updateAppointmentStatus: vi.fn(),
  completeAppointment: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(() => true),
}));
// Real Russian texts from ru.json, so the assertions read like the screen («Вызвать следующего · К-05»).
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
vi.mock("../api/queueApi", () => ({ queueApi: { today: mocks.today, call: mocks.call, callNext: mocks.callNext } }));
vi.mock("../../appointments/api/appointmentsFlowApi", () => ({
  appointmentsFlowApi: {
    updateAppointmentStatus: mocks.updateAppointmentStatus,
    completeAppointment: mocks.completeAppointment,
  },
}));
vi.mock("../components/DisplaysPanel", () => ({ DisplaysPanel: () => <div id="displays-panel" /> }));
import { QueuePage } from "./QueuePage";

const entry = (appointmentId: number, number: number, state: QueueEntry["state"], patientName: string): QueueEntry => ({
  appointmentId,
  doctorId: 10,
  patientId: appointmentId + 100,
  patientName,
  number,
  code: `К-${String(number).padStart(2, "0")}`,
  state,
  startAt: "2026-09-30 10:30:00",
  issuedAt: "2026-09-30T05:40:00.000Z",
  calledAt: state === "called" ? "2026-09-30T05:55:00.000Z" : null,
  callCount: state === "called" ? 1 : 0,
});
const today: QueueToday = {
  date: "2026-09-30",
  timeZone: "Asia/Tashkent",
  serverTime: "2026-09-30T06:00:00.000Z",
  doctors: [
    {
      doctorId: 10,
      doctorName: "Karimov Aziz",
      specialty: "Терапевт",
      room: "5",
      prefix: "К",
      serving: null,
      waiting: [entry(14, 4, "called", "Rahimov Bek"), entry(15, 5, "waiting", "Yusupova Dilnoza")],
      missed: [entry(12, 2, "missed", "Aliyeva Nodira")],
      doneCount: 1,
    },
  ],
};

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout, confirm: mocks.confirm });
  mocks.today.mockResolvedValue(today);
  mocks.callNext.mockResolvedValue({ entry: { ...entry(15, 5, "called", "Yusupova Dilnoza"), callCount: 1 } });
  mocks.updateAppointmentStatus.mockImplementation(async (_token: string, id: number, status: string) => ({
    id, status, queueCode: status === "arrived" ? "К-07" : null,
  }));
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const actionButtons = () => view.root.findAll((node) => node.type === "button" && node.props["data-action"] !== undefined);
const renderAs = async (role: UserRole, extra: Partial<PublicUser> = {}) => {
  mocks.user = { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z", ...extra };
  await act(async () => {
    view = create(<QueuePage />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};

describe("staff queue page", () => {
  it("shows the doctor their cabinet and calls the next waiting number", async () => {
    await renderAs("doctor", { doctorId: 10 });
    expect(mocks.today).toHaveBeenCalledTimes(1);
    expect(mocks.today.mock.calls[0][0]).toBeNull();
    const card = view.root.findByType("article");
    expect(card.props["aria-label"]).toBe("Karimov Aziz");
    expect(textOf(card)).toContain("Кабинет 5");
    expect(textOf(card)).toContain("Rahimov Bek");
    expect(textOf(card)).toContain("Запись на 10:30");

    const callNext = buttons("Вызвать следующего · К-05");
    expect(callNext).toHaveLength(1);
    await click(callNext[0]);
    expect(mocks.callNext).toHaveBeenCalledWith(10);
    expect(textOf(view.root)).toContain("Вызван К-05");
    expect(mocks.today).toHaveBeenCalledTimes(2);

    // The called patient gets start / re-call / not came; the doctor does not return missed patients.
    expect(buttons("Начать приём")).toHaveLength(1);
    expect(buttons("Повторить вызов")).toHaveLength(1);
    expect(buttons("Вернуть в очередь")).toHaveLength(0);
    expect(buttons("Экраны")).toHaveLength(0);
  });

  it("starts the visit of the called patient and asks before marking «Не пришёл»", async () => {
    await renderAs("doctor", { doctorId: 10 });
    await click(buttons("Начать приём")[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenLastCalledWith("isolated-test", 14, "in_consultation");

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("Не пришёл")[0]);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.updateAppointmentStatus).toHaveBeenCalledTimes(1);

    await click(buttons("Не пришёл")[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenLastCalledWith("isolated-test", 14, "no_show");
  });

  it("shows managers the queue without any action buttons", async () => {
    await renderAs("manager");
    expect(textOf(view.root)).toContain("Yusupova Dilnoza");
    expect(textOf(view.root)).toContain("Aliyeva Nodira");
    expect(actionButtons()).toHaveLength(0);
    expect(buttons("Экраны")).toHaveLength(0);
  });

  it("lets reception return a missed patient to the queue", async () => {
    await renderAs("reception");
    const back = buttons("Вернуть в очередь");
    expect(back).toHaveLength(1);
    await click(back[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenCalledWith("isolated-test", 12, "arrived");
    expect(textOf(view.root)).toContain("Пациент снова в очереди: К-07");
    expect(mocks.today).toHaveBeenCalledTimes(2);
    // Reception cannot open the doctor's workspace.
    expect(buttons("Открыть приём")).toHaveLength(0);
  });

  it("gives superadmin the «Экраны» button that opens the TV screens panel", async () => {
    await renderAs("superadmin");
    expect(view.root.findAllByProps({ id: "displays-panel" })).toHaveLength(0);
    await click(buttons("Экраны")[0]);
    expect(view.root.findAllByProps({ id: "displays-panel" })).toHaveLength(1);
  });

  it("shows the empty state when no doctor has a queue today", async () => {
    mocks.today.mockResolvedValue({ ...today, doctors: [] });
    await renderAs("reception");
    expect(textOf(view.root)).toContain("Сегодня очереди пока нет");
    expect(view.root.findAllByType("article")).toHaveLength(0);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/pages/QueuePage.test.tsx`
Expected: FAIL with `Error: Cannot find module './QueuePage' imported from '…/src/modules/queue/pages/QueuePage.test.tsx'`.

- [ ] **Step 11: Add the Queue page keys (ru + uz)**

Use the Edit tool (CRLF files, see Task 9 Step 5). The old snippet is the `"subtitle"` line from Task 6 plus the `"displays": {` line from Task 9; the new keys go between them. `queue.states.*` are read through a literal key map in `QueueEntryRow`, so check-i18n verifies them.

In `apps/web/src/locales/ru.json` replace:
```json
    "subtitle": "Номера пациентов по кабинетам на сегодня",
    "displays": {
```
with:
```json
    "subtitle": "Номера пациентов по кабинетам на сегодня",
    "cabinet": {
      "room": "Кабинет {{room}}",
      "noRoom": "Кабинет —",
      "waiting": "Ждут: {{total}}",
      "done": "Принято: {{total}}",
      "noWaiting": "Ожидающих нет",
      "missed": "Не пришли"
    },
    "states": {
      "waiting": "Ждёт",
      "called": "Вызван",
      "calledTimes": "Вызван ×{{times}}",
      "serving": "На приёме",
      "missed": "Не пришёл",
      "done": "Принят"
    },
    "actions": {
      "callNext": "Вызвать следующего · {{code}}",
      "call": "Вызвать",
      "recall": "Повторить вызов",
      "start": "Начать приём",
      "notCame": "Не пришёл",
      "returnToQueue": "Вернуть в очередь",
      "complete": "Завершить приём",
      "openWorkspace": "Открыть приём",
      "displays": "Экраны",
      "confirmNotCame": "Отметить {{code}} «Не пришёл»? Пациент уйдёт из очереди; вернуть его можно кнопкой «Вернуть в очередь».",
      "confirmComplete": "Завершить приём {{code}}? Диагноз и лечение можно заполнить в карточке приёма."
    },
    "entry": {
      "time": "Запись на {{time}}",
      "wait": "ждёт {{minutes}} мин",
      "noNumber": "Без номера"
    },
    "empty": {
      "title": "Сегодня очереди пока нет",
      "description": "Номер выдаётся автоматически, когда регистратура отмечает пациента «Пришёл»."
    },
    "errors": {
      "loadFailed": "Не удалось обновить очередь",
      "actionFailed": "Не удалось выполнить действие"
    },
    "notices": {
      "called": "Вызван {{code}}",
      "nobodyWaiting": "Ожидающих пациентов нет",
      "started": "Приём начат: {{code}}",
      "missed": "{{code}} отмечен «Не пришёл»",
      "returned": "Пациент снова в очереди: {{code}}",
      "completed": "Приём завершён: {{code}}"
    },
    "displays": {
```

In `apps/web/src/locales/uz.json` replace:
```json
    "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha",
    "displays": {
```
with:
```json
    "subtitle": "Bugungi bemorlar navbati xonalar bo'yicha",
    "cabinet": {
      "room": "Xona {{room}}",
      "noRoom": "Xona —",
      "waiting": "Kutmoqda: {{total}}",
      "done": "Qabul qilindi: {{total}}",
      "noWaiting": "Kutayotganlar yo'q",
      "missed": "Kelmaganlar"
    },
    "states": {
      "waiting": "Kutmoqda",
      "called": "Chaqirildi",
      "calledTimes": "Chaqirildi ×{{times}}",
      "serving": "Qabulda",
      "missed": "Kelmadi",
      "done": "Qabul qilindi"
    },
    "actions": {
      "callNext": "Keyingisini chaqirish · {{code}}",
      "call": "Chaqirish",
      "recall": "Qayta chaqirish",
      "start": "Qabulni boshlash",
      "notCame": "Kelmadi",
      "returnToQueue": "Navbatga qaytarish",
      "complete": "Qabulni yakunlash",
      "openWorkspace": "Qabulni ochish",
      "displays": "Ekranlar",
      "confirmNotCame": "{{code}} «Kelmadi» deb belgilansinmi? Bemor navbatdan chiqadi; uni «Navbatga qaytarish» tugmasi bilan qaytarish mumkin.",
      "confirmComplete": "{{code}} qabuli yakunlansinmi? Tashxis va davolashni qabul kartasida to'ldirish mumkin."
    },
    "entry": {
      "time": "Yozuv: {{time}}",
      "wait": "{{minutes}} daq. kutmoqda",
      "noNumber": "Raqamsiz"
    },
    "empty": {
      "title": "Bugun hozircha navbat yo'q",
      "description": "Qabulxona bemorni «Keldi» deb belgilaganda raqam avtomatik beriladi."
    },
    "errors": {
      "loadFailed": "Navbatni yangilab bo'lmadi",
      "actionFailed": "Amalni bajarib bo'lmadi"
    },
    "notices": {
      "called": "{{code}} chaqirildi",
      "nobodyWaiting": "Kutayotgan bemorlar yo'q",
      "started": "Qabul boshlandi: {{code}}",
      "missed": "{{code}} «Kelmadi» deb belgilandi",
      "returned": "Bemor yana navbatda: {{code}}",
      "completed": "Qabul yakunlandi: {{code}}"
    },
    "displays": {
```

- [ ] **Step 12: Create the entry row, the cabinet card and the page**

Create `apps/web/src/modules/queue/components/QueueEntryRow.tsx` with:
```tsx
import React from "react";
import { useTranslation } from "react-i18next";
import type { QueueEntry, QueueEntryState } from "../api/queueTypes";
import { formatWallTime } from "../utils/queueView";

/** Literal keys so check-i18n verifies them. */
const STATE_KEYS: Record<QueueEntryState, string> = {
  waiting: "queue.states.waiting",
  called: "queue.states.called",
  serving: "queue.states.serving",
  missed: "queue.states.missed",
  done: "queue.states.done",
};
const STATE_TONES: Record<QueueEntryState, string> = {
  waiting: "bg-slate-100 text-slate-600",
  called: "bg-amber-100 text-amber-800",
  serving: "bg-emerald-100 text-emerald-800",
  missed: "bg-rose-100 text-rose-700",
  done: "bg-slate-100 text-slate-500",
};
const ROW_TONES: Partial<Record<QueueEntryState, string>> = {
  called: "bg-amber-50/70",
  serving: "bg-emerald-50/70",
};

/** One patient in a cabinet queue: code, full name, appointment time, waiting time, state; actions on the right. */
export function QueueEntryRow({
  entry,
  waitMinutes,
  children,
}: {
  entry: QueueEntry;
  /** Minutes since the number was issued (shown for waiting/called entries), or null. */
  waitMinutes: number | null;
  /** Action buttons; pass null for read-only roles. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const stateLabel =
    entry.state === "called" && entry.callCount > 1
      ? t("queue.states.calledTimes", { times: entry.callCount })
      : t(STATE_KEYS[entry.state]);
  const showWait = waitMinutes !== null && (entry.state === "waiting" || entry.state === "called");
  return (
    <li
      className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${ROW_TONES[entry.state] ?? ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-16 shrink-0 font-mono text-lg font-bold tracking-tight text-slate-900">
          {entry.code ?? "—"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{entry.patientName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{t("queue.entry.time", { time: formatWallTime(entry.startAt) })}</span>
            {showWait ? <span>{t("queue.entry.wait", { minutes: waitMinutes })}</span> : null}
            {entry.state !== "waiting" ? (
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATE_TONES[entry.state]}`}>{stateLabel}</span>
            ) : null}
            {entry.code === null ? <span>{t("queue.entry.noNumber")}</span> : null}
          </p>
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-wrap gap-1.5">{children}</div> : null}
    </li>
  );
}
```

Create `apps/web/src/modules/queue/components/CabinetQueueCard.tsx` with:
```tsx
import React from "react";
import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";
import { nextWaiting, type QueueAction } from "../utils/queueView";
import { QueueEntryRow } from "./QueueEntryRow";

export type CabinetPermissions = {
  /** Call / call next / start / not came / complete (queue.update — reception, doctor, nurse, superadmin). */
  canCall: boolean;
  /** «Вернуть в очередь» for a missed patient (queue.create — reception, superadmin). */
  canIssue: boolean;
  /** «Открыть приём» → /doctor-workspace/:id. */
  canOpenWorkspace: boolean;
};

const buttonBase =
  "inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${buttonBase} bg-emerald-600 text-white hover:bg-emerald-700`;
const secondaryButton = `${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const dangerButton = `${buttonBase} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`;

/** One doctor's queue today: who is in the cabinet, the big «Вызвать следующего», waiting and missed patients. */
export function CabinetQueueCard({
  day,
  permissions,
  disabled,
  waitOf,
  onAction,
}: {
  day: QueueDoctorDay;
  permissions: CabinetPermissions;
  /** True while any queue action is running (prevents double calls). */
  disabled: boolean;
  waitOf: (entry: QueueEntry) => number | null;
  onAction: (action: QueueAction) => void;
}) {
  const { t } = useTranslation();
  const next = nextWaiting(day);
  const room = day.room?.trim();

  const button = (label: string, action: QueueAction, className: string) => (
    <button type="button" data-action={action.kind} className={className} disabled={disabled} onClick={() => onAction(action)}>
      {label}
    </button>
  );

  const servingActions = (entry: QueueEntry) =>
    permissions.canCall || permissions.canOpenWorkspace ? (
      <>
        {permissions.canOpenWorkspace ? button(t("queue.actions.openWorkspace"), { kind: "openWorkspace", entry }, secondaryButton) : null}
        {permissions.canCall ? button(t("queue.actions.complete"), { kind: "complete", entry }, primaryButton) : null}
      </>
    ) : null;

  const waitingActions = (entry: QueueEntry) => {
    if (!permissions.canCall) return null;
    if (entry.state === "called") {
      return (
        <>
          {button(t("queue.actions.start"), { kind: "start", entry }, primaryButton)}
          {button(t("queue.actions.recall"), { kind: "call", entry }, secondaryButton)}
          {button(t("queue.actions.notCame"), { kind: "notCame", entry }, dangerButton)}
        </>
      );
    }
    return button(t("queue.actions.call"), { kind: "call", entry }, secondaryButton);
  };

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={day.doctorName}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {room ? t("queue.cabinet.room", { room }) : t("queue.cabinet.noRoom")}
          </p>
          <h3 className="truncate text-base font-semibold text-slate-900">{day.doctorName}</h3>
          {day.specialty ? <p className="truncate text-xs text-slate-500">{day.specialty}</p> : null}
        </div>
        <div className="shrink-0 space-y-0.5 text-right text-xs text-slate-500">
          <p>{t("queue.cabinet.waiting", { total: day.waiting.length })}</p>
          <p>{t("queue.cabinet.done", { total: day.doneCount })}</p>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {day.serving ? (
          <ul className="overflow-hidden rounded-xl border border-emerald-200">
            <QueueEntryRow entry={day.serving} waitMinutes={null}>
              {servingActions(day.serving)}
            </QueueEntryRow>
          </ul>
        ) : null}

        {permissions.canCall ? (
          next ? (
            <button
              type="button"
              data-action="callNext"
              disabled={disabled}
              onClick={() => onAction({ kind: "callNext", doctorId: day.doctorId })}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Megaphone className="h-5 w-5" aria-hidden />
              {t("queue.actions.callNext", { code: next.code ?? "" })}
            </button>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-sm text-slate-500">
              {t("queue.cabinet.noWaiting")}
            </p>
          )
        ) : null}

        {day.waiting.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {day.waiting.map((entry) => (
              <QueueEntryRow key={entry.appointmentId} entry={entry} waitMinutes={waitOf(entry)}>
                {waitingActions(entry)}
              </QueueEntryRow>
            ))}
          </ul>
        ) : !permissions.canCall ? (
          <p className="text-sm text-slate-500">{t("queue.cabinet.noWaiting")}</p>
        ) : null}

        {day.missed.length ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("queue.cabinet.missed")}</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {day.missed.map((entry) => (
                <QueueEntryRow key={entry.appointmentId} entry={entry} waitMinutes={null}>
                  {permissions.canIssue
                    ? button(t("queue.actions.returnToQueue"), { kind: "returnToQueue", entry }, secondaryButton)
                    : null}
                </QueueEntryRow>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
```

Create `apps/web/src/modules/queue/pages/QueuePage.tsx` with:
```tsx
import React from "react";
import { ListOrdered, RefreshCw, Tv } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import {
  DOCTOR_WORKSPACE_ROLES,
  canCallQueue,
  canIssueQueue,
  canManageQueueDisplays,
} from "../../../auth/roleGroups";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { appointmentsFlowApi } from "../../appointments/api/appointmentsFlowApi";
import { queueApi } from "../api/queueApi";
import type { QueueEntry } from "../api/queueTypes";
import { CabinetQueueCard } from "../components/CabinetQueueCard";
import { DisplaysPanel } from "../components/DisplaysPanel";
import { usePolling } from "../hooks/usePolling";
import { entryLabel, waitMinutes, type QueueAction } from "../utils/queueView";

const QUEUE_POLL_MS = 5000;

type ServerAction = Exclude<QueueAction, { kind: "openWorkspace" }>;

/**
 * Staff «Очередь» page. Doctors and nurses get only their doctor's card (the API scopes /today and always
 * includes their doctor); reception and superadmin see every cabinet with actions; manager and director read only.
 */
export const QueuePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const role = user?.role;
  const canCall = canCallQueue(role);
  const canIssue = canIssueQueue(role);
  const canManageDisplays = canManageQueueDisplays(role);
  // Opening the visit is an action too: read-only roles (manager, director) never get it.
  const canOpenWorkspace = canCall && !!role && DOCTOR_WORKSPACE_ROLES.includes(role);

  const { data, error, loading, refresh } = usePolling((signal) => queueApi.today(null, signal), QUEUE_POLL_MS, []);
  // Client clock minus server clock when this snapshot arrived (see waitMinutes).
  const skewMs = React.useMemo(() => (data ? Date.now() - Date.parse(data.serverTime) : 0), [data]);
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [showDisplays, setShowDisplays] = React.useState(false);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const waitOf = (entry: QueueEntry): number | null =>
    data ? waitMinutes(entry.issuedAt, data.serverTime, skewMs, Date.now()) : null;

  /** Runs one action on the API and returns the notice to show. */
  const perform = async (action: ServerAction, authToken: string): Promise<string> => {
    switch (action.kind) {
      case "callNext": {
        const { entry } = await queueApi.callNext(action.doctorId);
        return entry ? t("queue.notices.called", { code: entryLabel(entry) }) : t("queue.notices.nobodyWaiting");
      }
      case "call": {
        const { entry } = await queueApi.call(action.entry.appointmentId);
        return t("queue.notices.called", { code: entryLabel(entry) });
      }
      case "start":
        await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "in_consultation");
        return t("queue.notices.started", { code: entryLabel(action.entry) });
      case "notCame":
        await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "no_show");
        return t("queue.notices.missed", { code: entryLabel(action.entry) });
      case "returnToQueue": {
        // The API gives a NEW number at the end of the queue (no_show → arrived is allowed only for today's visit).
        const updated = await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "arrived");
        return t("queue.notices.returned", { code: updated.queueCode ?? entryLabel(action.entry) });
      }
      case "complete":
        await appointmentsFlowApi.completeAppointment(authToken, action.entry.appointmentId, {});
        return t("queue.notices.completed", { code: entryLabel(action.entry) });
    }
  };

  const run = async (action: QueueAction) => {
    // requestJson treats "" as "no token" (it would send no Authorization header), so never call without one.
    if (pending || !token) return;
    if (action.kind === "openWorkspace") {
      navigate(`/doctor-workspace/${action.entry.appointmentId}`);
      return;
    }
    if (action.kind === "notCame" && !window.confirm(t("queue.actions.confirmNotCame", { code: entryLabel(action.entry) }))) {
      return;
    }
    if (action.kind === "complete" && !window.confirm(t("queue.actions.confirmComplete", { code: entryLabel(action.entry) }))) {
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      setNotice(await perform(action, token));
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : t("queue.errors.actionFailed"));
    } finally {
      setPending(false);
      // Refresh after a failure too: it usually means somebody else already changed this patient.
      refresh();
    }
  };

  const doctors = data?.doctors ?? [];

  return (
    <div className="page-enter space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("queue.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("queue.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageDisplays ? (
            <button
              type="button"
              onClick={() => setShowDisplays((value) => !value)}
              aria-expanded={showDisplays}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <Tv className="h-4 w-4" aria-hidden />
              {t("queue.actions.displays")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            aria-label={t("common.actions.refresh")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      {showDisplays ? <DisplaysPanel onClose={() => setShowDisplays(false)} /> : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {t("queue.errors.loadFailed")}: {error}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : data && doctors.length === 0 ? (
        <ListEmptyState icon={ListOrdered} title={t("queue.empty.title")} description={t("queue.empty.description")} />
      ) : doctors.length ? (
        <div className={doctors.length === 1 ? "max-w-3xl" : "grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"}>
          {doctors.map((day) => (
            <CabinetQueueCard
              key={day.doctorId}
              day={day}
              permissions={{ canCall, canIssue, canOpenWorkspace }}
              disabled={pending}
              waitOf={waitOf}
              onAction={(action) => void run(action)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 13: Run the page test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/pages/QueuePage.test.tsx`
Expected: PASS (6 tests), no `act(...)` or React key warnings.

- [ ] **Step 14: Write the failing menu test**

`Sidebar.test.tsx` pins the section headings (`nav.main`, `nav.reports`, `nav.billing`, `nav.admin`), so the item goes INTO `nav.main`; `MobileBottomNav.test.tsx` requires every drawer label to be a translated, unique `labelKey`, hence `labelKey: "pages.queue"` (added by Task 6).

Create `apps/web/src/navigation/navigationConfig.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import { QUEUE_ROLES } from "../auth/roleGroups";
import { navigationConfig } from "./navigationConfig";

describe("queue menu item", () => {
  it("sits in the main section right after appointments, for the queue roles, with a translated label", () => {
    const main = navigationConfig.find((section) => section.sectionKey === "nav.main");
    const paths = main?.items.map((item) => item.path) ?? [];
    expect(paths.indexOf("/queue")).toBe(paths.indexOf("/appointments") + 1);
    const item = main?.items.find((entry) => entry.path === "/queue");
    expect(item?.labelKey).toBe("pages.queue");
    expect(item?.roles).toEqual(QUEUE_ROLES);
    expect(item?.icon).toBeDefined();
  });
});
```

- [ ] **Step 15: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/navigation/navigationConfig.test.ts`
Expected: FAIL with `AssertionError: expected -1 to be 3 // Object.is equality` (no `/queue` item yet; appointments is item 2).

- [ ] **Step 16: Add the route, the menu item and the page title**

The page is lazy like `CallCenterPage`, so the queue module (and the screens panel) stays out of the main bundle.

In `apps/web/src/router/AppRouter.tsx` replace:
```tsx
const CallCenterPage = React.lazy(() => import("../modules/call-center/pages/CallCenterPage").then((module) => ({ default: module.CallCenterPage })));
```
with:
```tsx
const CallCenterPage = React.lazy(() => import("../modules/call-center/pages/CallCenterPage").then((module) => ({ default: module.CallCenterPage })));
const QueuePage = React.lazy(() => import("../modules/queue/pages/QueuePage").then((module) => ({ default: module.QueuePage })));
```

In `apps/web/src/router/AppRouter.tsx` replace:
```tsx
  QUESTIONNAIRE_ROLES,
  REPORT_ROLES,
```
with:
```tsx
  QUESTIONNAIRE_ROLES,
  QUEUE_ROLES,
  REPORT_ROLES,
```

In `apps/web/src/router/AppRouter.tsx` replace:
```tsx
            <RoleGuard roles={CALL_CENTER_ROLES}>
              <React.Suspense fallback={<PageLoader />}><CallCenterPage /></React.Suspense>
            </RoleGuard>
          }
        />
```
with:
```tsx
            <RoleGuard roles={CALL_CENTER_ROLES}>
              <React.Suspense fallback={<PageLoader />}><CallCenterPage /></React.Suspense>
            </RoleGuard>
          }
        />
        <Route
          path="/queue"
          element={
            <RoleGuard roles={QUEUE_ROLES}>
              <React.Suspense fallback={<PageLoader />}><QueuePage /></React.Suspense>
            </RoleGuard>
          }
        />
```

In `apps/web/src/navigation/navigationConfig.tsx` replace:
```tsx
  ListChecks,
  Network,
```
with:
```tsx
  ListChecks,
  ListOrdered,
  Network,
```

In `apps/web/src/navigation/navigationConfig.tsx` replace:
```tsx
  QUESTIONNAIRE_ROLES,
  REPORT_ROLES,
```
with:
```tsx
  QUESTIONNAIRE_ROLES,
  QUEUE_ROLES,
  REPORT_ROLES,
```

In `apps/web/src/navigation/navigationConfig.tsx` replace:
```tsx
      { label: "", labelKey: "pages.appointments", path: "/appointments", roles: APPOINTMENTS_PAGE_ROUTE_ROLES, icon: CalendarDays },
```
with:
```tsx
      { label: "", labelKey: "pages.appointments", path: "/appointments", roles: APPOINTMENTS_PAGE_ROUTE_ROLES, icon: CalendarDays },
      { label: "", labelKey: "pages.queue", path: "/queue", roles: QUEUE_ROLES, icon: ListOrdered },
```

Without this entry the header title of `/queue` falls back to «Панель управления».

In `apps/web/src/layouts/MainLayout.tsx` replace:
```tsx
    "/call-center": "pages.callCenter",
```
with:
```tsx
    "/call-center": "pages.callCenter",
    "/queue": "pages.queue",
```

- [ ] **Step 17: Run the tests, the whole web suite, typecheck and the i18n check**

Run: `cd apps/web && npx vitest run src/navigation src/components/Sidebar.test.tsx src/shared/ui/MobileBottomNav.test.tsx src/modules/queue`
Expected: PASS — 12 files, 50 tests: the new menu test, the unchanged Sidebar and MobileBottomNav tests, and every queue test (Tasks 6, 8, 9, 10).
Run: `cd apps/web && npm test`
Expected: PASS — 26 test files, 131 tests, 0 failures (4 more files and 19 more tests than at the end of Task 9).
Run: `cd apps/web && npm run typecheck`
Expected: PASS (no output).
Run: `cd apps/web && npm run check-i18n`
Expected: `[i18n] OK: 1811 keys, full ru/uz parity, all code references resolve.` (36 more than the 1775 at the end of Task 9).
Run: `git diff --numstat -- apps/web/src/locales`
Expected: `50  0  apps/web/src/locales/ru.json` and `50  0  apps/web/src/locales/uz.json`; ~2000 changed lines means the file was re-serialized (restore it and redo Step 11 with the Edit tool).

- [ ] **Step 18: Commit**

```bash
git add apps/web/src/modules/queue/utils/queueView.ts apps/web/src/modules/queue/utils/queueView.test.ts apps/web/src/modules/queue/hooks/usePolling.ts apps/web/src/modules/queue/hooks/usePolling.test.tsx apps/web/src/modules/queue/components/QueueEntryRow.tsx apps/web/src/modules/queue/components/CabinetQueueCard.tsx apps/web/src/modules/queue/pages/QueuePage.tsx apps/web/src/modules/queue/pages/QueuePage.test.tsx apps/web/src/router/AppRouter.tsx apps/web/src/navigation/navigationConfig.tsx apps/web/src/navigation/navigationConfig.test.ts apps/web/src/layouts/MainLayout.tsx apps/web/src/locales/ru.json apps/web/src/locales/uz.json && git commit -m "feat(web): staff queue page with cabinet queues and call actions"
```

---

### Task 11: TV logic — voice catalogue, phrases, call tracking, labels, layout, audio trim, code input (pure)

**Files:**
- Create: `apps/web/src/modules/queue/tv/voiceClips.json`
- Create: `apps/web/src/modules/queue/tv/voicePhrases.ts`
- Create: `apps/web/src/modules/queue/tv/callTracker.ts`
- Create: `apps/web/src/modules/queue/tv/tvLabels.ts`
- Create: `apps/web/src/modules/queue/tv/tvLayout.ts`
- Create: `apps/web/src/modules/queue/tv/audioTrim.ts`
- Create: `apps/web/src/modules/queue/tv/codeInput.ts`
- Test: `apps/web/src/modules/queue/tv/voicePhrases.test.ts`
- Test: `apps/web/src/modules/queue/tv/callTracker.test.ts`
- Test: `apps/web/src/modules/queue/tv/tvLabels.test.ts`
- Test: `apps/web/src/modules/queue/tv/tvLayout.test.ts`
- Test: `apps/web/src/modules/queue/tv/audioTrim.test.ts`
- Test: `apps/web/src/modules/queue/tv/codeInput.test.ts`

**Interfaces:**
- Consumes (Task 6, `apps/web/src/modules/queue/api/queueTypes.ts`): `QueueDisplayLanguage` (`"uz" | "ru" | "uz_ru"`), `QueueDisplayState`, `QueueDisplayCall`.
- Produces (Task 12 and Task 13 rely on these exact names):
  - `voiceClips.json`: `{ "ru": { "<id>": "<text>" }, "uz": { "<id>": "<text>" } }` — ru ids `"1"…"19"`, `"20"…"90"` (tens), `"100"…"900"` (hundreds), `nomer`, `proydite_v_kabinet_nomer`, `proydite_na_priyom` (39 ids); uz ids `"1"…"9"`, `"10"…"90"`, `"100"…"900"`, `navbat_raqami`, `xona_raqami`, `qabulga_marhamat` (30 ids). Task 13 turns every id into `apps/web/public/queue-voice/<lang>/<id>.mp3`.
  - `voicePhrases.ts`: `type VoiceLang = "uz" | "ru"`; `numberClipIds(lang: VoiceLang, n: number): string[] | null`; `announcementClipIds(lang: VoiceLang, queueNumber: number, room: string | null): string[]`; `voiceLangs(language: QueueDisplayLanguage): VoiceLang[]`; plus `SENTENCE_START_CLIP_IDS: readonly string[]` and `gapBeforeClipMs(clipId: string): number` (60 or 300, used by the announcer).
  - `callTracker.ts`: `createCallTracker(freshMs = 120_000): { ingest(state: QueueDisplayState): QueueDisplayCall[] }`.
  - `tvLabels.ts`: `TV_LABELS` (keys `queueTitle, cabinet, doctor, serving, called, next, free, noQueue, noQueueYet, recentCalls, invitation, startButton, startHint, offline, notFound, inactive, enterCode, openScreen, codePlaceholder`, each `{ uz, ru }`), `type TvLabelKey = keyof typeof TV_LABELS`, `tvLabel(key: TvLabelKey, language: QueueDisplayLanguage): string`.
  - `tvLayout.ts`: `CABINETS_PER_PAGE = 9`, `pageCabinets<T>(items: T[], pageIndex: number): { page: T[]; pageCount: number }`, `gridColumns(count: number): number`.
  - `audioTrim.ts`: `silenceBounds(samples: Float32Array, threshold = 0.003): [number, number]`.
  - `codeInput.ts`: `normalizeCodeInput(value: string): string`, `formatCodeForDisplay(canonical: string): string`.

Gotchas for this task:
- Web tests run in vitest's **node** environment (no DOM). Everything here is pure, so tests import the functions directly.
- `scripts/check-i18n.cjs` scans every non-test `.ts/.tsx` file for quoted literals shaped like `"<top-level-locale-namespace>.<key>"` (for example `"queue.title"`, `"common.x"`, `"clinic.x"`) and fails the build if the key is missing. The TV code uses constant strings, not i18n, so never write a literal of that shape in these files (`"/queue-voice"` is fine: it starts with `/`).
- `voiceClips.json` writes the Uzbek oʻ with **U+02BB** (ʻ, MODIFIER LETTER TURNED COMMA) in exactly seven texts: `toʻrt`, `toʻqqiz`, `oʻn`, `oʻttiz`, `toʻqson`, `toʻrt yuz`, `toʻqqiz yuz`. A test checks the code point, so do not replace it with `'` or `‘`. Only these clips contain oʻ; none contains gʻ. If the Azure voice mispronounces one of them, respell it only as Task 13's «Listening check» describes: that changes the catalogue and both pinned tests (this file's and `scripts/queueVoice.test.mjs`) together. `TV_LABELS` (screen text) deliberately uses U+2018 (`‘`) instead, because every TV font has that glyph.
- `tsconfig.json` has `resolveJsonModule`, so `import voiceClips from "./voiceClips.json"` works (the repo already imports `locales/ru.json` this way). The JSON infers literal keys, so tests cast it to `Record<VoiceLang, Record<string, string>>` before indexing with computed ids.

- [ ] **Step 1: Write the clip catalogue and the failing phrase test**

Create `apps/web/src/modules/queue/tv/voiceClips.json` (UTF-8; this is data that Task 13 voices, so it is written in full now):
```json
{
  "ru": {
    "1": "один",
    "2": "два",
    "3": "три",
    "4": "четыре",
    "5": "пять",
    "6": "шесть",
    "7": "семь",
    "8": "восемь",
    "9": "девять",
    "10": "десять",
    "11": "одиннадцать",
    "12": "двенадцать",
    "13": "тринадцать",
    "14": "четырнадцать",
    "15": "пятнадцать",
    "16": "шестнадцать",
    "17": "семнадцать",
    "18": "восемнадцать",
    "19": "девятнадцать",
    "20": "двадцать",
    "30": "тридцать",
    "40": "сорок",
    "50": "пятьдесят",
    "60": "шестьдесят",
    "70": "семьдесят",
    "80": "восемьдесят",
    "90": "девяносто",
    "100": "сто",
    "200": "двести",
    "300": "триста",
    "400": "четыреста",
    "500": "пятьсот",
    "600": "шестьсот",
    "700": "семьсот",
    "800": "восемьсот",
    "900": "девятьсот",
    "nomer": "Номер",
    "proydite_v_kabinet_nomer": "Пройдите в кабинет номер",
    "proydite_na_priyom": "Пройдите на приём."
  },
  "uz": {
    "1": "bir",
    "2": "ikki",
    "3": "uch",
    "4": "toʻrt",
    "5": "besh",
    "6": "olti",
    "7": "yetti",
    "8": "sakkiz",
    "9": "toʻqqiz",
    "10": "oʻn",
    "20": "yigirma",
    "30": "oʻttiz",
    "40": "qirq",
    "50": "ellik",
    "60": "oltmish",
    "70": "yetmish",
    "80": "sakson",
    "90": "toʻqson",
    "100": "yuz",
    "200": "ikki yuz",
    "300": "uch yuz",
    "400": "toʻrt yuz",
    "500": "besh yuz",
    "600": "olti yuz",
    "700": "yetti yuz",
    "800": "sakkiz yuz",
    "900": "toʻqqiz yuz",
    "navbat_raqami": "Navbat raqami",
    "xona_raqami": "Xona raqami",
    "qabulga_marhamat": "Qabulga marhamat."
  }
}
```

Create `apps/web/src/modules/queue/tv/voicePhrases.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import voiceClips from "./voiceClips.json";
import { announcementClipIds, gapBeforeClipMs, numberClipIds, voiceLangs, type VoiceLang } from "./voicePhrases";

const clips = voiceClips as Record<VoiceLang, Record<string, string>>;
const NUMBER_ID = /^[0-9]+$/;

describe("voice clip catalogue", () => {
  it("has 36 Russian and 27 Uzbek number clips plus 3 phrases each", () => {
    expect(Object.keys(clips.ru).filter((id) => NUMBER_ID.test(id))).toHaveLength(36);
    expect(Object.keys(clips.uz).filter((id) => NUMBER_ID.test(id))).toHaveLength(27);
    expect(Object.keys(clips.ru).filter((id) => !NUMBER_ID.test(id)).sort()).toEqual(["nomer", "proydite_na_priyom", "proydite_v_kabinet_nomer"]);
    expect(Object.keys(clips.uz).filter((id) => !NUMBER_ID.test(id)).sort()).toEqual(["navbat_raqami", "qabulga_marhamat", "xona_raqami"]);
  });

  it("writes the Uzbek oʻ with U+02BB and never with an ASCII or typographic quote", () => {
    for (const id of ["4", "9", "10", "30", "90", "400", "900"]) expect(clips.uz[id]).toContain("\u02BB");
    expect(clips.uz["4"]).toBe("to\u02BBrt");
    for (const text of Object.values(clips.uz)) expect(text).not.toMatch(/['\u2018\u2019]/);
  });

  it("has a clip for every id produced for 1..999 in both languages", () => {
    const missing: string[] = [];
    for (const lang of ["uz", "ru"] as const) {
      for (let n = 1; n <= 999; n += 1) {
        const ids = [
          ...(numberClipIds(lang, n) ?? ["<null>"]),
          ...announcementClipIds(lang, n, String(n)),
          ...announcementClipIds(lang, n, null),
        ];
        for (const id of ids) if (typeof clips[lang][id] !== "string") missing.push(`${lang}:${n}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("numberClipIds", () => {
  it.each([
    [1, ["1"], ["1"]],
    [5, ["5"], ["5"]],
    [11, ["11"], ["10", "1"]],
    [19, ["19"], ["10", "9"]],
    [20, ["20"], ["20"]],
    [27, ["20", "7"], ["20", "7"]],
    [100, ["100"], ["100"]],
    [115, ["100", "15"], ["100", "10", "5"]],
    [999, ["900", "90", "9"], ["900", "90", "9"]],
  ])("%i → ru %j, uz %j", (n, ru, uz) => {
    expect(numberClipIds("ru", n)).toEqual(ru);
    expect(numberClipIds("uz", n)).toEqual(uz);
  });

  it("returns null outside 1..999 and for non-integers", () => {
    for (const n of [0, -3, 1000, 1234, 2.5, Number.NaN]) {
      expect(numberClipIds("ru", n)).toBeNull();
      expect(numberClipIds("uz", n)).toBeNull();
    }
  });
});

describe("announcementClipIds", () => {
  it("builds «Номер двадцать семь. Пройдите в кабинет номер пять.» and the Uzbek counterpart", () => {
    expect(announcementClipIds("ru", 27, "5")).toEqual(["nomer", "20", "7", "proydite_v_kabinet_nomer", "5"]);
    expect(announcementClipIds("uz", 27, "5")).toEqual(["navbat_raqami", "20", "7", "xona_raqami", "5"]);
    expect(announcementClipIds("ru", 115, " 12 ")).toEqual(["nomer", "100", "15", "proydite_v_kabinet_nomer", "12"]);
  });

  it.each(["УЗИ", null, "0", "1000", "05", "3а", ""])("uses the fallback phrase for room %j", (room) => {
    expect(announcementClipIds("ru", 7, room)).toEqual(["nomer", "7", "proydite_na_priyom"]);
    expect(announcementClipIds("uz", 7, room)).toEqual(["navbat_raqami", "7", "qabulga_marhamat"]);
  });

  it("says nothing for queue numbers above 999", () => {
    expect(announcementClipIds("ru", 1000, "5")).toEqual([]);
    expect(announcementClipIds("uz", 1500, null)).toEqual([]);
  });
});

describe("voiceLangs and pauses", () => {
  it("speaks Uzbek first for bilingual displays", () => {
    expect(voiceLangs("uz_ru")).toEqual(["uz", "ru"]);
    expect(voiceLangs("uz")).toEqual(["uz"]);
    expect(voiceLangs("ru")).toEqual(["ru"]);
  });

  it("pauses longer before a new sentence than between number words", () => {
    expect(gapBeforeClipMs("7")).toBe(60);
    expect(gapBeforeClipMs("proydite_v_kabinet_nomer")).toBe(300);
    expect(gapBeforeClipMs("xona_raqami")).toBe(300);
    expect(gapBeforeClipMs("proydite_na_priyom")).toBe(300);
    expect(gapBeforeClipMs("qabulga_marhamat")).toBe(300);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/voicePhrases.test.ts`
Expected: FAIL with `Error: Cannot find module './voicePhrases' imported from '…/src/modules/queue/tv/voicePhrases.test.ts'`.

- [ ] **Step 3: Implement the phrase builder**

The phrases follow contract §0.12: uz `Navbat raqami <N>. Xona raqami <R>.` (fallback `Navbat raqami <N>. Qabulga marhamat.`), ru `Номер <N>. Пройдите в кабинет номер <R>.` (fallback `Номер <N>. Пройдите на приём.`). Only a plain room number 1–999 is spoken (`"05"`, `"0"`, `"1000"`, `"УЗИ"`, `null` → fallback); a queue number above 999 gives `[]` (chime only).

Create `apps/web/src/modules/queue/tv/voicePhrases.ts`:
```ts
import type { QueueDisplayLanguage } from "../api/queueTypes";

/**
 * Spoken announcement = ordered list of clip ids; each id is a file `public/queue-voice/<lang>/<id>.mp3`
 * (texts live in voiceClips.json and are voiced once by scripts/generate-queue-voice.mjs).
 *   uz: "Navbat raqami <N>. Xona raqami <R>."      fallback: "Navbat raqami <N>. Qabulga marhamat."
 *   ru: "Номер <N>. Пройдите в кабинет номер <R>."  fallback: "Номер <N>. Пройдите на приём."
 * Numbers above 999 are never spoken (chime only); the doctor's queue letter is never spoken.
 */
export type VoiceLang = "uz" | "ru";

/** Clips that start a new sentence: the announcer leaves a longer pause before them. */
export const SENTENCE_START_CLIP_IDS: readonly string[] = [
  "proydite_v_kabinet_nomer",
  "proydite_na_priyom",
  "xona_raqami",
  "qabulga_marhamat",
];

/** Pause (ms) the announcer leaves before a clip that is not the first one of a phrase. */
export function gapBeforeClipMs(clipId: string): number {
  return SENTENCE_START_CLIP_IDS.includes(clipId) ? 300 : 60;
}

/**
 * Clip ids that pronounce `n` (integer 1..999); null outside that range.
 * ru: hundreds + (1..19 as one word | tens + units)  → 115 = ["100","15"], 27 = ["20","7"].
 * uz: hundreds + tens + units, zeros skipped          → 115 = ["100","10","5"], 11 = ["10","1"].
 */
export function numberClipIds(lang: VoiceLang, n: number): string[] | null {
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  const ids: string[] = [];
  const hundreds = Math.floor(n / 100) * 100;
  const rest = n % 100;
  if (hundreds > 0) ids.push(String(hundreds));
  if (lang === "ru" && rest > 0 && rest < 20) {
    ids.push(String(rest));
    return ids;
  }
  const tens = Math.floor(rest / 10) * 10;
  const units = rest % 10;
  if (tens > 0) ids.push(String(tens));
  if (units > 0) ids.push(String(units));
  return ids;
}

/** Room text → number to speak: only plain "1".."999" (no leading zero, no letters); anything else → null. */
function spokenRoomNumber(room: string | null): number | null {
  const text = (room ?? "").trim();
  return /^[1-9][0-9]{0,2}$/.test(text) ? Number(text) : null;
}

/** Full announcement for one language; [] when the queue number cannot be spoken (> 999). */
export function announcementClipIds(lang: VoiceLang, queueNumber: number, room: string | null): string[] {
  const numberIds = numberClipIds(lang, queueNumber);
  if (!numberIds) return [];
  const roomNumber = spokenRoomNumber(room);
  const roomIds = roomNumber === null ? null : numberClipIds(lang, roomNumber);
  if (lang === "ru") {
    return roomIds
      ? ["nomer", ...numberIds, "proydite_v_kabinet_nomer", ...roomIds]
      : ["nomer", ...numberIds, "proydite_na_priyom"];
  }
  return roomIds
    ? ["navbat_raqami", ...numberIds, "xona_raqami", ...roomIds]
    : ["navbat_raqami", ...numberIds, "qabulga_marhamat"];
}

/** Speaking order for a display: uz_ru → Uzbek first, then Russian. */
export function voiceLangs(language: QueueDisplayLanguage): VoiceLang[] {
  if (language === "uz") return ["uz"];
  if (language === "ru") return ["ru"];
  return ["uz", "ru"];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/voicePhrases.test.ts && npm run typecheck`
Expected: PASS (24 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 5: Write the failing call-tracker test**

Create `apps/web/src/modules/queue/tv/callTracker.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";
import { createCallTracker } from "./callTracker";

const call = (key: string, calledAt: string, code = "К-05"): QueueDisplayCall => ({
  key, code, number: 5, name: "Алишер К.", room: "3", doctorName: "Каримов Бахтиёр", calledAt,
});

const state = (serverTime: string, recentCalls: QueueDisplayCall[]): QueueDisplayState => ({
  serverTime,
  timeZone: "Asia/Tashkent",
  clinicName: "Клиника",
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls,
});

describe("createCallTracker", () => {
  it("stays silent on the first ingest even for fresh calls", () => {
    const tracker = createCallTracker();
    expect(tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:50.000Z")]))).toEqual([]);
  });

  it("announces a new key once and never repeats it on later ingests", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:00.000Z")]));
    const fresh = call("11:1", "2026-09-30T06:00:01.000Z", "К-06");
    const next = state("2026-09-30T06:00:02.000Z", [fresh, call("10:1", "2026-09-30T05:59:00.000Z")]);
    expect(tracker.ingest(next)).toEqual([fresh]);
    expect(tracker.ingest(next)).toEqual([]);
    expect(tracker.ingest(state("2026-09-30T06:00:04.000Z", [fresh]))).toEqual([]);
  });

  it("announces a re-call of the same patient (callCount grew, so the key is new)", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", [call("10:1", "2026-09-30T05:59:00.000Z")]));
    const again = call("10:2", "2026-09-30T06:00:30.000Z");
    expect(tracker.ingest(state("2026-09-30T06:00:31.000Z", [again, call("10:1", "2026-09-30T05:59:00.000Z")]))).toEqual([again]);
  });

  it("ignores calls older than two minutes by the server clock but still remembers them", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const stale = call("12:1", "2026-09-30T05:57:59.000Z");
    const edge = call("13:1", "2026-09-30T05:58:00.000Z");
    expect(tracker.ingest(state("2026-09-30T06:00:00.000Z", [edge, stale]))).toEqual([edge]);
    expect(tracker.ingest(state("2026-09-30T06:00:02.000Z", [edge, stale]))).toEqual([]);
  });

  it("returns several new calls oldest first", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const first = call("20:1", "2026-09-30T06:00:01.000Z", "А-01");
    const second = call("21:1", "2026-09-30T06:00:03.000Z", "Б-01");
    const third = call("22:1", "2026-09-30T06:00:05.000Z", "В-01");
    expect(tracker.ingest(state("2026-09-30T06:00:06.000Z", [third, second, first]))).toEqual([first, second, third]);
  });

  it("accepts a call stamped slightly after serverTime", () => {
    const tracker = createCallTracker();
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    const early = call("30:1", "2026-09-30T06:00:00.200Z");
    expect(tracker.ingest(state("2026-09-30T06:00:00.100Z", [early]))).toEqual([early]);
  });

  it("uses the freshness window passed to the factory", () => {
    const tracker = createCallTracker(10_000);
    tracker.ingest(state("2026-09-30T06:00:00.000Z", []));
    expect(tracker.ingest(state("2026-09-30T06:00:20.000Z", [call("40:1", "2026-09-30T06:00:05.000Z")]))).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/callTracker.test.ts`
Expected: FAIL with `Error: Cannot find module './callTracker' imported from '…/src/modules/queue/tv/callTracker.test.ts'`.

- [ ] **Step 7: Implement the call tracker**

Freshness is measured against `state.serverTime` (never the TV's own clock, which may be wrong). `Set` keeps insertion order, so the oldest key is dropped first when the cap is reached.

Create `apps/web/src/modules/queue/tv/callTracker.ts`:
```ts
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";

/** Keys remembered at most; a day of calls stays far below this (the screen also reloads nightly). */
const MAX_REMEMBERED_KEYS = 2000;

/**
 * Detects the calls to announce from successive polls of the TV endpoint.
 * - The first ingest only remembers keys: a freshly opened screen never replays old calls.
 * - A key is announced once. A re-call bumps callCount, so it arrives with a new key and is announced again.
 * - A call older than `freshMs` by the server clock (`serverTime`) is remembered but not announced
 *   (e.g. the screen was offline for a while).
 * - The result is ordered by calledAt ascending (the order of the overlay queue).
 */
export function createCallTracker(freshMs = 120_000): { ingest(state: QueueDisplayState): QueueDisplayCall[] } {
  const seen = new Set<string>();
  let primed = false;

  const remember = (key: string) => {
    seen.add(key);
    if (seen.size > MAX_REMEMBERED_KEYS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  return {
    ingest(state) {
      const serverMs = Date.parse(state.serverTime);
      const fresh: QueueDisplayCall[] = [];
      for (const call of state.recentCalls) {
        if (seen.has(call.key)) continue;
        remember(call.key);
        if (!primed) continue;
        const calledMs = Date.parse(call.calledAt);
        if (Number.isNaN(calledMs) || Number.isNaN(serverMs)) continue;
        if (serverMs - calledMs > freshMs) continue;
        fresh.push(call);
      }
      primed = true;
      return fresh.sort((a, b) => Date.parse(a.calledAt) - Date.parse(b.calledAt));
    },
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/callTracker.test.ts && npm run typecheck`
Expected: PASS (7 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 9: Write the failing label and layout tests**

Create `apps/web/src/modules/queue/tv/tvLabels.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TV_LABELS, tvLabel } from "./tvLabels";

describe("tvLabel", () => {
  it("shows one language or both, Uzbek first", () => {
    expect(tvLabel("invitation", "uz_ru")).toBe("Navbatdagi raqam / Приглашается");
    expect(tvLabel("startButton", "uz_ru")).toBe("Ekranni ishga tushirish / Запустить экран");
    expect(tvLabel("next", "ru")).toBe("Далее");
    expect(tvLabel("next", "uz")).toBe("Keyingi");
  });

  it("does not repeat a label that is the same in both languages", () => {
    expect(tvLabel("codePlaceholder", "uz_ru")).toBe("XXXXX-XXXXX");
  });

  it("has a non-empty Uzbek and Russian text for every key", () => {
    expect(Object.keys(TV_LABELS).sort()).toEqual([
      "cabinet", "called", "codePlaceholder", "doctor", "enterCode", "free", "inactive", "invitation", "next",
      "noQueue", "noQueueYet", "notFound", "offline", "openScreen", "queueTitle", "recentCalls", "serving",
      "startButton", "startHint",
    ]);
    for (const [key, label] of Object.entries(TV_LABELS)) {
      expect(label.uz.trim(), key).not.toBe("");
      expect(label.ru.trim(), key).not.toBe("");
    }
  });
});
```

Create `apps/web/src/modules/queue/tv/tvLayout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CABINETS_PER_PAGE, gridColumns, pageCabinets } from "./tvLayout";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("pageCabinets", () => {
  it("keeps up to nine cabinets on one page", () => {
    expect(CABINETS_PER_PAGE).toBe(9);
    expect(pageCabinets([], 0)).toEqual({ page: [], pageCount: 1 });
    expect(pageCabinets(range(9), 0)).toEqual({ page: range(9), pageCount: 1 });
    expect(pageCabinets(range(9), 5)).toEqual({ page: range(9), pageCount: 1 });
  });

  it("splits more cabinets into pages of nine and wraps the page index", () => {
    expect(pageCabinets(range(20), 0)).toEqual({ page: range(9), pageCount: 3 });
    expect(pageCabinets(range(20), 1).page).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(pageCabinets(range(20), 2).page).toEqual([19, 20]);
    expect(pageCabinets(range(20), 3).page).toEqual(range(9));
    expect(pageCabinets(range(20), -1).page).toEqual([19, 20]);
  });
});

describe("gridColumns", () => {
  it.each([
    [0, 1], [1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [12, 3],
  ])("%i cabinets → %i columns", (count, columns) => {
    expect(gridColumns(count)).toBe(columns);
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvLabels.test.ts src/modules/queue/tv/tvLayout.test.ts`
Expected: FAIL — both files with `Error: Cannot find module './tvLabels'` / `Cannot find module './tvLayout'`.

- [ ] **Step 11: Implement labels and layout**

Create `apps/web/src/modules/queue/tv/tvLabels.ts`:
```ts
import type { QueueDisplayLanguage } from "../api/queueTypes";

/**
 * TV strings are constants, not i18n keys: the screen shows Uzbek and Russian together whatever the staff UI
 * language is. Uzbek oʻ/gʻ are written with U+2018 (‘) here because every TV font has that glyph.
 */
export const TV_LABELS = {
  queueTitle: { uz: "Navbat", ru: "Очередь" },
  cabinet: { uz: "Xona", ru: "Кабинет" },
  doctor: { uz: "Shifokor", ru: "Врач" },
  serving: { uz: "Qabulda", ru: "На приёме" },
  called: { uz: "Chaqirildi", ru: "Вызван" },
  next: { uz: "Keyingi", ru: "Далее" },
  free: { uz: "Bo‘sh", ru: "Свободно" },
  noQueue: { uz: "Navbat yo‘q", ru: "Очереди нет" },
  noQueueYet: { uz: "Hozircha navbat yo‘q", ru: "Очереди пока нет" },
  recentCalls: { uz: "So‘nggi chaqiruvlar", ru: "Последние вызовы" },
  invitation: { uz: "Navbatdagi raqam", ru: "Приглашается" },
  startButton: { uz: "Ekranni ishga tushirish", ru: "Запустить экран" },
  startHint: {
    uz: "Ovoz va to‘liq ekran uchun pultdagi OK tugmasini bosing",
    ru: "Нажмите OK на пульте, чтобы включить звук и полный экран",
  },
  offline: { uz: "Aloqa yo‘q", ru: "Нет связи" },
  notFound: {
    uz: "Ekran o‘chirilgan. Administratordan yangi kod so‘rang.",
    ru: "Экран отключён. Попросите администратора выдать новый код.",
  },
  inactive: { uz: "Klinika obunasi faol emas.", ru: "Подписка клиники неактивна." },
  enterCode: { uz: "Ekran kodini kiriting", ru: "Введите код экрана" },
  openScreen: { uz: "Ekranni ochish", ru: "Открыть экран" },
  codePlaceholder: { uz: "XXXXX-XXXXX", ru: "XXXXX-XXXXX" },
} as const;

export type TvLabelKey = keyof typeof TV_LABELS;

/** "uz" → Uzbek, "ru" → Russian, "uz_ru" → "Uzbek / Russian" (a label that is identical in both is shown once). */
export function tvLabel(key: TvLabelKey, language: QueueDisplayLanguage): string {
  const label: { uz: string; ru: string } = TV_LABELS[key];
  if (language === "uz") return label.uz;
  if (language === "ru") return label.ru;
  return label.uz === label.ru ? label.ru : `${label.uz} / ${label.ru}`;
}
```

Create `apps/web/src/modules/queue/tv/tvLayout.ts`:
```ts
/** At most 9 cabinet cards fit a 16:9 screen at a readable size; more cabinets rotate through pages. */
export const CABINETS_PER_PAGE = 9;

/** Page `pageIndex` (any integer; wraps around) of `items`; pageCount is at least 1. */
export function pageCabinets<T>(items: T[], pageIndex: number): { page: T[]; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / CABINETS_PER_PAGE));
  const safeIndex = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
  const index = ((safeIndex % pageCount) + pageCount) % pageCount;
  const start = index * CABINETS_PER_PAGE;
  return { page: items.slice(start, start + CABINETS_PER_PAGE), pageCount };
}

/** Grid columns for `count` cards: 0–1 → 1, 2–4 → 2, 5 and more → 3. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvLabels.test.ts src/modules/queue/tv/tvLayout.test.ts && npm run typecheck`
Expected: PASS (3 + 13 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 13: Write the failing audio-trim and code-input tests**

Create `apps/web/src/modules/queue/tv/audioTrim.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { silenceBounds } from "./audioTrim";

describe("silenceBounds", () => {
  it("cuts leading and trailing samples below the threshold", () => {
    expect(silenceBounds(new Float32Array([0, 0.001, -0.002, 0.5, -0.4, 0.002, 0]))).toEqual([3, 5]);
  });

  it("treats negative peaks like positive ones and keeps quiet samples inside the speech", () => {
    expect(silenceBounds(new Float32Array([0, -0.2, 0, 0, 0.3, 0]))).toEqual([1, 5]);
  });

  it("returns [0, 0] for silence and for an empty buffer", () => {
    expect(silenceBounds(new Float32Array([0, 0.001, -0.001]))).toEqual([0, 0]);
    expect(silenceBounds(new Float32Array(0))).toEqual([0, 0]);
  });

  it("keeps a clip without silence whole and honours a custom threshold", () => {
    expect(silenceBounds(new Float32Array([0.5, 0.5]))).toEqual([0, 2]);
    expect(silenceBounds(new Float32Array([0.05, 0.2, 0.05]), 0.1)).toEqual([1, 2]);
  });
});
```

Create `apps/web/src/modules/queue/tv/codeInput.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatCodeForDisplay, normalizeCodeInput } from "./codeInput";

describe("normalizeCodeInput", () => {
  it("upper-cases, drops the dash, spaces and other characters, and caps at 10", () => {
    expect(normalizeCodeInput("k7m2q-9xr4p")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput(" K7M2Q 9XR4P ")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput("K7M2Q-9XR4P-EXTRA")).toBe("K7M2Q9XR4P");
    expect(normalizeCodeInput("кОд-12")).toBe("12");
    expect(normalizeCodeInput("")).toBe("");
  });
});

describe("formatCodeForDisplay", () => {
  it("inserts the dash after five characters", () => {
    expect(formatCodeForDisplay("K7M2Q9XR4P")).toBe("K7M2Q-9XR4P");
    expect(formatCodeForDisplay("K7M2Q9")).toBe("K7M2Q-9");
    expect(formatCodeForDisplay("K7M2Q")).toBe("K7M2Q");
    expect(formatCodeForDisplay("")).toBe("");
  });

  it("round-trips through normalizeCodeInput", () => {
    expect(normalizeCodeInput(formatCodeForDisplay("K7M2Q9XR4P"))).toBe("K7M2Q9XR4P");
  });
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/audioTrim.test.ts src/modules/queue/tv/codeInput.test.ts`
Expected: FAIL with `Cannot find module './audioTrim'` and `Cannot find module './codeInput'`.

- [ ] **Step 15: Implement audio trim and code input**

Create `apps/web/src/modules/queue/tv/audioTrim.ts`:
```ts
/**
 * [start, end) sample range left after cutting leading and trailing near-silence (|sample| < threshold;
 * 0.003 ≈ −50 dBFS). All-silent or empty input → [0, 0].
 * MP3 encoder padding and TTS edge silence would otherwise leave audible gaps between concatenated clips.
 */
export function silenceBounds(samples: Float32Array, threshold = 0.003): [number, number] {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1;
  if (start === samples.length) return [0, 0];
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
  return [start, end];
}
```

Create `apps/web/src/modules/queue/tv/codeInput.ts`:
```ts
/** Screen code as typed on a TV remote → canonical form: upper case, only [0-9A-Z], at most 10 characters. */
export function normalizeCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 10);
}

/** "K7M2Q9XR4P" → "K7M2Q-9XR4P"; a partial code gets the dash once it is longer than 5 characters. */
export function formatCodeForDisplay(canonical: string): string {
  return canonical.length > 5 ? `${canonical.slice(0, 5)}-${canonical.slice(5)}` : canonical;
}
```

- [ ] **Step 16: Run the Task 11 tests, the whole web suite, typecheck and the i18n guard**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/`
Expected: PASS (6 files, 54 tests).

Run: `cd apps/web && npm test && npm run typecheck && npm run check-i18n`
Expected: PASS — 32 test files, 185 tests, 0 failures; `tsc --noEmit` prints nothing; `[i18n] OK: 1811 keys, full ru/uz parity, all code references resolve.` (no locale file changes in this task).

- [ ] **Step 17: Commit**

```bash
git add apps/web/src/modules/queue/tv/voiceClips.json apps/web/src/modules/queue/tv/voicePhrases.ts apps/web/src/modules/queue/tv/voicePhrases.test.ts apps/web/src/modules/queue/tv/callTracker.ts apps/web/src/modules/queue/tv/callTracker.test.ts apps/web/src/modules/queue/tv/tvLabels.ts apps/web/src/modules/queue/tv/tvLabels.test.ts apps/web/src/modules/queue/tv/tvLayout.ts apps/web/src/modules/queue/tv/tvLayout.test.ts apps/web/src/modules/queue/tv/audioTrim.ts apps/web/src/modules/queue/tv/audioTrim.test.ts apps/web/src/modules/queue/tv/codeInput.ts apps/web/src/modules/queue/tv/codeInput.test.ts && git commit -m "feat(web): TV queue logic - voice clip catalogue, phrases, call tracker, labels, layout"
```

---

### Task 12: TV screen page (`/tv`, `/tv/:code`)

**Files:**
- Modify: `apps/web/src/App.tsx` (whole file, 11 lines)
- Modify: `apps/web/vite.config.ts` (add `build.target` after `server`, lines 15–17)
- Create: `apps/web/src/modules/queue/tv/tvPath.ts`
- Create: `apps/web/src/modules/queue/tv/tvTime.ts`
- Create: `apps/web/src/modules/queue/tv/useQueueDisplay.ts`
- Create: `apps/web/src/modules/queue/tv/announcer.ts`
- Create: `apps/web/src/modules/queue/tv/tvDevice.ts`
- Create: `apps/web/src/modules/queue/tv/TvLaunchPage.tsx`
- Create: `apps/web/src/modules/queue/tv/TvDisplayPage.tsx`
- Create: `apps/web/src/modules/queue/tv/TvApp.tsx`
- Create: `apps/web/src/modules/queue/tv/tv.css`
- Test: `apps/web/src/modules/queue/tv/tvPath.test.ts`
- Test: `apps/web/src/modules/queue/tv/tvTime.test.ts`
- Test: `apps/web/src/modules/queue/tv/useQueueDisplay.test.tsx`
- Test: `apps/web/src/modules/queue/tv/announcer.test.ts`
- Test: `apps/web/src/modules/queue/tv/TvLaunchPage.test.tsx`
- Test: `apps/web/src/modules/queue/tv/TvDisplayPage.test.tsx`

**Interfaces:**
- Consumes:
  - Task 6 `apps/web/src/modules/queue/api/publicQueueApi.ts`: `fetchQueueDisplayState(code: string, signal?: AbortSignal): Promise<QueueDisplayState>`, `class QueueDisplayError extends Error { readonly kind: "not_found" | "inactive" | "network" }` (an aborted request rejects with the original `AbortError`, not a `QueueDisplayError`).
  - Task 6 `apps/web/src/modules/queue/api/queueTypes.ts`: `QueueDisplayState`, `QueueDisplayCabinet`, `QueueDisplayCall`, `QueueDisplayLanguage`.
  - Task 11: `voiceClips.json` (every clip id per language, for the preload); `announcementClipIds`, `voiceLangs`, `gapBeforeClipMs`, `type VoiceLang` (voicePhrases.ts); `createCallTracker` (callTracker.ts); `TV_LABELS`, `tvLabel` (tvLabels.ts); `CABINETS_PER_PAGE`, `pageCabinets`, `gridColumns` (tvLayout.ts); `silenceBounds` (audioTrim.ts); `normalizeCodeInput`, `formatCodeForDisplay` (codeInput.ts).
- Produces:
  - Routes `/tv` (code entry) and `/tv/:code` (screen; the code may contain the dash, e.g. `/tv/K7M2Q-9XR4P`, as linked by the displays panel `DisplaysPanel.tsx`) rendered by `App.tsx` outside `AuthProvider`.
  - `TvApp` (named export, TvApp.tsx), `TvLaunchPage`, `TvDisplayPage` (named exports), `isTvPath(pathname: string): boolean` (tvPath.ts).
  - `useQueueDisplay(code: string): { state: QueueDisplayState | null; error: "not_found" | "inactive" | null; offline: boolean }` plus `backoffDelayMs(failures: number): number` and constants `POLL_INTERVAL_MS = 2000`, `OFFLINE_AFTER_FAILURES = 3`, `REQUEST_TIMEOUT_MS = 8000`, `INACTIVE_RETRY_MS = 30000`, `NOT_FOUND_RETRY_MS = 60000` (useQueueDisplay.ts).
  - `createAnnouncer(baseUrl = "/queue-voice"): Announcer` with `type Announcer = { unlock(): Promise<boolean>; isUnlocked(): boolean; announce(clipGroups: string[][], langs: VoiceLang[]): Promise<void>; preload(langs: VoiceLang[]): Promise<void> }` (announcer.ts).
  - `apps/web/vite.config.ts`: `build.target = ["es2020", "chrome87", "edge88", "firefox78", "safari14"]` (the whole web build, because the TV also loads the main entry chunk). Voice files are read from `/queue-voice/<lang>/<id>.mp3`, i.e. `apps/web/public/queue-voice/{uz,ru}/<id>.mp3` written by Task 13; until they exist the screen plays the chime only.
  - `formatClock(ms, timeZone)`, `formatDay(ms, timeZone)`, `msUntilDailyReload(ms, timeZone, hour = 4)` (tvTime.ts); `STARTED_FLAG_KEY = "qtv:started"`, `readStartedFlag()`, `writeStartedFlag()`, `requestFullscreen()`, `requestWakeLock()`, `type WakeLockHandle` (tvDevice.ts).

Gotchas for this task:
- **Why an App.tsx switch and not a route in AppRouter:** `AuthProvider` calls `/api/auth/me` with any stored staff token and `requestJson` hard-redirects to `/login` on 401; `AppRouter` also has `GuestRoute`s and a catch-all `*` → `/`. A TV must never be redirected, so `App.tsx` checks the pathname with `useLocation()` (App already sits inside `BrowserRouter` in `main.tsx`) and renders a lazy `TvApp` instead of `AuthProvider + AppRouter`. `TvApp` has its own `<Routes>` with absolute paths. Lazy loading keeps the TV code and CSS in a separate chunk (`dist/assets/TvApp-*.js/css`).
- **TV browsers:** only `tv.css` styles the TV (plain CSS, `qtv-` prefix, hex/rgba, vw/vh/clamp/em). Tailwind classes would be ignored on Chromium < 111 TVs (`@layer`/`oklch`). Without `build.target` (Step 28) the build rewrites `top/right/bottom/left: 0` into `inset: 0`; with it esbuild keeps the four longhands (both work on Chrome 87+). Browser features are feature-detected in `tvDevice.ts`/`announcer.ts` (Wake Lock, `webkitRequestFullscreen`, `webkitAudioContext`, `AbortController`).
- **Autoplay:** `AudioContext.resume()` and `requestFullscreen()` only work synchronously inside a click/keydown handler; the start button calls fullscreen first, then `unlock()` (which calls `resume()` before its first `await`). Without a gesture Chrome keeps the `resume()` promise **pending forever**, so `unlock()` races it against a 400 ms timer. After a reload (e.g. the 04:00 one) the page tries `unlock()` silently when `localStorage["qtv:started"] === "1"` and hides the start button only if audio really runs.
- `decodeAudioData` detaches the `ArrayBuffer` it receives → always pass `bytes.slice(0)`. A missing mp3 on Vercel/Vite answers **200 with index.html** (SPA fallback), so "missing" is detected by the decode failure, not by the status code; failed clips are not cached, so they are retried on the next call.
- **Voice preload:** once the screen is started (audio unlocked) and the display has voice on, `announcer.preload(voiceLangs(language))` downloads, decodes and trims all 69 clips (39 ru, 30 uz) one at a time in the background, again when the display language changes. It shares the clip cache with `announce()`, which never waits for it: a call fetches whatever it still needs itself.
- **Unknown screen code (404):** the TV shows «Экран отключён» but keeps checking every 60 s (`NOT_FOUND_RETRY_MS`) and clears the message on the first success, because a transient 404 (API deployed after the web, a rollback) must not blank the hall screen until the 04:00 reload.
- **Build target:** the TV loads the main entry chunk too (`App.tsx` statically imports `AppRouter`, `AuthProvider`, `i18n`). Vite 7's default target is `baseline-widely-available` (chrome107), so the build sets `build.target` to Chromium 87-compatible syntax; Step 29 greps the built JS for class static blocks (Chrome 94) and `#x in obj` checks (Chrome 91).
- Polling uses `fetchQueueDisplayState` (bare `fetch`, no auth header, `cache: "no-store"`), never `requestJson`. A request hanging for 8 s is aborted and counted as a failure, otherwise one stalled request would stop polling forever.
- The nightly reload is skipped while `offline` (a reload without network would leave the TV on the browser's error page); it retries every 5 minutes.
- Tests: vitest runs in node without DOM. Timer functions in `vi.stubGlobal("window", …)` must **delegate lazily** (`setTimeout: (h, ms) => setTimeout(h, ms)`), otherwise a later `vi.useFakeTimers()` is bypassed because the stub captured the real function. `vi.stubGlobal("navigator", …)` works on Node 24 even though Node defines a global `navigator`. In react-test-renderer `autoFocus` is only a prop (nothing is focused), so tests assert the prop.

- [ ] **Step 1: Write the failing path test**

Create `apps/web/src/modules/queue/tv/tvPath.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isTvPath } from "./tvPath";

describe("isTvPath", () => {
  it("matches the TV launch and display routes", () => {
    expect(isTvPath("/tv")).toBe(true);
    expect(isTvPath("/tv/")).toBe(true);
    expect(isTvPath("/tv/K7M2Q-9XR4P")).toBe(true);
    expect(isTvPath("/TV/K7M2Q9XR4P")).toBe(true);
  });

  it("leaves every staff route to the staff app", () => {
    expect(isTvPath("/")).toBe(false);
    expect(isTvPath("/tvx")).toBe(false);
    expect(isTvPath("/queue")).toBe(false);
    expect(isTvPath("/login")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvPath.test.ts`
Expected: FAIL with `Error: Cannot find module './tvPath' imported from '…/src/modules/queue/tv/tvPath.test.ts'`.

- [ ] **Step 3: Implement the path check**

Create `apps/web/src/modules/queue/tv/tvPath.ts`:
```ts
/** True for the public TV routes (/tv, /tv/<code>), which render outside AuthProvider and the staff router. */
export function isTvPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path === "/tv" || path.startsWith("/tv/");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvPath.test.ts && npm run typecheck`
Expected: PASS (2 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 5: Write the failing clock/reload-time test**

Create `apps/web/src/modules/queue/tv/tvTime.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatClock, formatDay, msUntilDailyReload } from "./tvTime";

const at = (iso: string) => Date.parse(iso);

describe("TV clock", () => {
  it("shows the clinic wall clock, not the device clock", () => {
    expect(formatClock(at("2026-09-30T06:00:00Z"), "Asia/Tashkent")).toBe("11:00");
    expect(formatClock(at("2026-09-30T19:05:59Z"), "Asia/Tashkent")).toBe("00:05");
    expect(formatDay(at("2026-09-30T19:05:59Z"), "Asia/Tashkent")).toBe("01.10.2026");
  });

  it("falls back to the device zone for an unknown zone name instead of throwing", () => {
    expect(formatClock(at("2026-09-30T06:00:00Z"), "Not/AZone")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("msUntilDailyReload", () => {
  it("waits until the next 04:00 in the clinic zone", () => {
    // 11:00 in Tashkent → 17 hours until 04:00 tomorrow
    expect(msUntilDailyReload(at("2026-09-30T06:00:00Z"), "Asia/Tashkent")).toBe(17 * 3600 * 1000);
    // 03:30 in Tashkent → 30 minutes
    expect(msUntilDailyReload(at("2026-09-29T22:30:00Z"), "Asia/Tashkent")).toBe(30 * 60 * 1000);
  });

  it("schedules the next day right after a reload at 04:00 and never returns less than a minute", () => {
    expect(msUntilDailyReload(at("2026-09-29T23:00:00Z"), "Asia/Tashkent")).toBe(24 * 3600 * 1000);
    expect(msUntilDailyReload(at("2026-09-29T22:59:30Z"), "Asia/Tashkent")).toBe(60_000);
  });

  it("subtracts the milliseconds of the current second", () => {
    expect(msUntilDailyReload(at("2026-09-30T06:00:00.250Z"), "Asia/Tashkent")).toBe(17 * 3600 * 1000 - 250);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvTime.test.ts`
Expected: FAIL with `Error: Cannot find module './tvTime' imported from '…/src/modules/queue/tv/tvTime.test.ts'`.

- [ ] **Step 7: Implement the clinic-time helpers**

`serverTime` and `calledAt` are real instants; the clock is shown in `state.timeZone` (Asia/Tashkent), never in the TV's zone. `formatToParts` + `hourCycle: "h23"` work on Chrome 73+.

Create `apps/web/src/modules/queue/tv/tvTime.ts`:
```ts
type WallClock = { year: string; month: string; day: string; hour: number; minute: number; second: number };

/** Wall clock of the instant `ms` in `timeZone` (falls back to the device zone if the name is unknown). */
function wallClock(ms: number, timeZone: string): WallClock {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).formatToParts(new Date(ms));
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(new Date(ms));
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "0";
  return {
    year: part("year"), month: part("month"), day: part("day"),
    // Some engines print midnight as "24" even with h23.
    hour: Number(part("hour")) % 24, minute: Number(part("minute")), second: Number(part("second")),
  };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** "HH:MM" of the instant in the clinic time zone. */
export function formatClock(ms: number, timeZone: string): string {
  const clock = wallClock(ms, timeZone);
  return `${pad2(clock.hour)}:${pad2(clock.minute)}`;
}

/** "DD.MM.YYYY" of the instant in the clinic time zone. */
export function formatDay(ms: number, timeZone: string): string {
  const clock = wallClock(ms, timeZone);
  return `${clock.day}.${clock.month}.${clock.year}`;
}

/**
 * Milliseconds from `ms` until the next `hour`:00 wall-clock time in `timeZone` (the nightly reload that picks up a
 * new app version and frees memory). Never less than one minute, so a reload right at 04:00 cannot loop.
 */
export function msUntilDailyReload(ms: number, timeZone: string, hour = 4): number {
  const clock = wallClock(ms, timeZone);
  const sinceMidnight = clock.hour * 3600 + clock.minute * 60 + clock.second;
  let seconds = hour * 3600 - sinceMidnight;
  if (seconds <= 0) seconds += 24 * 3600;
  return Math.max(60_000, seconds * 1000 - (ms % 1000));
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/tvTime.test.ts && npm run typecheck`
Expected: PASS (5 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 9: Write the failing polling-hook test**

The hook is rendered through a tiny `Probe` component. `vi.mock` keeps the real `QueueDisplayError` class (via `importOriginal`) and replaces only `fetchQueueDisplayState`.

Create `apps/web/src/modules/queue/tv/useQueueDisplay.test.tsx`:
```tsx
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplayState } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({ fetchState: vi.fn() }));
vi.mock("../api/publicQueueApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/publicQueueApi")>()),
  fetchQueueDisplayState: mocks.fetchState,
}));

import { QueueDisplayError } from "../api/publicQueueApi";
import { backoffDelayMs, useQueueDisplay } from "./useQueueDisplay";

const sample = (clinicName: string): QueueDisplayState => ({
  serverTime: "2026-09-30T06:00:00.000Z",
  timeZone: "Asia/Tashkent",
  clinicName,
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls: [],
});

let latest: ReturnType<typeof useQueueDisplay>;
function Probe({ code }: { code: string }) {
  latest = useQueueDisplay(code);
  return null;
}

let view: ReactTestRenderer | undefined;
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const mount = async () => {
  await act(async () => {
    view = create(<Probe code="K7M2Q9XR4P" />);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchState.mockReset();
  // Delegate lazily so the fake timers installed above are used.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
  });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("backoffDelayMs", () => {
  it("doubles from 2 s up to a 10 s cap", () => {
    expect([1, 2, 3, 4, 5, 20].map(backoffDelayMs)).toEqual([2000, 4000, 8000, 10000, 10000, 10000]);
  });
});

describe("useQueueDisplay", () => {
  it("polls every 2 seconds with the code and exposes the latest state", async () => {
    mocks.fetchState.mockResolvedValueOnce(sample("A")).mockResolvedValue(sample("B"));
    await mount();
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    expect(mocks.fetchState.mock.calls[0][0]).toBe("K7M2Q9XR4P");
    expect(latest.state?.clinicName).toBe("A");
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.state?.clinicName).toBe("B");
    expect(latest).toMatchObject({ error: null, offline: false });
  });

  it("keeps the last state, backs off 2 → 4 → 8 s and goes offline after three failures", async () => {
    mocks.fetchState
      .mockResolvedValueOnce(sample("A"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockResolvedValue(sample("C"));
    await mount();
    await advance(2000); // failure 1
    expect(latest.offline).toBe(false);
    await advance(2000); // failure 2 (after 2 s)
    expect(mocks.fetchState).toHaveBeenCalledTimes(3);
    await advance(3999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(3); // waiting 4 s
    await advance(1); // failure 3
    expect(latest.offline).toBe(true);
    expect(latest.state?.clinicName).toBe("A");
    await advance(8000); // success
    expect(latest.offline).toBe(false);
    expect(latest.state?.clinicName).toBe("C");
  });

  it("reports an unknown screen code, re-checks it every 60 s and recovers from a transient 404", async () => {
    mocks.fetchState
      .mockRejectedValueOnce(new QueueDisplayError("not_found", "gone"))
      .mockRejectedValueOnce(new QueueDisplayError("not_found", "gone"))
      .mockResolvedValue(sample("A"));
    await mount();
    expect(latest.error).toBe("not_found");
    await advance(59_999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(1); // no 2-second polling for a missing screen
    await advance(1);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.error).toBe("not_found");
    await advance(60_000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(3);
    expect(latest.error).toBeNull();
    expect(latest.state?.clinicName).toBe("A");
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(4); // back to the normal 2 s polling
  });

  it("reports an inactive subscription and keeps checking slowly", async () => {
    mocks.fetchState.mockRejectedValueOnce(new QueueDisplayError("inactive", "paused")).mockResolvedValue(sample("A"));
    await mount();
    expect(latest.error).toBe("inactive");
    await advance(29_999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(latest.error).toBeNull();
    expect(latest.state?.clinicName).toBe("A");
  });

  it("treats a request that hangs for 8 s as a failure", async () => {
    mocks.fetchState.mockImplementationOnce(
      (_code: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    mocks.fetchState.mockResolvedValue(sample("A"));
    await mount();
    await advance(8000); // timeout → failure 1 → retry in 2 s
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.state?.clinicName).toBe("A");
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/useQueueDisplay.test.tsx`
Expected: FAIL with `Error: Cannot find module './useQueueDisplay' imported from '…/src/modules/queue/tv/useQueueDisplay.test.tsx'`.

- [ ] **Step 11: Implement the polling hook**

Create `apps/web/src/modules/queue/tv/useQueueDisplay.ts`:
```ts
import React from "react";
import { QueueDisplayError, fetchQueueDisplayState } from "../api/publicQueueApi";
import type { QueueDisplayState } from "../api/queueTypes";

export const POLL_INTERVAL_MS = 2000;
export const OFFLINE_AFTER_FAILURES = 3;
/** A request hanging longer than this counts as a failure (a stalled TV connection must not stop polling). */
export const REQUEST_TIMEOUT_MS = 8000;
/** Inactive subscription: keep checking, slowly, so the screen recovers by itself once the clinic pays. */
export const INACTIVE_RETRY_MS = 30_000;
/**
 * Unknown or deleted screen: show «Экран отключён» but check again once a minute. A transient 404 (the web deployed
 * before the API, a rollback) must not blank the hall screen until the 04:00 reload.
 */
export const NOT_FOUND_RETRY_MS = 60_000;

/** Delay before the next poll after `failures` consecutive failures: 2 → 4 → 8 → 10 s (cap). */
export function backoffDelayMs(failures: number): number {
  return Math.min(10_000, POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1));
}

export type QueueDisplayErrorState = "not_found" | "inactive" | null;

/**
 * Polls the public TV endpoint. Keeps the last good state through failures; `offline` turns on after 3 consecutive
 * failures and off with the next success. `not_found` (unknown or deleted screen) is retried every 60 s and
 * `inactive` every 30 s; the next success clears either error.
 */
export function useQueueDisplay(code: string): { state: QueueDisplayState | null; error: QueueDisplayErrorState; offline: boolean } {
  const [state, setState] = React.useState<QueueDisplayState | null>(null);
  const [error, setError] = React.useState<QueueDisplayErrorState>(null);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let failures = 0;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    setState(null);
    setError(null);
    setOffline(false);

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      controller = typeof AbortController === "function" ? new AbortController() : null;
      const current = controller;
      const timeout = window.setTimeout(() => current?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const next = await fetchQueueDisplayState(code, current?.signal);
        if (cancelled) return;
        failures = 0;
        setState(next);
        setError(null);
        setOffline(false);
        schedule(POLL_INTERVAL_MS);
      } catch (failure) {
        if (cancelled) return;
        if (failure instanceof QueueDisplayError && failure.kind === "not_found") {
          failures = 0;
          setError("not_found");
          setOffline(false);
          schedule(NOT_FOUND_RETRY_MS);
          return;
        }
        if (failure instanceof QueueDisplayError && failure.kind === "inactive") {
          failures = 0;
          setError("inactive");
          setOffline(false);
          schedule(INACTIVE_RETRY_MS);
          return;
        }
        // Network error, 5xx, timeout (AbortError from our own timer), bad JSON.
        failures += 1;
        if (failures >= OFFLINE_AFTER_FAILURES) setOffline(true);
        schedule(backoffDelayMs(failures));
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [code]);

  return { state, error, offline };
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/useQueueDisplay.test.tsx && npm run typecheck`
Expected: PASS (6 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 13: Write the failing announcer test**

The test drives the announcer with a small fake of the Web Audio API: a fake "mp3" is raw float32 samples at 1000 Hz, so the scheduled start times of every clip can be asserted exactly (chime 0.05 s + 0.35 s + 0.9 s, 0.25 s pause, 0.43 s trimmed clips, 60 ms between words, 300 ms before a new sentence, 700 ms between languages). The preload tests count downloads against the real `voiceClips.json` (39 ru and 30 uz ids).

Create `apps/web/src/modules/queue/tv/announcer.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnouncer } from "./announcer";
import voiceClips from "./voiceClips.json";

/**
 * Minimal fake of the Web Audio API. A fake "mp3" is raw float32 samples at 1000 Hz, so a clip of
 * 100 silent + 400 loud + 100 silent samples decodes to 0.6 s and is trimmed to 400 + 2 × 15 padding = 0.43 s.
 */
const SAMPLE_RATE = 1000;
type Scheduled = { kind: "tone" | "clip"; at: number; frequency?: number; duration?: number };
let scheduled: Scheduled[];
let resumeBehaviour: "resolve" | "hang";

class FakeBuffer {
  private readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class FakeParam {
  readonly values: number[] = [];
  setValueAtTime(value: number) { this.values.push(value); return this; }
  linearRampToValueAtTime(value: number) { this.values.push(value); return this; }
  exponentialRampToValueAtTime(value: number) { this.values.push(value); return this; }
}

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  sampleRate = SAMPLE_RATE;
  destination = {};
  resume = vi.fn(() => {
    if (resumeBehaviour === "hang") return new Promise<void>(() => undefined);
    this.state = "running";
    return Promise.resolve();
  });
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: new FakeParam(),
      connect: () => undefined,
      stop: () => undefined,
      start: (at: number) => { scheduled.push({ kind: "tone", at, frequency: oscillator.frequency.values[0] }); },
    };
    return oscillator;
  }
  createGain() {
    return { gain: new FakeParam(), connect: () => undefined };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const source = {
      buffer: null as FakeBuffer | null,
      connect: () => undefined,
      start: (at: number) => {
        // The 1-sample unlock buffer is not a clip.
        if (source.buffer && source.buffer.length > 1) scheduled.push({ kind: "clip", at, duration: source.buffer.duration });
      },
    };
    return source;
  }
  decodeAudioData(bytes: ArrayBuffer, ok: (buffer: FakeBuffer) => void, fail: (error: Error) => void) {
    // Like a real decoder, refuse anything that is not audio (here: HTML served by the SPA fallback).
    if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0 || new Uint8Array(bytes)[0] === 0x3c) {
      fail(new Error("EncodingError"));
      return undefined;
    }
    const samples = new Float32Array(bytes);
    const buffer = new FakeBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    ok(buffer);
    return undefined;
  }
}

const clipBytes = (): ArrayBuffer => {
  const samples = new Float32Array(600);
  samples.fill(0.5, 100, 500);
  return samples.buffer;
};

let missing: Set<string>;
let htmlFallback: Set<string>;
const fetchMock = vi.fn(async (url: string) => {
  if (missing.has(url)) return new Response("not found", { status: 404 });
  if (htmlFallback.has(url)) return new Response("<!doctype html><html></html>", { status: 200 });
  return new Response(clipBytes(), { status: 200 });
});

beforeEach(() => {
  vi.useFakeTimers();
  scheduled = [];
  resumeBehaviour = "resolve";
  missing = new Set();
  htmlFallback = new Set();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // Delegate lazily so the fake timers installed above are the ones used.
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const UZ = ["navbat_raqami", "20", "7", "xona_raqami", "5"];
const RU = ["nomer", "20", "7", "proydite_v_kabinet_nomer", "5"];

async function announce(announcer: ReturnType<typeof createAnnouncer>, groups: string[][], langs: Array<"uz" | "ru">) {
  const done = announcer.announce(groups, langs);
  await vi.advanceTimersByTimeAsync(20_000);
  await done;
}

describe("createAnnouncer", () => {
  it("unlocks by resuming the audio context", async () => {
    const announcer = createAnnouncer();
    expect(announcer.isUnlocked()).toBe(false);
    await expect(announcer.unlock()).resolves.toBe(true);
    expect(announcer.isUnlocked()).toBe(true);
  });

  it("gives up after a short wait when resume() never settles (no user gesture)", async () => {
    resumeBehaviour = "hang";
    const announcer = createAnnouncer();
    const result = announcer.unlock();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(false);
    expect(announcer.isUnlocked()).toBe(false);
  });

  it("reports failure and stays silent without Web Audio", async () => {
    vi.stubGlobal("window", { setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms) });
    const announcer = createAnnouncer();
    await expect(announcer.unlock()).resolves.toBe(false);
    await announce(announcer, [UZ], ["uz"]);
    await announcer.preload(["uz", "ru"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plays the ding-dong, then the Uzbek phrase, then the Russian phrase back to back", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [UZ, RU], ["uz", "ru"]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      ...UZ.map((id) => `/queue-voice/uz/${id}.mp3`),
      ...RU.map((id) => `/queue-voice/ru/${id}.mp3`),
    ]);
    const tones = scheduled.filter((item) => item.kind === "tone");
    expect(tones.map((tone) => tone.frequency)).toEqual([659.25, 523.25]);
    expect(tones[0].at).toBeCloseTo(0.05);
    expect(tones[1].at).toBeCloseTo(0.4);

    const starts = scheduled.filter((item) => item.kind === "clip").map((item) => item.at);
    expect(starts).toHaveLength(10);
    // chime ends at 0.05 + 0.35 + 0.9 = 1.3 s, speech starts 0.25 s later; trimmed clips last 0.43 s
    const expected = [1.55, 2.04, 2.53, 3.26, 3.75, 4.88, 5.37, 5.86, 6.59, 7.08];
    starts.forEach((at, index) => expect(at).toBeCloseTo(expected[index], 5));
  });

  it("skips the speech of a language with a missing clip and keeps the other language", async () => {
    missing.add("/queue-voice/ru/proydite_v_kabinet_nomer.mp3");
    htmlFallback.add("/queue-voice/uz/xona_raqami.mp3");
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [UZ, RU], ["uz", "ru"]);
    expect(scheduled.filter((item) => item.kind === "tone")).toHaveLength(2);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(0);

    htmlFallback.clear();
    scheduled = [];
    await announce(announcer, [UZ, RU], ["uz", "ru"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("plays only the chime for an empty phrase (number above 999)", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    await announce(announcer, [[], []], ["uz", "ru"]);
    expect(scheduled.map((item) => item.kind)).toEqual(["tone", "tone"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads each clip once and reuses the decoded audio", async () => {
    const announcer = createAnnouncer("/voice");
    await announcer.unlock();
    await announce(announcer, [RU], ["ru"]);
    await announce(announcer, [RU], ["ru"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][0]).toBe("/voice/ru/nomer.mp3");
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(10);
  });

  it("preloads every clip of the display languages, one by one, and announcements reuse them", async () => {
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["ru"]);
    await vi.advanceTimersByTimeAsync(1000);
    await preloading;
    const ruIds = Object.keys(voiceClips.ru);
    expect(ruIds).toHaveLength(39);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(ruIds.map((id) => `/queue-voice/ru/${id}.mp3`));
    await announce(announcer, [RU], ["ru"]);
    expect(fetchMock).toHaveBeenCalledTimes(39); // nothing downloaded again
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("ignores clips that fail to preload and fetches them again for the announcement", async () => {
    missing.add("/queue-voice/uz/navbat_raqami.mp3");
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["uz"]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(preloading).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(30);
    missing.clear();
    await announce(announcer, [UZ], ["uz"]);
    expect(fetchMock.mock.calls.slice(30).map(([url]) => url)).toEqual(["/queue-voice/uz/navbat_raqami.mp3"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
  });

  it("never makes an announcement wait for the background preload", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The preload's first download ("1") hangs until released.
    fetchMock.mockImplementationOnce(async () => {
      await held;
      return new Response(clipBytes(), { status: 200 });
    });
    const announcer = createAnnouncer();
    await announcer.unlock();
    const preloading = announcer.preload(["ru"]);
    await announce(announcer, [RU], ["ru"]);
    expect(scheduled.filter((item) => item.kind === "clip")).toHaveLength(5);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await preloading;
    expect(fetchMock).toHaveBeenCalledTimes(39); // the announced clips were not downloaded twice
  });
});
```

- [ ] **Step 14: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/announcer.test.ts`
Expected: FAIL with `Error: Cannot find module './announcer' imported from '…/src/modules/queue/tv/announcer.test.ts'`.

- [ ] **Step 15: Implement the announcer**

`isRunning()` is a separate function on purpose: after `if (audio.state === "running") return true;` TypeScript narrows `audio.state`, and a second direct comparison after the `await` would not compile.

Create `apps/web/src/modules/queue/tv/announcer.ts`:
```ts
import { silenceBounds } from "./audioTrim";
import voiceClips from "./voiceClips.json";
import { gapBeforeClipMs, type VoiceLang } from "./voicePhrases";

export type Announcer = {
  /** Call from a click/keydown handler (autoplay policy). Resolves true when audio can play. */
  unlock(): Promise<boolean>;
  isUnlocked(): boolean;
  /** Chime, then clipGroups[i] spoken in langs[i]; resolves when playback has ended. Never rejects on missing clips. */
  announce(clipGroups: string[][], langs: VoiceLang[]): Promise<void>;
  /**
   * Downloads, decodes and trims every clip of `langs` in the background, one at a time; failures are ignored (and
   * retried by the next announcement). Never rejects. Announcements never wait for it: they fetch what they need.
   */
  preload(langs: VoiceLang[]): Promise<void>;
};

type AudioContextConstructor = new () => AudioContext;

/** Every clip id per language (the texts Task 13 voices); the JSON's literal keys are widened for indexing. */
const CLIP_IDS: Record<VoiceLang, string[]> = {
  uz: Object.keys((voiceClips as Record<VoiceLang, Record<string, string>>).uz),
  ru: Object.keys((voiceClips as Record<VoiceLang, Record<string, string>>).ru),
};

const CHIME_TONES_HZ = [659.25, 523.25]; // E5 then C5: "ding-dong"
const CHIME_STEP_S = 0.35;
const CHIME_TONE_S = 0.9;
const START_DELAY_S = 0.05;
const AFTER_CHIME_S = 0.25;
const LANGUAGE_GAP_S = 0.7;
const TRIM_PAD_S = 0.015;
const RESUME_WAIT_MS = 400;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function isRunning(audio: AudioContext): boolean {
  return audio.state === "running";
}

function decodeAudio(audio: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // The callback form works on every engine; newer engines also return a promise, which is caught so that
    // an undecodable file never surfaces as an unhandled rejection.
    const maybePromise = audio.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(reject);
  });
}

function trimSilence(audio: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const [start, end] = silenceBounds(buffer.getChannelData(0));
  if (end <= start) return buffer;
  const pad = Math.round(buffer.sampleRate * TRIM_PAD_S);
  const from = Math.max(0, start - pad);
  const to = Math.min(buffer.length, end + pad);
  if (from === 0 && to === buffer.length) return buffer;
  const trimmed = audio.createBuffer(buffer.numberOfChannels, to - from, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed.getChannelData(channel).set(buffer.getChannelData(channel).subarray(from, to));
  }
  return trimmed;
}

function playSilence(audio: AudioContext): void {
  // Starting a 1-sample silent buffer inside the user gesture fully unlocks older WebKit-based TV engines.
  const source = audio.createBufferSource();
  source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
  source.connect(audio.destination);
  source.start(0);
}

/** Schedules the synthesized chime at `at` (context time) and returns the time it ends. */
function scheduleChime(audio: AudioContext, at: number): number {
  CHIME_TONES_HZ.forEach((frequency, index) => {
    const start = at + index * CHIME_STEP_S;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
    // An exponential ramp cannot reach 0: fade to 0.001 (about −60 dB) instead.
    gain.gain.exponentialRampToValueAtTime(0.001, start + CHIME_TONE_S);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + CHIME_TONE_S + 0.05);
  });
  return at + (CHIME_TONES_HZ.length - 1) * CHIME_STEP_S + CHIME_TONE_S;
}

/**
 * Web Audio announcer: a synthesized chime plus pre-recorded clips `${baseUrl}/<lang>/<id>.mp3` played back to back
 * (60 ms between words, 300 ms before a new sentence, 700 ms between languages). Clips are fetched once, decoded,
 * trimmed of edge silence and cached; `preload()` warms that cache in the background. A language with any missing clip is
 * skipped, so without clips only the chime plays.
 */
export function createAnnouncer(baseUrl = "/queue-voice"): Announcer {
  let ctx: AudioContext | null = null;
  const clips = new Map<string, Promise<AudioBuffer | null>>();

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    if (typeof window === "undefined") return null;
    const w = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  const loadClip = (audio: AudioContext, lang: VoiceLang, id: string): Promise<AudioBuffer | null> => {
    const key = `${lang}/${id}`;
    const cached = clips.get(key);
    if (cached) return cached;
    const loading = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(`${baseUrl}/${lang}/${encodeURIComponent(id)}.mp3`);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        // decodeAudioData detaches (empties) the ArrayBuffer it receives: always hand it a copy.
        return trimSilence(audio, await decodeAudio(audio, bytes.slice(0)));
      } catch {
        // Network error, or a missing file: the SPA fallback answers with index.html, which fails to decode.
        return null;
      }
    })();
    clips.set(key, loading);
    void loading.then((buffer) => {
      if (!buffer) clips.delete(key); // retry on the next announcement
    });
    return loading;
  };

  const unlock = async (): Promise<boolean> => {
    const audio = context();
    if (!audio) return false;
    if (isRunning(audio)) return true;
    let resumed: Promise<void>;
    try {
      // Both calls must happen synchronously inside the click/keydown handler.
      resumed = Promise.resolve(audio.resume());
      playSilence(audio);
    } catch {
      return false;
    }
    // Without a user gesture Chrome keeps the resume() promise pending forever: never await it unbounded.
    await Promise.race([resumed.catch(() => undefined), wait(RESUME_WAIT_MS)]);
    return isRunning(audio);
  };

  const announce = async (clipGroups: string[][], langs: VoiceLang[]): Promise<void> => {
    const audio = ctx;
    if (!audio || !isRunning(audio)) return;
    // Start downloading the speech now, so it loads while the chime plays.
    const phrases = langs.map(async (lang, index) => {
      const ids = clipGroups[index] ?? [];
      if (ids.length === 0) return null;
      const buffers = await Promise.all(ids.map((id) => loadClip(audio, lang, id)));
      if (buffers.some((buffer) => buffer === null)) return null;
      return ids.map((id, k) => ({ id, buffer: buffers[k] as AudioBuffer }));
    });
    const chimeEnd = scheduleChime(audio, audio.currentTime + START_DELAY_S);
    const loaded = await Promise.all(phrases);
    let at = Math.max(chimeEnd + AFTER_CHIME_S, audio.currentTime + START_DELAY_S);
    let end = chimeEnd;
    let spokenBefore = false;
    for (const phrase of loaded) {
      if (!phrase) continue;
      if (spokenBefore) at += LANGUAGE_GAP_S;
      phrase.forEach(({ id, buffer }, k) => {
        if (k > 0) at += gapBeforeClipMs(id) / 1000;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        source.start(at);
        at += buffer.duration;
      });
      spokenBefore = true;
      end = at;
    }
    await wait((end - audio.currentTime) * 1000 + 50);
  };

  const preload = async (langs: VoiceLang[]): Promise<void> => {
    // Decoding also works on a context that is still suspended; without Web Audio there is nothing to prepare.
    const audio = context();
    if (!audio) return;
    for (const lang of langs) {
      for (const id of CLIP_IDS[lang] ?? []) {
        // One at a time, so a TV on a slow line keeps bandwidth for its 2-second polls. loadClip never rejects and
        // shares the cache with announce(), so a clip that is already loading is not downloaded twice.
        await loadClip(audio, lang, id);
      }
    }
  };

  return {
    unlock,
    isUnlocked: () => ctx !== null && isRunning(ctx),
    announce,
    preload,
  };
}
```

- [ ] **Step 16: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/announcer.test.ts && npm run typecheck`
Expected: PASS (10 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 17: Write the failing launch-page test**

Create `apps/web/src/modules/queue/tv/TvLaunchPage.test.tsx`:
```tsx
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

import { TvLaunchPage } from "./TvLaunchPage";

let view: ReactTestRenderer | undefined;
const input = () => view!.root.findByProps({ id: "qtv-code" });
const type = (value: string) => act(() => input().props.onChange({ target: { value } }));
const submit = () => {
  const preventDefault = vi.fn();
  act(() => view!.root.findByType("form").props.onSubmit({ preventDefault }));
  return preventDefault;
};

beforeEach(async () => {
  mocks.navigate.mockReset();
  await act(async () => {
    view = create(<TvLaunchPage />);
  });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

describe("TvLaunchPage", () => {
  it("focuses the code field so the remote can type right away", () => {
    expect(input().props.autoFocus).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain("Ekran kodini kiriting / Введите код экрана");
  });

  it("normalizes a typed code and opens /tv/<canonical code>", () => {
    type("k7m2q-9xr4p");
    expect(input().props.value).toBe("K7M2Q-9XR4P");
    const preventDefault = submit();
    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/tv/K7M2Q9XR4P");
  });

  it("keeps the open button disabled until all 10 characters are typed", () => {
    type("K7M2Q");
    expect(view!.root.findByType("button").props.disabled).toBe(true);
    submit();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 18: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/TvLaunchPage.test.tsx`
Expected: FAIL with `Error: Cannot find module './TvLaunchPage' imported from '…/src/modules/queue/tv/TvLaunchPage.test.tsx'`.

- [ ] **Step 19: Implement the launch page**

The field shows the formatted code (`K7M2Q-9XR4P`) while state keeps the canonical one; `maxLength={11}` allows the dash.

Create `apps/web/src/modules/queue/tv/TvLaunchPage.tsx`:
```tsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { formatCodeForDisplay, normalizeCodeInput } from "./codeInput";
import { TV_LABELS, tvLabel } from "./tvLabels";

/** /tv — the screen code is typed once with the TV remote; the display page URL is then bookmarked by the browser. */
export function TvLaunchPage() {
  const navigate = useNavigate();
  const [code, setCode] = React.useState("");
  const complete = code.length === 10;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (complete) navigate(`/tv/${code}`);
  };

  return (
    <div className="qtv-root qtv-launch">
      <form className="qtv-launch-card" onSubmit={submit}>
        <h1 className="qtv-launch-title">{tvLabel("enterCode", "uz_ru")}</h1>
        <input
          id="qtv-code"
          className="qtv-code-input"
          value={formatCodeForDisplay(code)}
          onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
          placeholder={TV_LABELS.codePlaceholder.ru}
          aria-label={tvLabel("enterCode", "uz_ru")}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={11}
        />
        <button type="submit" className="qtv-button" disabled={!complete}>
          {tvLabel("openScreen", "uz_ru")}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 20: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/TvLaunchPage.test.tsx && npm run typecheck`
Expected: PASS (3 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 21: Write the failing display-page test**

`useQueueDisplay`, `createAnnouncer` and `useParams` are mocked; `window`, `document` and `navigator` are stubbed with only what the page touches. The first sample state already contains a call (`12:1`), which must NOT be announced (first poll is silent).

Create `apps/web/src/modules/queue/tv/TvDisplayPage.test.tsx`:
```tsx
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplayCall, QueueDisplayState } from "../api/queueTypes";

type DisplayResult = { state: QueueDisplayState | null; error: "not_found" | "inactive" | null; offline: boolean };
const mocks = vi.hoisted(() => ({
  display: { state: null, error: null, offline: false } as DisplayResult,
  codes: [] as string[],
  announcer: { unlock: vi.fn(), isUnlocked: vi.fn(), announce: vi.fn(), preload: vi.fn() },
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ code: "k7m2q-9xr4p" }) }));
vi.mock("./useQueueDisplay", () => ({
  useQueueDisplay: (code: string) => {
    mocks.codes.push(code);
    return mocks.display;
  },
}));
vi.mock("./announcer", () => ({ createAnnouncer: () => mocks.announcer }));

import { TvDisplayPage } from "./TvDisplayPage";

const oldCall: QueueDisplayCall = {
  key: "12:1", code: "07", number: 7, name: "Сардор Т.", room: null, doctorName: "Юсупова Нигора", calledAt: "2026-09-30T05:59:30.000Z",
};
const sample = (serverTime: string, recentCalls: QueueDisplayCall[]): QueueDisplayState => ({
  serverTime,
  timeZone: "Asia/Tashkent",
  clinicName: "Kamilovs Clinic",
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [
    {
      doctorId: 1, doctorName: "Каримов Бахтиёр", specialty: "Терапевт", room: "3",
      current: { code: "К-05", name: "Алишер К.", state: "serving" },
      waiting: [{ code: "К-06", name: "Мадина А." }, { code: "К-07", name: null }],
      waitingCount: 4,
    },
    {
      doctorId: 2, doctorName: "Юсупова Нигора", specialty: "", room: null,
      current: { code: "07", name: "Сардор Т.", state: "called" },
      waiting: [],
      waitingCount: 0,
    },
  ],
  recentCalls,
});

let storage: Map<string, string>;
const requestFullscreen = vi.fn(() => Promise.resolve());
const wakeLockRequest = vi.fn(() => Promise.resolve({ release: () => Promise.resolve() }));
const reload = vi.fn();
let view: ReactTestRenderer | undefined;

beforeEach(() => {
  mocks.display = { state: sample("2026-09-30T06:00:00.000Z", [oldCall]), error: null, offline: false };
  mocks.codes = [];
  mocks.announcer.unlock.mockReset().mockResolvedValue(true);
  mocks.announcer.isUnlocked.mockReset().mockReturnValue(true);
  mocks.announcer.announce.mockReset().mockResolvedValue(undefined);
  mocks.announcer.preload.mockReset().mockResolvedValue(undefined);
  requestFullscreen.mockClear();
  wakeLockRequest.mockClear();
  reload.mockClear();
  storage = new Map();
  // Timer functions delegate lazily, so a test that calls vi.useFakeTimers() gets the fake ones.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
    setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
    clearInterval: (id?: number) => clearInterval(id),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) },
    location: { reload },
  });
  vi.stubGlobal("document", {
    documentElement: { requestFullscreen },
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", { wakeLock: { request: wakeLockRequest } });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () => {
    view = create(<TvDisplayPage />);
  });
};
const rerender = async () => {
  await act(async () => {
    view!.update(<TvDisplayPage />);
  });
};
const html = () => JSON.stringify(view!.toJSON());
const startButton = () => view!.root.findAllByProps({ id: "qtv-start" });

describe("TvDisplayPage", () => {
  it("polls with the canonical code and renders cabinets, current patients and the next codes", async () => {
    await render();
    expect(mocks.codes[0]).toBe("K7M2Q9XR4P");
    const text = html();
    for (const expected of ["Kamilovs Clinic", "Navbat / Очередь", "Каримов Бахтиёр", "Терапевт", "К-05", "Алишер К.", "К-06", "К-07", "+2", "Сардор Т.", "Qabulda / На приёме", "Chaqirildi / Вызван", "Navbat yo‘q / Очереди нет", "So‘nggi chaqiruvlar / Последние вызовы", "→ Юсупова Нигора"]) {
      expect(text).toContain(expected);
    }
    expect(view!.root.findAllByProps({ className: "qtv-card" })).toHaveLength(2);
    // calls already present at the first poll are never announced
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(0);
  });

  it("shows the start gate; pressing it goes fullscreen, unlocks audio and remembers the start", async () => {
    await render();
    expect(startButton()).toHaveLength(1);
    expect(startButton()[0].props.autoFocus).toBe(true);
    expect(html()).toContain("Ekranni ishga tushirish / Запустить экран");
    await act(async () => {
      startButton()[0].props.onClick();
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(mocks.announcer.unlock).toHaveBeenCalledTimes(1);
    expect(storage.get("qtv:started")).toBe("1");
    expect(wakeLockRequest).toHaveBeenCalledWith("screen");
    expect(startButton()).toHaveLength(0);
  });

  it("hides the gate by itself after a reload when audio unlocks silently", async () => {
    storage.set("qtv:started", "1");
    await render();
    expect(mocks.announcer.unlock).toHaveBeenCalledTimes(1);
    expect(startButton()).toHaveLength(0);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("keeps the gate after a reload when the browser refuses to unlock audio", async () => {
    storage.set("qtv:started", "1");
    mocks.announcer.unlock.mockResolvedValue(false);
    await render();
    expect(startButton()).toHaveLength(1);
  });

  it("shows a new call in the overlay and announces it in Uzbek, then Russian", async () => {
    await render();
    await act(async () => {
      startButton()[0].props.onClick();
    });
    const fresh: QueueDisplayCall = {
      key: "15:1", code: "К-06", number: 6, name: "Мадина А.", room: "3", doctorName: "Каримов Бахтиёр", calledAt: "2026-09-30T06:00:01.000Z",
    };
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh, oldCall]), error: null, offline: false };
    await rerender();
    expect(view!.root.findByProps({ className: "qtv-overlay-code" }).children).toEqual(["К-06"]);
    expect(html()).toContain("Navbatdagi raqam / Приглашается");
    expect(html()).toContain("→ Xona / Кабинет 3");
    expect(mocks.announcer.announce).toHaveBeenCalledWith(
      [["navbat_raqami", "6", "xona_raqami", "3"], ["nomer", "6", "proydite_v_kabinet_nomer", "3"]],
      ["uz", "ru"],
    );
  });

  it("preloads the voice once the screen is started, and again only when the display language changes", async () => {
    await render();
    expect(mocks.announcer.preload).not.toHaveBeenCalled(); // audio is still locked
    await act(async () => {
      startButton()[0].props.onClick();
    });
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(1);
    expect(mocks.announcer.preload).toHaveBeenLastCalledWith(["uz", "ru"]);
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [oldCall]), error: null, offline: false };
    await rerender();
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(1); // a new poll is no reason to preload again
    const next = sample("2026-09-30T06:00:04.000Z", [oldCall]);
    mocks.display = { state: { ...next, display: { ...next.display, language: "ru" } }, error: null, offline: false };
    await rerender();
    expect(mocks.announcer.preload).toHaveBeenCalledTimes(2);
    expect(mocks.announcer.preload).toHaveBeenLastCalledWith(["ru"]);
  });

  it("preloads nothing when the display has voice turned off", async () => {
    const quiet = sample("2026-09-30T06:00:00.000Z", [oldCall]);
    mocks.display = { state: { ...quiet, display: { ...quiet.display, voiceEnabled: false } }, error: null, offline: false };
    storage.set("qtv:started", "1");
    await render();
    expect(startButton()).toHaveLength(0);
    expect(mocks.announcer.preload).not.toHaveBeenCalled();
  });

  it("does not speak before the screen is started", async () => {
    await render();
    const fresh: QueueDisplayCall = { ...oldCall, key: "12:2", calledAt: "2026-09-30T06:00:01.000Z" };
    mocks.display = { state: sample("2026-09-30T06:00:02.000Z", [fresh]), error: null, offline: false };
    await rerender();
    expect(view!.root.findAllByProps({ className: "qtv-overlay" })).toHaveLength(1);
    expect(mocks.announcer.announce).not.toHaveBeenCalled();
  });

  it("shows the offline banner and keeps the last data", async () => {
    mocks.display = { ...mocks.display, offline: true };
    await render();
    expect(html()).toContain("Aloqa yo‘q / Нет связи");
    expect(html()).toContain("К-05");
  });

  it("reloads at 04:00 clinic time, but waits while the screen is offline", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T22:58:00.000Z") }); // 03:58 in Tashkent
    mocks.display = { state: sample("2026-09-29T22:58:00.000Z", [oldCall]), error: null, offline: true };
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(reload).not.toHaveBeenCalled();
    mocks.display = { ...mocks.display, offline: false };
    await rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows a full-screen message for an unknown screen code", async () => {
    mocks.display = { state: null, error: "not_found", offline: false };
    await render();
    expect(html()).toContain("Ekran o‘chirilgan. Administratordan yangi kod so‘rang.");
    expect(html()).toContain("Экран отключён. Попросите администратора выдать новый код.");
    expect(startButton()).toHaveLength(0);
  });

  it("shows a full-screen message for an inactive clinic subscription", async () => {
    mocks.display = { state: null, error: "inactive", offline: false };
    await render();
    expect(html()).toContain("Klinika obunasi faol emas.");
    expect(html()).toContain("Подписка клиники неактивна.");
  });
});
```

- [ ] **Step 22: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/TvDisplayPage.test.tsx`
Expected: FAIL with `Error: Cannot find module './TvDisplayPage' imported from '…/src/modules/queue/tv/TvDisplayPage.test.tsx'`.

- [ ] **Step 23: Implement the device helpers**

Create `apps/web/src/modules/queue/tv/tvDevice.ts`:
```ts
/**
 * Thin, fail-safe wrappers over browser features TV engines may lack (Fullscreen, Wake Lock, localStorage).
 * Every function feature-detects and swallows errors: a TV must keep showing the queue whatever is missing.
 */
export const STARTED_FLAG_KEY = "qtv:started";

export type WakeLockHandle = { release(): Promise<void> };

export function readStartedFlag(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STARTED_FLAG_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode, kiosk policy)
  }
}

export function writeStartedFlag(): void {
  try {
    window.localStorage.setItem(STARTED_FLAG_KEY, "1");
  } catch {
    // storage blocked: the start button will simply be shown again after a reload
  }
}

/** Must run synchronously inside the click/keydown handler (fullscreen needs a user gesture). */
export function requestFullscreen(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (typeof root.requestFullscreen === "function") {
      const pending = root.requestFullscreen();
      if (pending && typeof pending.catch === "function") pending.catch(() => undefined);
    } else if (typeof root.webkitRequestFullscreen === "function") {
      root.webkitRequestFullscreen();
    }
  } catch {
    // not allowed here (e.g. inside an iframe)
  }
}

/** Screen Wake Lock (Chrome 84+, HTTPS only, visible page only); null when unsupported or refused. */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
  if (typeof navigator === "undefined") return null;
  const wakeLock = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> } }).wakeLock;
  if (!wakeLock || typeof wakeLock.request !== "function") return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}
```

- [ ] **Step 24: Implement the display page**

Layout (approved mockup): header = clinic name · `Navbat / Очередь` · clock and date in the clinic zone (server-aligned); grid of cabinet cards (≤ 9 per page, 1/2/3 columns, pages rotate every 10 s) — room big, doctor name + specialty, current block (green «На приёме» / amber «Вызван») with code + masked name, «Далее» chips (first 5 codes) + `+N`; footer = last 5 calls; full-screen call overlay for ≥ 10 s per call, queued one after another; offline banner; start gate. Labels follow `display.language` (`uz_ru` → `uz / ru`); the not-found/inactive screens do not know the language and show both lines.

Create `apps/web/src/modules/queue/tv/TvDisplayPage.tsx`:
```tsx
import React from "react";
import { useParams } from "react-router-dom";
import type { QueueDisplayCabinet, QueueDisplayCall, QueueDisplayLanguage, QueueDisplayState } from "../api/queueTypes";
import { createAnnouncer, type Announcer } from "./announcer";
import { createCallTracker } from "./callTracker";
import { normalizeCodeInput } from "./codeInput";
import { readStartedFlag, requestFullscreen, requestWakeLock, writeStartedFlag, type WakeLockHandle } from "./tvDevice";
import { TV_LABELS, tvLabel } from "./tvLabels";
import { CABINETS_PER_PAGE, gridColumns, pageCabinets } from "./tvLayout";
import { formatClock, formatDay, msUntilDailyReload } from "./tvTime";
import { useQueueDisplay } from "./useQueueDisplay";
import { announcementClipIds, voiceLangs } from "./voicePhrases";

export const CALL_OVERLAY_MS = 10_000;
export const PAGE_ROTATE_MS = 10_000;
const SPEECH_TIMEOUT_MS = 20_000;
const RELOAD_RETRY_MS = 5 * 60_000;
const RECENT_CALLS_SHOWN = 5;

/** Resolves when `promise` settles or after `ms`, whichever comes first; never rejects. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

/** Chime + voice for one call; voice follows the display settings. Never rejects, never hangs longer than 20 s. */
function speakCall(announcer: Announcer, display: QueueDisplayState["display"], call: QueueDisplayCall): Promise<void> {
  const langs = display.voiceEnabled ? voiceLangs(display.language) : [];
  const groups = langs.map((lang) => announcementClipIds(lang, call.number, call.room));
  const run = async () => {
    // After the start button, unlock() only re-resumes a context the browser suspended; without audio → silence.
    if (!announcer.isUnlocked() && !(await announcer.unlock())) return;
    await announcer.announce(groups, langs);
  };
  return settleWithin(run(), SPEECH_TIMEOUT_MS);
}

function TvClock({ skewMs, timeZone }: { skewMs: number; timeZone: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const serverNow = now + skewMs;
  return (
    <div className="qtv-clock">
      <div className="qtv-clock-time">{formatClock(serverNow, timeZone)}</div>
      <div className="qtv-clock-day">{formatDay(serverNow, timeZone)}</div>
    </div>
  );
}

function CabinetCard({ cabinet, language }: { cabinet: QueueDisplayCabinet; language: QueueDisplayLanguage }) {
  const current = cabinet.current;
  const more = cabinet.waitingCount - cabinet.waiting.length;
  return (
    <section className="qtv-card">
      <div className="qtv-card-head">
        <div className="qtv-room">
          <span className="qtv-room-label">{tvLabel("cabinet", language)}</span>
          <span className="qtv-room-number">{cabinet.room ?? "—"}</span>
        </div>
        <div className="qtv-doctor">
          <div className="qtv-doctor-name">{cabinet.doctorName}</div>
          {cabinet.specialty ? <div className="qtv-doctor-specialty">{cabinet.specialty}</div> : null}
        </div>
      </div>
      {current ? (
        <div className={current.state === "serving" ? "qtv-current qtv-current-serving" : "qtv-current qtv-current-called"}>
          <div className="qtv-current-label">{tvLabel(current.state === "serving" ? "serving" : "called", language)}</div>
          {current.code ? <div className="qtv-current-code">{current.code}</div> : null}
          {current.name ? <div className="qtv-current-name">{current.name}</div> : null}
        </div>
      ) : (
        <div className="qtv-current qtv-current-free">
          <div className="qtv-current-label">{tvLabel("free", language)}</div>
        </div>
      )}
      <div className="qtv-next">
        <span className="qtv-next-label">{tvLabel("next", language)}</span>
        {cabinet.waiting.length === 0 ? (
          <span className="qtv-next-empty">{tvLabel("noQueue", language)}</span>
        ) : (
          <span className="qtv-next-list">
            {cabinet.waiting.map((entry) => (
              <span key={entry.code} className="qtv-chip">{entry.code}</span>
            ))}
            {more > 0 ? <span className="qtv-chip qtv-chip-more">{`+${more}`}</span> : null}
          </span>
        )}
      </div>
    </section>
  );
}

function CallOverlay({ call, language }: { call: QueueDisplayCall; language: QueueDisplayLanguage }) {
  const target = call.room ? `${tvLabel("cabinet", language)} ${call.room}` : call.doctorName;
  return (
    <div className="qtv-overlay" role="alert">
      <div className="qtv-overlay-card">
        <div className="qtv-overlay-label">{tvLabel("invitation", language)}</div>
        <div className="qtv-overlay-code">{call.code}</div>
        {call.name ? <div className="qtv-overlay-name">{call.name}</div> : null}
        <div className="qtv-overlay-room">{`→ ${target}`}</div>
      </div>
    </div>
  );
}

/** Full-screen notice; the display language is unknown here, so Uzbek and Russian are shown on separate lines. */
function FullMessage({ labelKey }: { labelKey: "notFound" | "inactive" }) {
  return (
    <div className="qtv-root qtv-message">
      <p className="qtv-message-text">{TV_LABELS[labelKey].uz}</p>
      <p className="qtv-message-text">{TV_LABELS[labelKey].ru}</p>
    </div>
  );
}

/** /tv/:code — public hall screen: cabinets, current and next patients, call overlay with chime and voice. */
export function TvDisplayPage() {
  const params = useParams<{ code: string }>();
  const code = normalizeCodeInput(params.code ?? "");
  const { state, error, offline } = useQueueDisplay(code);

  const announcerRef = React.useRef<Announcer | null>(null);
  if (announcerRef.current === null) announcerRef.current = createAnnouncer();
  const trackerRef = React.useRef<ReturnType<typeof createCallTracker> | null>(null);
  if (trackerRef.current === null) trackerRef.current = createCallTracker();

  const [started, setStarted] = React.useState(false);
  const startedRef = React.useRef(started);
  startedRef.current = started;
  const [calls, setCalls] = React.useState<QueueDisplayCall[]>([]);
  const [pageIndex, setPageIndex] = React.useState(0);

  const serverMs = state ? Date.parse(state.serverTime) : Number.NaN;
  const skewMs = React.useMemo(() => (Number.isNaN(serverMs) ? 0 : serverMs - Date.now()), [serverMs]);
  const skewRef = React.useRef(skewMs);
  skewRef.current = skewMs;
  const displayRef = React.useRef<QueueDisplayState["display"] | null>(null);
  displayRef.current = state?.display ?? null;

  // A screen that was started before (flag in localStorage) tries to unlock audio silently after a reload
  // (e.g. the nightly 04:00 one). Chrome allows it after an earlier gesture on this site; if not, the button stays.
  React.useEffect(() => {
    if (!readStartedFlag()) return;
    let alive = true;
    void announcerRef.current?.unlock().then((unlocked) => {
      if (alive && unlocked) setStarted(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = React.useCallback(() => {
    requestFullscreen(); // first: it needs the click's transient user activation
    void announcerRef.current?.unlock(); // resume() runs synchronously inside the gesture
    writeStartedFlag();
    setStarted(true);
  }, []);

  // The remote's OK key works even if the button lost focus.
  React.useEffect(() => {
    if (started || typeof window.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.keyCode === 13) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [started, start]);

  // Keep the TV awake; the browser drops the lock whenever the page is hidden, so take it again when visible.
  React.useEffect(() => {
    if (!started) return;
    let active = true;
    let lock: WakeLockHandle | null = null;
    const acquire = () => {
      void requestWakeLock().then((handle) => {
        if (active) lock = handle;
        else void handle?.release().catch(() => undefined);
      });
    };
    acquire();
    const canListen = typeof document !== "undefined" && typeof document.addEventListener === "function";
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    if (canListen) document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (canListen) document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [started]);

  // Decode all voice clips in the background once audio is unlocked, so the first calls of the day do not wait for
  // downloads; again when the display language changes. Voice off → nothing to preload. announce() never waits for it.
  const voiceEnabled = state ? state.display.voiceEnabled : false;
  const voiceLanguage = state ? state.display.language : null;
  React.useEffect(() => {
    if (!started || !voiceEnabled || !voiceLanguage) return;
    void announcerRef.current?.preload(voiceLangs(voiceLanguage));
  }, [started, voiceEnabled, voiceLanguage]);

  // New calls → overlay queue (the tracker keeps the first poll silent and drops stale calls).
  React.useEffect(() => {
    if (!state || !trackerRef.current) return;
    const fresh = trackerRef.current.ingest(state);
    if (fresh.length > 0) setCalls((queue) => [...queue, ...fresh]);
  }, [state]);

  // One overlay at a time: at least 10 s, and until its announcement has finished.
  const activeCall = calls[0] ?? null;
  const activeKey = activeCall ? activeCall.key : null;
  React.useEffect(() => {
    if (!activeCall) return;
    let finished = false;
    let timer: number | undefined;
    const shown = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, CALL_OVERLAY_MS);
    });
    const announcer = announcerRef.current;
    const display = displayRef.current;
    const spoken = startedRef.current && announcer && display ? speakCall(announcer, display, activeCall) : Promise.resolve();
    void Promise.all([shown, spoken]).then(() => {
      if (!finished) setCalls((queue) => queue.slice(1));
    });
    return () => {
      finished = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // Re-run only when the call at the head of the queue changes, not on every poll.
  }, [activeKey]);

  const cabinets = state ? state.cabinets : [];
  const { page, pageCount } = pageCabinets(cabinets, pageIndex);
  React.useEffect(() => {
    if (pageCount <= 1) return;
    const id = window.setInterval(() => setPageIndex((index) => index + 1), PAGE_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pageCount]);

  // Nightly reload at 04:00 clinic time: picks up new app versions and frees memory on long-running TV browsers.
  // Never while offline: a reload without network leaves the TV on the browser's error page for good.
  const timeZone = state ? state.timeZone : null;
  const offlineRef = React.useRef(offline);
  offlineRef.current = offline;
  React.useEffect(() => {
    if (!timeZone) return;
    let id: number | undefined;
    const fire = () => {
      if (offlineRef.current) id = window.setTimeout(fire, RELOAD_RETRY_MS);
      else window.location.reload();
    };
    id = window.setTimeout(fire, msUntilDailyReload(Date.now() + skewRef.current, timeZone));
    return () => {
      if (id !== undefined) window.clearTimeout(id);
    };
  }, [timeZone]);

  if (error === "not_found") return <FullMessage labelKey="notFound" />;
  if (error === "inactive") return <FullMessage labelKey="inactive" />;

  const language: QueueDisplayLanguage = state ? state.display.language : "uz_ru";
  const shownCount = Math.min(cabinets.length, CABINETS_PER_PAGE);
  const columns = gridColumns(shownCount);
  const rows = Math.max(1, Math.ceil(shownCount / columns));
  const recent = state ? state.recentCalls.slice(0, RECENT_CALLS_SHOWN) : [];

  return (
    <div className="qtv-root qtv-display">
      <header className="qtv-header">
        <div className="qtv-clinic">{state ? state.clinicName : ""}</div>
        <div className="qtv-title">{tvLabel("queueTitle", language)}</div>
        {state ? <TvClock skewMs={skewMs} timeZone={state.timeZone} /> : <div className="qtv-clock" />}
      </header>
      <main className="qtv-main">
        {!state ? null : cabinets.length === 0 ? (
          <div className="qtv-empty">{tvLabel("noQueueYet", language)}</div>
        ) : (
          <div
            className={`qtv-grid qtv-cols-${columns}`}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          >
            {page.map((cabinet) => (
              <CabinetCard key={cabinet.doctorId} cabinet={cabinet} language={language} />
            ))}
          </div>
        )}
        {pageCount > 1 ? <div className="qtv-pages">{`${(pageIndex % pageCount) + 1} / ${pageCount}`}</div> : null}
      </main>
      <footer className="qtv-footer">
        <span className="qtv-footer-label">{tvLabel("recentCalls", language)}</span>
        <span className="qtv-footer-list">
          {recent.map((call) => (
            <span key={call.key} className="qtv-recent">
              <span className="qtv-recent-code">{call.code}</span>
              <span className="qtv-recent-room">{`→ ${call.room ?? call.doctorName}`}</span>
            </span>
          ))}
        </span>
      </footer>
      {offline ? (
        <div className="qtv-offline" role="status">
          {tvLabel("offline", language)}
        </div>
      ) : null}
      {activeCall ? <CallOverlay call={activeCall} language={language} /> : null}
      {!started ? (
        <div className="qtv-gate">
          <button id="qtv-start" type="button" className="qtv-start-button" autoFocus onClick={start}>
            {tvLabel("startButton", language)}
          </button>
          <p className="qtv-gate-hint">{tvLabel("startHint", language)}</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 25: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/TvDisplayPage.test.tsx && npm run typecheck`
Expected: PASS (12 tests); `tsc --noEmit` prints nothing.

- [ ] **Step 26: Add the TV stylesheet and the TV app**

Create `apps/web/src/modules/queue/tv/tv.css`:
```css
/*
 * Электронная очередь — ТВ-экран (/tv, /tv/:code).
 * Plain CSS on purpose: TV browsers (Chromium 87–110) drop Tailwind 4 output (@layer, oklch, color-mix).
 * Rules: every class starts with "qtv-"; colours are hex/rgba only; sizes are vw/vh/clamp/em;
 * no @layer, :has(), container queries, aspect-ratio or other features newer than Chrome 87.
 * Card contents use em, so one font-size per grid density (.qtv-cols-N) scales the whole card.
 */

body.qtv-body {
  margin: 0;
  background: #070b14;
  overflow: hidden;
}

.qtv-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #070b14;
  color: #f8fafc;
  font-family: "Inter", "Roboto", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.15;
  -webkit-font-smoothing: antialiased;
}

.qtv-display {
  cursor: none;
}

/* —— Header —— */
.qtv-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.2vh 2vw;
  background: #0f172a;
  border-bottom: 0.3vh solid #1e293b;
}

.qtv-clinic {
  flex: 1 1 0;
  min-width: 0;
  font-size: clamp(16px, 2.2vw, 64px);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qtv-title {
  flex: 0 0 auto;
  padding: 0 2vw;
  font-size: clamp(16px, 2.4vw, 72px);
  font-weight: 800;
  color: #38bdf8;
  text-align: center;
}

.qtv-clock {
  flex: 1 1 0;
  text-align: right;
}

.qtv-clock-time {
  font-size: clamp(20px, 3vw, 96px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.qtv-clock-day {
  font-size: clamp(10px, 1vw, 32px);
  color: #94a3b8;
}

/* —— Cabinet grid —— */
.qtv-main {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  padding: 1.5vh 1.5vw;
}

.qtv-grid {
  display: grid;
  grid-gap: 1.2vw;
  gap: 1.2vw;
  height: 100%;
  font-size: 1.1vw;
}

.qtv-cols-1 {
  font-size: 2.6vw;
}

.qtv-cols-2 {
  font-size: 1.5vw;
}

.qtv-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: clamp(20px, 3.5vw, 110px);
  color: #94a3b8;
  text-align: center;
}

.qtv-pages {
  position: absolute;
  right: 1.5vw;
  bottom: 0.3vh;
  font-size: clamp(10px, 1vw, 28px);
  color: #64748b;
}

.qtv-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0.7em;
  background: #0f1a2e;
  border: 0.15em solid #1e2b45;
  border-radius: 0.8em;
}

.qtv-card-head {
  display: flex;
  align-items: center;
  margin-bottom: 0.5em;
}

.qtv-room {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 3.6em;
  margin-right: 0.7em;
  padding: 0.2em 0.5em;
  border-radius: 0.5em;
  background: #1e3a8a;
}

.qtv-room-label {
  font-size: 0.7em;
  color: #bfdbfe;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.qtv-room-number {
  font-size: 2.4em;
  font-weight: 800;
  line-height: 1;
}

.qtv-doctor {
  min-width: 0;
}

.qtv-doctor-name {
  font-size: 1.15em;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qtv-doctor-specialty {
  font-size: 0.85em;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qtv-current {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.3em 0.6em;
  border-radius: 0.6em;
  text-align: center;
}

.qtv-current-serving {
  background: #14532d;
  border: 0.15em solid #22c55e;
  color: #dcfce7;
}

.qtv-current-called {
  background: #78350f;
  border: 0.15em solid #f59e0b;
  color: #fef3c7;
  animation: qtv-glow 1.2s ease-in-out infinite alternate;
}

.qtv-current-free {
  background: #111827;
  border: 0.15em dashed #334155;
  color: #64748b;
}

.qtv-current-label {
  font-size: 0.85em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.qtv-current-code {
  font-size: 3.4em;
  font-weight: 900;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.qtv-current-name {
  max-width: 100%;
  font-size: 1.3em;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qtv-next {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  min-width: 0;
  margin-top: 0.5em;
  overflow: hidden;
  white-space: nowrap;
}

.qtv-next-label {
  flex: 0 0 auto;
  margin-right: 0.5em;
  font-size: 0.8em;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
}

.qtv-next-list {
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.qtv-chip {
  margin-right: 0.4em;
  padding: 0.1em 0.45em;
  border-radius: 0.4em;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 1.05em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.qtv-chip-more {
  background: transparent;
  color: #94a3b8;
}

.qtv-next-empty {
  font-size: 0.9em;
  color: #64748b;
}

/* —— Footer: recent calls —— */
.qtv-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 1vh 2vw;
  background: #0f172a;
  border-top: 0.3vh solid #1e293b;
  font-size: clamp(12px, 1.5vw, 48px);
  white-space: nowrap;
  overflow: hidden;
}

.qtv-footer-label {
  flex: 0 0 auto;
  margin-right: 1.5vw;
  font-size: 0.8em;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
}

.qtv-footer-list {
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.qtv-recent {
  margin-right: 2vw;
}

.qtv-recent-code {
  margin-right: 0.4em;
  font-weight: 800;
  color: #fbbf24;
}

.qtv-recent-room {
  color: #e2e8f0;
}

/* —— Banners and overlays —— */
.qtv-offline {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 30;
  transform: translateX(-50%);
  padding: 0.6vh 2vw;
  border-radius: 0 0 1vw 1vw;
  background: #b91c1c;
  color: #ffffff;
  font-size: clamp(14px, 1.6vw, 48px);
  font-weight: 800;
}

.qtv-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.9);
}

.qtv-overlay-card {
  max-width: 90vw;
  padding: 4vh 6vw;
  border: 0.4vw solid #f59e0b;
  border-radius: 2vw;
  background: #0f172a;
  box-shadow: 0 0 6vw rgba(245, 158, 11, 0.35);
  text-align: center;
  animation: qtv-pop 0.35s ease-out both;
}

.qtv-overlay-label {
  font-size: clamp(18px, 3vw, 96px);
  font-weight: 700;
  color: #fde68a;
}

.qtv-overlay-code {
  font-size: clamp(64px, 16vw, 480px);
  font-weight: 900;
  line-height: 1;
  color: #fbbf24;
  font-variant-numeric: tabular-nums;
}

.qtv-overlay-name {
  margin-top: 1vh;
  font-size: clamp(24px, 4.5vw, 140px);
  font-weight: 700;
}

.qtv-overlay-room {
  margin-top: 1.5vh;
  font-size: clamp(24px, 4.5vw, 140px);
  font-weight: 800;
  color: #38bdf8;
}

.qtv-gate {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.8);
  cursor: auto;
}

.qtv-start-button {
  padding: 2.5vh 4vw;
  border: 0.4vw solid #86efac;
  border-radius: 1.5vw;
  background: #22c55e;
  color: #052e16;
  font-family: inherit;
  font-size: clamp(20px, 3vw, 96px);
  font-weight: 800;
  cursor: pointer;
}

.qtv-start-button:focus {
  outline: 0.5vw solid #fbbf24;
  outline-offset: 0.5vw;
}

.qtv-gate-hint {
  max-width: 80vw;
  margin: 3vh 0 0;
  font-size: clamp(14px, 1.6vw, 48px);
  color: #cbd5e1;
  text-align: center;
}

.qtv-message {
  align-items: center;
  justify-content: center;
  padding: 4vw;
}

.qtv-message-text {
  max-width: 80vw;
  margin: 0 0 3vh;
  font-size: clamp(20px, 3.2vw, 100px);
  font-weight: 700;
  line-height: 1.3;
  color: #fca5a5;
  text-align: center;
}

/* —— Launch page (/tv) —— */
.qtv-launch {
  align-items: center;
  justify-content: center;
}

.qtv-launch-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5vh 5vw;
  border: 0.2vw solid #1e293b;
  border-radius: 2vw;
  background: #0f172a;
}

.qtv-launch-title {
  margin: 0 0 3vh;
  font-size: clamp(20px, 3vw, 96px);
  font-weight: 800;
  text-align: center;
}

.qtv-code-input {
  width: 9em;
  max-width: 90vw;
  margin: 0 0 3vh;
  padding: 1.5vh 1.5vw;
  border: 0.3vw solid #334155;
  border-radius: 1vw;
  background: #020617;
  color: #f8fafc;
  font-family: inherit;
  font-size: clamp(28px, 5vw, 160px);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
}

.qtv-code-input:focus {
  outline: none;
  border-color: #38bdf8;
}

.qtv-button {
  padding: 1.8vh 3vw;
  border: 0.3vw solid #38bdf8;
  border-radius: 1vw;
  background: #0ea5e9;
  color: #03121f;
  font-family: inherit;
  font-size: clamp(18px, 2.4vw, 72px);
  font-weight: 800;
  cursor: pointer;
}

.qtv-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.qtv-button:focus {
  outline: 0.4vw solid #fbbf24;
  outline-offset: 0.4vw;
}

@keyframes qtv-glow {
  from {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
  to {
    box-shadow: 0 0 1.2em 0.2em rgba(245, 158, 11, 0.55);
  }
}

@keyframes qtv-pop {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

Create `apps/web/src/modules/queue/tv/TvApp.tsx` (the only importer of `tv.css`, so the stylesheet ships in the lazy TV chunk; `qtv-body` darkens the page behind the root and hides scrollbars):
```tsx
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { TvDisplayPage } from "./TvDisplayPage";
import { TvLaunchPage } from "./TvLaunchPage";
import "./tv.css";

/**
 * Public TV app, rendered by App.tsx for /tv and /tv/* OUTSIDE AuthProvider: no staff token is ever sent and a
 * stale token in this browser can never redirect the TV to /login. Lazy-loaded, so audio code stays out of the main bundle.
 */
export function TvApp() {
  React.useEffect(() => {
    const previousTitle = document.title;
    document.title = "Navbat / Очередь";
    document.body.classList.add("qtv-body");
    return () => {
      document.title = previousTitle;
      document.body.classList.remove("qtv-body");
    };
  }, []);

  return (
    <Routes>
      <Route path="/tv" element={<TvLaunchPage />} />
      <Route path="/tv/:code" element={<TvDisplayPage />} />
      <Route path="*" element={<Navigate to="/tv" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 27: Render the TV app outside AuthProvider**

In `apps/web/src/App.tsx` replace the whole file content:
```tsx
import React from "react";
import { AppRouter } from "./router/AppRouter";
import { AuthProvider } from "./auth/AuthContext";

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
```
with:
```tsx
import React from "react";
import { useLocation } from "react-router-dom";
import { AppRouter } from "./router/AppRouter";
import { AuthProvider } from "./auth/AuthContext";
import { isTvPath } from "./modules/queue/tv/tvPath";

// Public TV screen (/tv, /tv/:code): rendered outside AuthProvider so a stale staff token in the TV browser can never
// redirect it to /login, and lazy-loaded so its audio code stays out of the staff bundle.
const TvApp = React.lazy(() => import("./modules/queue/tv/TvApp").then((module) => ({ default: module.TvApp })));

export default function App() {
  const { pathname } = useLocation();
  if (isTvPath(pathname)) {
    return (
      <React.Suspense fallback={<div style={{ minHeight: "100vh", background: "#070b14" }} />}>
        <TvApp />
      </React.Suspense>
    );
  }
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
```
(`App` keeps its default export, `main.tsx` is unchanged. The file has CRLF line endings in the working tree because of `core.autocrlf=true`; git normalizes them, so writing LF is fine.)

- [ ] **Step 28: Build for the TV browsers (Chromium 87)**

The TV page is lazy, but a TV still downloads and parses the main entry chunk (`App.tsx` statically imports `AppRouter`, `AuthProvider` and `i18n`). Vite 7 defaults `build.target` to `baseline-widely-available` (chrome107), which lets esbuild emit syntax a Chromium 87 TV cannot parse; one `SyntaxError` in that chunk leaves the hall screen black. `build.cssTarget` defaults to the same list, so esbuild also lowers the CSS for those engines.

`vite.config.ts` is CRLF in the working tree (the Edit tool keeps that).

In `apps/web/vite.config.ts` replace:
```ts
  server: {
    port: 5173,
  },
});
```
with:
```ts
  server: {
    port: 5173,
  },
  build: {
    // The public TV screen (/tv) loads the main entry chunk too, and hall TVs run Chromium >= 87. Vite 7's default
    // target (chrome107) may emit syntax those engines cannot parse (class static blocks, `#field in obj`).
    target: ["es2020", "chrome87", "edge88", "firefox78", "safari14"],
  },
});
```

- [ ] **Step 29: Run the whole web suite, typecheck, i18n guard and build, and check the bundle for TV browsers**

Run: `cd apps/web && npx vitest run src/modules/queue/tv/`
Expected: PASS (12 files, 92 tests: 54 from Task 11 + 38 from Task 12).

Run: `cd apps/web && npm test && npm run typecheck && npm run check-i18n && npm run build`
Expected: PASS — 38 test files, 223 tests, 0 failures; `tsc --noEmit` prints nothing; `[i18n] OK: 1811 keys, full ru/uz parity, all code references resolve.` (printed twice: by `check-i18n` and by the `prebuild` hook); `vite build` prints `✓ built in …` with no esbuild error about transforming syntax "to the configured target environment", and lists separate `dist/assets/TvApp-<hash>.js` and `dist/assets/TvApp-<hash>.css` chunks.

Run: `cd apps/web && grep -cE "oklch|color-mix|@layer|:has\(" dist/assets/TvApp-*.css || true`
Expected: `0` (the TV stylesheet contains nothing TV browsers cannot parse; `|| true` only hides grep's exit code 1 for "no match"). `dist/` is git-ignored; do not commit it.

Run: `cd apps/web && grep -lE "static[{]|#[A-Za-z_$][A-Za-z0-9_$]* in " dist/assets/*.js || echo "no static blocks or #x-in checks"`
Expected: `no static blocks or #x-in checks`. `grep -l` would print the name of every built JS file (the main `index-<hash>.js` included) that contains a class static block (`static{`, Chrome 94) or a private brand check (`#x in obj`, Chrome 91); either one is a `SyntaxError` for the whole file on Chromium 87.

Visual check happens in Task 14 on the PGlite preview stand (`/tv` → type the code from the displays panel → the board, overlay and chime). Do NOT point a local build at production (`apps/web/.env` targets the production API).

- [ ] **Step 30: Commit**

```bash
git add apps/web/src/App.tsx apps/web/vite.config.ts apps/web/src/modules/queue/tv/tvPath.ts apps/web/src/modules/queue/tv/tvPath.test.ts apps/web/src/modules/queue/tv/tvTime.ts apps/web/src/modules/queue/tv/tvTime.test.ts apps/web/src/modules/queue/tv/useQueueDisplay.ts apps/web/src/modules/queue/tv/useQueueDisplay.test.tsx apps/web/src/modules/queue/tv/announcer.ts apps/web/src/modules/queue/tv/announcer.test.ts apps/web/src/modules/queue/tv/tvDevice.ts apps/web/src/modules/queue/tv/TvLaunchPage.tsx apps/web/src/modules/queue/tv/TvLaunchPage.test.tsx apps/web/src/modules/queue/tv/TvDisplayPage.tsx apps/web/src/modules/queue/tv/TvDisplayPage.test.tsx apps/web/src/modules/queue/tv/TvApp.tsx apps/web/src/modules/queue/tv/tv.css && git commit -m "feat(web): public TV queue screen with call overlay, chime and voice"
```

---

### Task 13: Voice clip generation script (Azure neural TTS)

The TV announcer (Task 12, `createAnnouncer("/queue-voice")`) plays pre-generated mp3 clips from `apps/web/public/queue-voice/<lang>/<id>.mp3`. Until they exist, it plays only the chime. This task adds a one-time generator.
- **Pure logic.** `apps/web/scripts/queueVoice.mjs` holds SSML building, the clip plan, voices, flags and the retrying HTTP call. It takes an injected `fetch`/`sleep`, so vitest tests it without network or disk.
- **CLI.** `apps/web/scripts/generate-queue-voice.mjs` does the file system work and uses the global `fetch` (Node ≥ 18; this PC runs v24).

Facts verified against the repo:
- `apps/web/vite.config.ts` has no `test` block. Vitest therefore uses its default include `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which matches `scripts/queueVoice.test.mjs`.
- `tsconfig.json` includes only `src`, so the `.mjs` files are not typechecked.
- `scripts/check-i18n.cjs` scans only `src`.
- `apps/web/package.json` has `"type": "module"`.
- `apps/web/.gitignore` has CRLF line endings and **no final newline**. The step below appends with a Node one-liner instead of an edit anchor.
- `apps/web/.env` is tracked by git and points at production. The Azure key must never go into any file: the script reads it only from the process environment.

**Files:**
- Create: `apps/web/scripts/queueVoice.mjs`
- Create: `apps/web/scripts/generate-queue-voice.mjs`
- Test: `apps/web/scripts/queueVoice.test.mjs`
- Modify: `apps/web/package.json` (scripts block, line 13 `"test": "vitest run"`)
- Modify: `apps/web/.gitignore` (append line 4 `.env.local`)

**Interfaces:**
- Consumes: `apps/web/src/modules/queue/tv/voiceClips.json` from Task 11. Its shape is `{ "ru": { "<id>": "<text>" }, "uz": { … } }`.
  - ru ids: `"1"`…`"19"`, `"20"`…`"90"` (tens), `"100"`…`"900"` (hundreds), plus `nomer`, `proydite_v_kabinet_nomer`, `proydite_na_priyom`.
  - uz ids: `"1"`…`"9"`, `"10"`…`"90"`, `"100"`…`"900"`, plus `navbat_raqami`, `xona_raqami`, `qabulga_marhamat`.
  - Total: 69 clips. Uzbek oʻ is written with U+02BB in 7 texts.
- Produces:
  - `apps/web/scripts/queueVoice.mjs` exports:
    - constants `LANGS` (`["uz","ru"]`), `DEFAULT_VOICES` (`{ uz: "uz-UZ-MadinaNeural", ru: "ru-RU-SvetlanaNeural" }`), `OUTPUT_FORMAT` (`"audio-24khz-48kbitrate-mono-mp3"`), `THROTTLE_MS` (3500), `MAX_RETRIES` (5);
    - `escapeXml(text)`, `buildSsml(lang, text, voice)`, `voiceFor(lang, env)`, `parseArgs(argv) → { dryRun, force, only }`;
    - `planClips(catalogue, { only, existing, force }) → Array<{ lang, id, text, file }>`, where `existing` is a `Set` of `"<lang>/<id>.mp3"`;
    - `ttsEndpoint(region)`, `isRetryableStatus(status)`, `retryDelayMs(attempt, retryAfter, nowMs?)`;
    - `synthesizeClip({ fetchImpl, region, key, ssml, sleep, onRetry?, maxRetries? }) → Promise<Buffer>`.
  - npm script `voice:generate` (flags `--dry-run`, `--force`, `--only=uz|ru`; env `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, optional `AZURE_VOICE_UZ`, `AZURE_VOICE_RU`).
  - Output files `apps/web/public/queue-voice/{uz,ru}/<id>.mp3`, served at `/queue-voice/<lang>/<id>.mp3`. These are written later by the manual step in Task 14.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `apps/web/scripts/queueVoice.test.mjs`. The CLI block is added in Step 5; `spawnSync`/`CLI` are imported now so Step 5 only appends:
```js
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_VOICES,
  buildSsml,
  escapeXml,
  parseArgs,
  planClips,
  retryDelayMs,
  synthesizeClip,
  ttsEndpoint,
  voiceFor,
} from "./queueVoice.mjs";

const CLI = fileURLToPath(new URL("./generate-queue-voice.mjs", import.meta.url));
const catalogue = JSON.parse(readFileSync(new URL("../src/modules/queue/tv/voiceClips.json", import.meta.url), "utf8"));

/** Minimal stand-in for a fetch Response. */
const reply = (status, { body = "", headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  text: async () => body,
});
const synth = (fetchImpl, sleep = vi.fn(async () => {})) =>
  synthesizeClip({ fetchImpl, region: "westeurope", key: "test-key", ssml: "<speak/>", sleep });

describe("SSML", () => {
  it("wraps one clip with zero leading/trailing silence and the voice's locale", () => {
    expect(buildSsml("uz", " toʻrt ", "uz-UZ-MadinaNeural")).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="uz-UZ">' +
        '<voice name="uz-UZ-MadinaNeural"><mstts:silence type="Leading-exact" value="0ms"/><mstts:silence type="Tailing-exact" value="0ms"/>' +
        "toʻrt</voice></speak>"
    );
    expect(buildSsml("ru", "Пройдите на приём.", "ru-RU-SvetlanaNeural")).toContain('xml:lang="ru-RU"><voice name="ru-RU-SvetlanaNeural">');
  });

  it("escapes XML special characters, including an ASCII apostrophe", () => {
    expect(escapeXml(`A & B <C> "d" o'n`)).toBe("A &amp; B &lt;C&gt; &quot;d&quot; o&apos;n");
    expect(buildSsml("uz", "o'n <1>", "v")).toContain(">o&apos;n &lt;1&gt;</voice>");
  });

  it("rejects an unknown language", () => {
    expect(() => buildSsml("en", "one", "en-US-JennyNeural")).toThrow('Unknown language "en"');
  });
});

describe("voices and flags", () => {
  it("uses the default neural voices unless AZURE_VOICE_UZ / AZURE_VOICE_RU are set", () => {
    expect(voiceFor("uz", {})).toBe(DEFAULT_VOICES.uz);
    expect(voiceFor("ru", { AZURE_VOICE_RU: "  " })).toBe("ru-RU-SvetlanaNeural");
    expect(voiceFor("uz", { AZURE_VOICE_UZ: "uz-UZ-SardorNeural" })).toBe("uz-UZ-SardorNeural");
  });

  it("parses --dry-run, --force and --only, and refuses anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, force: false, only: null });
    expect(parseArgs(["--dry-run", "--force", "--only=ru"])).toEqual({ dryRun: true, force: true, only: "ru" });
    expect(() => parseArgs(["--only=en"])).toThrow('--only must be uz or ru, got "en"');
    expect(() => parseArgs(["--dryrun"])).toThrow('Unknown argument "--dryrun"');
  });

  it("builds the regional endpoint and refuses a malformed region", () => {
    expect(ttsEndpoint("westeurope")).toBe("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(() => ttsEndpoint("evil.example.com/x")).toThrow("AZURE_SPEECH_REGION");
  });
});

describe("planClips", () => {
  const small = { uz: { "1": "bir", navbat_raqami: "Navbat raqami" }, ru: { "1": "один", nomer: " Номер " } };

  it("lists uz before ru in catalogue order with trimmed text", () => {
    expect(planClips(small)).toEqual([
      { lang: "uz", id: "1", text: "bir", file: "uz/1.mp3" },
      { lang: "uz", id: "navbat_raqami", text: "Navbat raqami", file: "uz/navbat_raqami.mp3" },
      { lang: "ru", id: "1", text: "один", file: "ru/1.mp3" },
      { lang: "ru", id: "nomer", text: "Номер", file: "ru/nomer.mp3" },
    ]);
  });

  it("skips existing files unless forced, and filters by language", () => {
    const existing = new Set(["uz/1.mp3", "ru/nomer.mp3"]);
    expect(planClips(small, { existing }).map((clip) => clip.file)).toEqual(["uz/navbat_raqami.mp3", "ru/1.mp3"]);
    expect(planClips(small, { existing, force: true })).toHaveLength(4);
    expect(planClips(small, { only: "ru" }).map((clip) => clip.file)).toEqual(["ru/1.mp3", "ru/nomer.mp3"]);
  });

  it("refuses ids that are not safe file names, empty texts and a malformed catalogue", () => {
    expect(() => planClips({ uz: { "../x": "a" }, ru: {} })).toThrow('clip id "uz/../x"');
    expect(() => planClips({ uz: { "1": " " }, ru: {} })).toThrow('clip "uz/1" has no text');
    expect(() => planClips({ uz: {} })).toThrow('"ru" must be an object');
    expect(() => planClips([])).toThrow("voiceClips.json must be an object");
  });
});

describe("the real catalogue (src/modules/queue/tv/voiceClips.json)", () => {
  const range = (from, to, step) => Array.from({ length: (to - from) / step + 1 }, (_, i) => String(from + i * step));

  it("has exactly the 69 clips the TV plays", () => {
    expect(Object.keys(catalogue.uz).sort()).toEqual(
      [...range(1, 9, 1), ...range(10, 90, 10), ...range(100, 900, 100), "navbat_raqami", "xona_raqami", "qabulga_marhamat"].sort()
    );
    expect(Object.keys(catalogue.ru).sort()).toEqual(
      [...range(1, 19, 1), ...range(20, 90, 10), ...range(100, 900, 100), "nomer", "proydite_v_kabinet_nomer", "proydite_na_priyom"].sort()
    );
    const clips = planClips(catalogue);
    expect(clips).toHaveLength(69);
    expect(clips[0]).toMatchObject({ file: "uz/1.mp3", text: "bir" });
  });

  it("writes Uzbek oʻ with U+02BB, never an ASCII or typographic apostrophe", () => {
    const uzTexts = Object.values(catalogue.uz);
    expect(uzTexts.filter((text) => /['‘’]/.test(text))).toEqual([]);
    expect(uzTexts.filter((text) => text.includes("ʻ"))).toHaveLength(7);
  });
});

describe("retryDelayMs", () => {
  it("honours Retry-After in seconds or as an HTTP date, else backs off 2, 4, 8 … s", () => {
    expect(retryDelayMs(1, "7")).toBe(7000);
    expect(retryDelayMs(1, "Wed, 30 Sep 2026 10:00:05 GMT", Date.parse("2026-09-30T10:00:00Z"))).toBe(5000);
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, null))).toEqual([2000, 4000, 8000, 16000, 32000]);
  });
});

describe("synthesizeClip", () => {
  it("posts SSML with the key header and returns the mp3 bytes", async () => {
    const fetchImpl = vi.fn(async () => reply(200, { body: "ID3-mp3" }));
    const audio = await synth(fetchImpl);
    expect(audio.toString()).toBe("ID3-mp3");
    expect(fetchImpl).toHaveBeenCalledWith("https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1", {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": "test-key",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "clinic-crm-queue-voice",
      },
      body: "<speak/>",
    });
  });

  it("waits Retry-After on 429 and then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(429, { headers: { "retry-after": "3" } })).mockResolvedValueOnce(reply(200, { body: "ok" }));
    const sleep = vi.fn(async () => {});
    expect((await synth(fetchImpl, sleep)).toString()).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("gives up after 5 retries of a 5xx", async () => {
    const fetchImpl = vi.fn(async () => reply(503, { body: "busy" }));
    const sleep = vi.fn(async () => {});
    await expect(synth(fetchImpl, sleep)).rejects.toThrow("Azure TTS failed with HTTP 503: busy");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it("retries a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(reply(200, { body: "ok" }));
    expect((await synth(fetchImpl)).toString()).toBe("ok");
  });

  it("explains a 401 at once, without retrying", async () => {
    const fetchImpl = vi.fn(async () => reply(401));
    await expect(synth(fetchImpl)).rejects.toThrow('Azure rejected the key (HTTP 401). Check AZURE_SPEECH_KEY and that AZURE_SPEECH_REGION ("westeurope")');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails without retry on another 4xx, and on empty audio", async () => {
    await expect(synth(vi.fn(async () => reply(400, { body: "bad SSML" })))).rejects.toThrow("HTTP 400: bad SSML");
    await expect(synth(vi.fn(async () => reply(200)))).rejects.toThrow("empty audio");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run scripts/queueVoice.test.mjs`
Expected: FAIL. The suite fails to load with `Error: Cannot find module './queueVoice.mjs' imported from '…/apps/web/scripts/queueVoice.test.mjs'` (`Caused by: Error: Failed to load url ./queueVoice.mjs … Does the file exist?`).

- [ ] **Step 3: Implement the helpers**

Gotchas:
- Every clip is its own SSML document with `mstts:silence` Leading-exact/Tailing-exact `0ms`, so the TV can schedule clips back to back without gaps.
- An ASCII `'` must become `&apos;`. U+02BB needs no escaping.
- Clip ids become file names, so anything outside `[a-z0-9_]` is refused. This blocks a path like `../x`.
- The region is validated because it is interpolated into the URL.

Create `apps/web/scripts/queueVoice.mjs`:
```js
/**
 * Pure helpers of scripts/generate-queue-voice.mjs: Azure neural TTS → public/queue-voice/<lang>/<id>.mp3.
 * No file system and no global fetch here, so vitest checks them directly (see queueVoice.test.mjs).
 */

export const LANGS = ["uz", "ru"];
export const DEFAULT_VOICES = { uz: "uz-UZ-MadinaNeural", ru: "ru-RU-SvetlanaNeural" };
export const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
/** Free tier F0 allows 20 requests per 60 s: one request every 3.5 s stays under it (69 clips ≈ 4 min). */
export const THROTTLE_MS = 3500;
/** 429 and 5xx are retried up to this many times (6 attempts in total). */
export const MAX_RETRIES = 5;

const XML_LANG = { uz: "uz-UZ", ru: "ru-RU" };
const VOICE_ENV = { uz: "AZURE_VOICE_UZ", ru: "AZURE_VOICE_RU" };
const CLIP_ID = /^[a-z0-9_]+$/;
const REGION = /^[a-z0-9]+$/;

function assertLang(lang) {
  if (!LANGS.includes(lang)) throw new Error(`Unknown language "${lang}" (expected uz or ru)`);
}

/** XML-escapes text for SSML. U+02BB (oʻ) needs no escaping; an ASCII apostrophe becomes &apos;. */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * One clip = one SSML document. Leading/trailing silence is forced to 0 ms so the TV can play clips back to back
 * ("Navbat raqami" + "yigirma" + "yetti" …) without audible gaps.
 */
export function buildSsml(lang, text, voice) {
  assertLang(lang);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${XML_LANG[lang]}">` +
    `<voice name="${escapeXml(voice)}">` +
    `<mstts:silence type="Leading-exact" value="0ms"/>` +
    `<mstts:silence type="Tailing-exact" value="0ms"/>` +
    escapeXml(String(text).trim()) +
    `</voice></speak>`
  );
}

/** Voice for a language: AZURE_VOICE_UZ / AZURE_VOICE_RU when set, else the default neural voice. */
export function voiceFor(lang, env = {}) {
  assertLang(lang);
  const custom = typeof env[VOICE_ENV[lang]] === "string" ? env[VOICE_ENV[lang]].trim() : "";
  return custom || DEFAULT_VOICES[lang];
}

/** CLI flags: --dry-run, --force, --only=uz|ru. Anything else is an error (a typo must not start a paid run). */
export function parseArgs(argv) {
  const options = { dryRun: false, force: false, only: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--only=")) {
      const lang = arg.slice("--only=".length);
      if (!LANGS.includes(lang)) throw new Error(`--only must be uz or ru, got "${lang}"`);
      options.only = lang;
    } else throw new Error(`Unknown argument "${arg}". Use --dry-run, --force, --only=uz|ru`);
  }
  return options;
}

/**
 * Clips to synthesize from the catalogue { uz: { id: text }, ru: { id: text } }: uz first, then ru, catalogue order.
 * `existing` holds "<lang>/<id>.mp3" paths already on disk; they are skipped unless `force`.
 * Ids become file names, so only [a-z0-9_] is accepted.
 */
export function planClips(catalogue, { only = null, existing = new Set(), force = false } = {}) {
  if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue)) {
    throw new Error('voiceClips.json must be an object { "uz": { … }, "ru": { … } }');
  }
  const clips = [];
  for (const lang of LANGS) {
    const entries = catalogue[lang];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(`voiceClips.json: "${lang}" must be an object of clip id → text`);
    }
    if (only && only !== lang) continue;
    for (const [id, text] of Object.entries(entries)) {
      if (!CLIP_ID.test(id)) throw new Error(`voiceClips.json: clip id "${lang}/${id}" may contain only a-z, 0-9 and _`);
      if (typeof text !== "string" || text.trim() === "") throw new Error(`voiceClips.json: clip "${lang}/${id}" has no text`);
      const file = `${lang}/${id}.mp3`;
      if (!force && existing.has(file)) continue;
      clips.push({ lang, id, text: text.trim(), file });
    }
  }
  return clips;
}

/** Regional TTS endpoint; the region is the short name of the Speech resource (westeurope, eastus, …). */
export function ttsEndpoint(region) {
  if (!REGION.test(region)) throw new Error(`AZURE_SPEECH_REGION must be a region name like westeurope, got "${region}"`);
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export const isRetryableStatus = (status) => status === 429 || status >= 500;

/** Delay before retry number `attempt` (1-based): Retry-After (seconds or HTTP date) when given, else 2, 4, 8, 16, 32 s. */
export function retryDelayMs(attempt, retryAfter, nowMs = Date.now()) {
  const value = retryAfter == null ? "" : String(retryAfter).trim();
  if (value !== "") {
    if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - nowMs);
  }
  return Math.min(2000 * 2 ** (attempt - 1), 60_000);
}

/**
 * Synthesizes one SSML document and returns the mp3 bytes. 401/403 fail at once with a hint (wrong key or region);
 * 429, 5xx and network errors are retried up to `maxRetries` times; other statuses fail with Azure's message.
 */
export async function synthesizeClip({ fetchImpl, region, key, ssml, sleep, onRetry = () => {}, maxRetries = MAX_RETRIES }) {
  const url = ttsEndpoint(region);
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
          "User-Agent": "clinic-crm-queue-voice",
        },
        body: ssml,
      });
    } catch (error) {
      if (attempt > maxRetries) throw new Error(`Azure TTS is unreachable: ${error.message}`);
      const waitMs = retryDelayMs(attempt, null);
      onRetry({ attempt, status: 0, waitMs });
      await sleep(waitMs);
      continue;
    }
    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) throw new Error("Azure TTS returned empty audio (check the voice name)");
      return audio;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Azure rejected the key (HTTP ${response.status}). Check AZURE_SPEECH_KEY and that AZURE_SPEECH_REGION ("${region}") is the region of that Speech resource.`
      );
    }
    if (isRetryableStatus(response.status) && attempt <= maxRetries) {
      const waitMs = retryDelayMs(attempt, response.headers.get("retry-after"));
      onRetry({ attempt, status: response.status, waitMs });
      await sleep(waitMs);
      continue;
    }
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new Error(`Azure TTS failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run scripts/queueVoice.test.mjs`
Expected: PASS — `Tests  18 passed (18)`. The catalogue tests read the real `src/modules/queue/tv/voiceClips.json` from Task 11. If they fail, the catalogue deviates from the contract (§9 Task 11); fix the catalogue, not the test.

- [ ] **Step 5: Write the failing CLI tests**

In `apps/web/scripts/queueVoice.test.mjs` replace:
```js
  it("fails without retry on another 4xx, and on empty audio", async () => {
    await expect(synth(vi.fn(async () => reply(400, { body: "bad SSML" })))).rejects.toThrow("HTTP 400: bad SSML");
    await expect(synth(vi.fn(async () => reply(200)))).rejects.toThrow("empty audio");
  });
});
```
with:
```js
  it("fails without retry on another 4xx, and on empty audio", async () => {
    await expect(synth(vi.fn(async () => reply(400, { body: "bad SSML" })))).rejects.toThrow("HTTP 400: bad SSML");
    await expect(synth(vi.fn(async () => reply(200)))).rejects.toThrow("empty audio");
  });
});

describe("generate-queue-voice.mjs CLI", () => {
  // The Azure variables are blanked so a developer's shell key can never reach the network from a test.
  const runCli = (args) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, AZURE_SPEECH_KEY: "", AZURE_SPEECH_REGION: "" } });

  it("--dry-run --force lists all 69 clips without a key", () => {
    const result = runCli(["--dry-run", "--force"]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines.filter((line) => line.startsWith("[voice] would generate "))).toHaveLength(69);
    expect(lines[0]).toBe("[voice] would generate public/queue-voice/uz/1.mp3  <-  bir");
    expect(lines.at(-1)).toBe("[voice] Dry run: 69 clip(s), about 5 min with a key.");
  });

  it("refuses to run without AZURE_SPEECH_KEY / AZURE_SPEECH_REGION", () => {
    const result = runCli(["--force"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[voice] Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this shell first");
  });

  it("refuses an unknown flag", () => {
    const result = runCli(["--only=en"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--only must be uz or ru, got "en"');
  });
});
```

- [ ] **Step 6: Run the test to verify the CLI part fails**

Run: `cd apps/web && npx vitest run scripts/queueVoice.test.mjs`
Expected: FAIL — `Tests  3 failed | 18 passed (21)`. The child `node` process cannot find `generate-queue-voice.mjs`:
- `--dry-run --force lists all 69 clips without a key` fails with `expected 1 to be +0`;
- the two refusal tests fail with `expected 'node:internal/modules/cjs/loader…' to contain '[voice] Set AZURE_SPEECH_KEY…'` and `… to contain '--only must be uz or ru, got "en"'`.

- [ ] **Step 7: Implement the CLI, the npm script and the .gitignore entry**

Gotchas:
- **Order of checks.** The key is checked only after the plan is computed, and `--dry-run` returns before that check. A dry run therefore never needs a key and never touches the network.
- **Atomic writes.** Each mp3 is written to `<file>.part` and then renamed. An interrupted run can never leave a truncated clip that later counts as "existing".
- **Throttle.** Requests are spaced by `THROTTLE_MS`, because the Azure F0 tier allows 20 requests per 60 s.

Create `apps/web/scripts/generate-queue-voice.mjs`:
```js
/**
 * One-time generation of the TV announcement clips with Azure neural TTS (see docs/queue.md, «Голос»).
 *   reads   src/modules/queue/tv/voiceClips.json   { "uz": { id: text }, "ru": { id: text } }
 *   writes  public/queue-voice/<lang>/<id>.mp3     (committed; until they exist the TV plays only the chime)
 * Usage, from apps/web:
 *   npm run voice:generate -- --dry-run     list what would be generated — no key, no network
 *   npm run voice:generate                  generate the missing clips
 *   npm run voice:generate -- --force       regenerate every clip
 *   npm run voice:generate -- --only=uz     one language only
 * Environment (process env only; the key never goes into a file of the repo):
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, optional AZURE_VOICE_UZ (uz-UZ-MadinaNeural), AZURE_VOICE_RU (ru-RU-SvetlanaNeural).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, THROTTLE_MS, buildSsml, parseArgs, planClips, synthesizeClip, voiceFor } from "./queueVoice.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGUE = path.join(ROOT, "src/modules/queue/tv/voiceClips.json");
const OUT_DIR = path.join(ROOT, "public/queue-voice");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "<lang>/<id>.mp3" of the non-empty clips already generated. */
function existingClips() {
  const files = new Set();
  for (const lang of LANGS) {
    const dir = path.join(OUT_DIR, lang);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".mp3") && fs.statSync(path.join(dir, name)).size > 0) files.add(`${lang}/${name}`);
    }
  }
  return files;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
  const clips = planClips(catalogue, { only: options.only, existing: existingClips(), force: options.force });
  if (clips.length === 0) {
    console.log("[voice] Nothing to generate: every clip exists (use --force to regenerate).");
    return;
  }
  if (options.dryRun) {
    for (const clip of clips) console.log(`[voice] would generate public/queue-voice/${clip.file}  <-  ${clip.text}`);
    console.log(`[voice] Dry run: ${clips.length} clip(s), about ${Math.ceil((clips.length * THROTTLE_MS) / 60000)} min with a key.`);
    return;
  }
  const key = (process.env.AZURE_SPEECH_KEY ?? "").trim();
  const region = (process.env.AZURE_SPEECH_REGION ?? "").trim().toLowerCase();
  if (!key || !region) {
    throw new Error("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this shell first (docs/queue.md), or run with --dry-run.");
  }
  for (const [index, clip] of clips.entries()) {
    if (index > 0) await sleep(THROTTLE_MS);
    const voice = voiceFor(clip.lang, process.env);
    const audio = await synthesizeClip({
      fetchImpl: fetch,
      region,
      key,
      ssml: buildSsml(clip.lang, clip.text, voice),
      sleep,
      onRetry: ({ attempt, status, waitMs }) =>
        console.warn(`[voice] ${clip.file}: ${status ? `HTTP ${status}` : "network error"}, retry ${attempt} in ${Math.round(waitMs / 1000)} s`),
    });
    const target = path.join(OUT_DIR, clip.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Write next to the target and rename, so an interrupted run never leaves a half-written mp3 that looks "existing".
    fs.writeFileSync(`${target}.part`, audio);
    fs.renameSync(`${target}.part`, target);
    console.log(`[voice] ${index + 1}/${clips.length} ${clip.file} (${audio.length} bytes, ${voice})  <-  ${clip.text}`);
  }
  console.log(`[voice] Done: ${clips.length} clip(s) in public/queue-voice. Listen to them (especially uz with "oʻ") before committing.`);
}

main().catch((error) => {
  console.error(`[voice] ${error.message}`);
  process.exitCode = 1;
});
```

In `apps/web/package.json` replace:
```json
    "test": "vitest run"
```
with:
```json
    "test": "vitest run",
    "voice:generate": "node scripts/generate-queue-voice.mjs"
```

Append `.env.local` to `apps/web/.gitignore`. Run from the repo root in Git Bash. The one-liner keeps the file's CRLF endings and adds the missing final newline. It deliberately contains no `!`: an interactive Git Bash expands `!…` inside double quotes (history expansion) and would stop with `event not found`.
```bash
node -e "const fs=require('fs');const f='apps/web/.gitignore';const s=fs.readFileSync(f,'utf8');const eol=s.includes('\r\n')?'\r\n':'\n';if(s.split(/\r?\n/).indexOf('.env.local')<0)fs.writeFileSync(f,s+(s.endsWith('\n')?'':eol)+'.env.local'+eol)"
```

- [ ] **Step 8: Run the tests and the CLI to verify they pass**

Run: `cd apps/web && npx vitest run scripts/queueVoice.test.mjs`
Expected: PASS — `Tests  21 passed (21)`.

Run: `cd apps/web && npm run voice:generate -- --dry-run`
Expected: exit code 0 and, after npm's own `> clinic-crm-web@0.1.0 voice:generate` banner, 70 `[voice]` lines, with no key and no network:
- first line: `[voice] would generate public/queue-voice/uz/1.mp3  <-  bir`;
- the uz clips come first, then ru;
- last line: `[voice] Dry run: 69 clip(s), about 5 min with a key.`

If clips were already generated, only the missing ones are listed. `[voice] Nothing to generate: every clip exists (use --force to regenerate).` means all are present.

Run: `git check-ignore -v apps/web/.env.local`
Expected: `apps/web/.gitignore:4:.env.local	apps/web/.env.local`

Run: `cd apps/web && npm test && npm run typecheck`
Expected: PASS — 39 test files, 244 tests, 0 failed, including `scripts/queueVoice.test.mjs (21 tests)`. Typecheck exits 0 with no output.

- [ ] **Step 9: Commit**

```bash
git add apps/web/scripts/queueVoice.mjs apps/web/scripts/queueVoice.test.mjs apps/web/scripts/generate-queue-voice.mjs apps/web/package.json apps/web/.gitignore && git commit -m "feat(web): queue voice clip generator (Azure neural TTS)"
```

**One-time generation (MANUAL, done by the user at the end of Task 14).** The executor never types, stores or echoes the key. The user runs this in their own PowerShell window:
```powershell
# 1) portal.azure.com → Create a resource → "Speech" → Pricing tier Free F0, region e.g. West Europe → Create.
# 2) Resource → "Keys and Endpoint" → copy KEY 1 and the Location/Region (e.g. westeurope).
cd "C:\Users\user\Desktop\kamilovs CRM 1\apps\web"
$env:AZURE_SPEECH_KEY = "<KEY 1 from the portal>"
$env:AZURE_SPEECH_REGION = "westeurope"
npm run voice:generate -- --dry-run      # 69 clips listed, no network
npm run voice:generate                   # ~5 min (F0: max 20 requests/min); 401 → wrong key or region
Remove-Item Env:AZURE_SPEECH_KEY, Env:AZURE_SPEECH_REGION
```
- **Other voices.** Set `$env:AZURE_VOICE_UZ = "uz-UZ-SardorNeural"` or `$env:AZURE_VOICE_RU = "ru-RU-DmitryNeural"`.
- **Partial runs.** `--only=uz` or `--only=ru` generates one language. `--force` regenerates everything.
- **Listening check.** Listen especially to the seven uz clips with oʻ: `uz/4`, `9`, `10`, `30`, `90`, `400`, `900`. If one is mispronounced, first try the other Uzbek voice (`AZURE_VOICE_UZ`, above) with `--force --only=uz`. If you respell the word instead, two tests pin the exact spelling (seven U+02BB texts, no `'`/`‘`/`’` in any uz text), so change the catalogue and both tests in the same commit. Example for `uz/10`, «oʻn» → «o'n» (the SSML builder escapes the ASCII `'` as `&apos;`); for another clip use its id and text the same way:
  1. `apps/web/src/modules/queue/tv/voiceClips.json`:
     ```diff
     -    "10": "oʻn",
     +    "10": "o'n",
     ```
  2. `apps/web/src/modules/queue/tv/voicePhrases.test.ts` (Task 11), test «writes the Uzbek oʻ with U+02BB and never with an ASCII or typographic quote»: drop the id from the U+02BB list and allow the ASCII apostrophe for that id only.
     ```diff
     -    for (const id of ["4", "9", "10", "30", "90", "400", "900"]) expect(clips.uz[id]).toContain("\u02BB");
     +    for (const id of ["4", "9", "30", "90", "400", "900"]) expect(clips.uz[id]).toContain("\u02BB");
          expect(clips.uz["4"]).toBe("to\u02BBrt");
     -    for (const text of Object.values(clips.uz)) expect(text).not.toMatch(/['\u2018\u2019]/);
     +    for (const [id, text] of Object.entries(clips.uz)) expect(text).not.toMatch(id === "10" ? /[\u2018\u2019]/ : /['\u2018\u2019]/);
     ```
  3. `apps/web/scripts/queueVoice.test.mjs` (this task), test «writes Uzbek oʻ with U+02BB, never an ASCII or typographic apostrophe»: the respelled text is the one expected apostrophe, and six texts keep U+02BB.
     ```diff
     -    expect(uzTexts.filter((text) => /['‘’]/.test(text))).toEqual([]);
     -    expect(uzTexts.filter((text) => text.includes("ʻ"))).toHaveLength(7);
     +    expect(uzTexts.filter((text) => /['‘’]/.test(text))).toEqual(["o'n"]);
     +    expect(uzTexts.filter((text) => text.includes("ʻ"))).toHaveLength(6);
     ```
  4. Check, then regenerate only that clip (PowerShell in `apps\web`, key and region still set):
     ```powershell
     npx vitest run src/modules/queue/tv/voicePhrases.test.ts scripts/queueVoice.test.mjs   # PASS: 2 files, 45 tests
     Remove-Item public\queue-voice\uz\10.mp3
     npm run voice:generate -- --only=uz --dry-run   # one clip: "[voice] would generate public/queue-voice/uz/10.mp3  <-  o'n", then "Dry run: 1 clip(s)"
     npm run voice:generate -- --only=uz
     ```
     Without `--force` the script voices only missing files, so this re-records just `uz/10.mp3`. `--force --only=uz` would also work but re-records all 30 Uzbek clips.

---

### Task 14: Local preview stand, docs, full verification

This task adds tooling and documentation only; it adds no production code. The self-check `node services/api/scripts/queue-preview.cjs --smoke` is its test: it drives the real routers of Tasks 1–5 over HTTP against an in-memory PGlite. If a smoke check fails, the defect is in the task that owns that behaviour. Fix it there, with a regression test in that task's test file, and rerun. Never loosen the smoke expectation to make it pass.

**Files:**
- Create: `services/api/scripts/queue-preview.cjs`
- Create: `docs/queue.md`
- Modify: `docs/superpowers/specs/2026-09-30-electronic-queue-design.md` (append after the last line, line 230 `**Оборудование:** …`)
- Create: `HANDOFF.md` (repo root). No `HANDOFF.md` exists on `main`, `origin/main` or this branch. If one appeared meanwhile, overwrite it: it always describes the latest state.
- Optional (manual step 9): `apps/web/public/queue-voice/{uz,ru}/*.mp3`

**Interfaces:**
- Consumes:
  - API: `clinicToday` and `addDays` (`services/queue/queueRules.ts`, Task 1); migration `035_electronic_queue.sql` (Task 1) and `033_call_center_daily_workflow.sql`; `PostgresAppointmentsRepository` / `AppointmentsService(repo, timeZone)` with queue issuing on `arrived` (Task 3); `PostgresDoctorsRepository` with `room` / `queue_prefix` (Task 2).
  - Queue services: `PostgresQueueRepository(pool)`, `QueueService(repo, timeZone)` with `callNext(auth, doctorId) → { entry }`, and `queueRouter` from `routes/queueRoutes.ts` with `POST /appointments/:id/issue` (Task 4). `PostgresQueueDisplaysRepository(pool)`, `QueueDisplaysService(displays, queue, timeZone)` with `create(auth, body) → { display, code }`, and `publicRouter` from `routes/publicRoutes.ts` (Task 5).
  - Existing modules: `appointmentsRouter`, `doctorsRouter`, `patientsRouter`, `servicesRouter`, `DoctorsService(doctors, services)`, `PatientsService(patients, appointments)`, `ServicesService(services)`, `runWithClinicContext`, `requireAuth`, `errorHandler`, `signAccessToken`.
  - Web: `/queue`, `/appointments`, `/doctors`, `/tv`, `/tv/:code` (Tasks 6–12) and `npm run voice:generate` (Task 13).
- Produces:
  - `services/api/scripts/queue-preview.cjs`: API on `http://127.0.0.1:4401`, and `--smoke` → prints `[smoke] 22 checks passed` and exits 0.
  - `docs/queue.md`; the spec section `## Уточнения при планировании`; `HANDOFF.md`.

- [ ] **Step 1: Write the preview stand with its built-in smoke test**

The stand follows `services/api/scripts/call-center-preview.cjs`: it transpiles TS on the fly and intercepts `config/env`, `config/database` and `container`. Gotchas below were verified by running this file against the repository with Tasks 1–5 applied (also with the Node time zone set to UTC, America/Los_Angeles and Pacific/Kiritimati, and from a path with spaces):
- **Re-entrant gate instead of the plain PGlite gate.** `PostgresServicesRepository.create` calls `this.findById()` (through `dbPool.query`) *before* it releases its transaction client. Under the plain gate of the call-center stand, «создать услугу» hangs forever; this was reproduced. A per-request `AsyncLocalStorage` flag lets the request that holds the only connection keep querying. Other requests still wait.
- **Where the per-request store starts.** It is set up **after** `express.json()`. Body parsing finishes in the socket's async context, so a store created earlier would be lost.
- **Container getter.** `container` is returned as a getter (`{ get services() {…} }`), so controllers always see the assigned `services` object.
- **Time zone.** `SET TIME ZONE '<Node zone>'` runs first. `start_at` stores clinic wall-clock time and round-trips only when the DB session and Node share a zone, as in production and in `PostgresAppointmentsRepository.test.ts`. Seeded slots are string literals for `clinicToday("Asia/Tashkent")`, the same day the services compute.
- **Real seeding path.** Visits are inserted as `scheduled` and then moved through the **real** `AppointmentsService.update` and `QueueService.callNext`. The numbers therefore come from the real allocation path (Task 3).
- **Slots.** Each doctor's slots are 30 minutes and never overlap; otherwise `ensureNoDoctorConflict` answers 409 on the status change.
- **Pre-release arrivals.** Visits 304 (today) and 108 (yesterday) are inserted directly as `arrived` with no number, like visits marked «Пришёл» before this release. They are the «Выдать номер» cases of Tasks 4 and 8; the real path would already have numbered 304.
- **Sequences.** `setval(…, 1000)` keeps rows created later in the UI (bigserial) from colliding with the seeded ids.
- **Exit.** No `process.exit()`. On Windows it aborted with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after `fetch`, which was reproduced. `process.exitCode` is set and the loop drains in about 4 s.

Create `services/api/scripts/queue-preview.cjs`:
```js
/* Local, disposable preview of the electronic queue and the TV screen. No .env, pg connection, production token or persistent database.
 * Run:     node services/api/scripts/queue-preview.cjs           → API on http://127.0.0.1:4401 until Ctrl+C
 *          node services/api/scripts/queue-preview.cjs --smoke   → HTTP self-check of the seeded day, then exit (code 0 = OK)
 * Web:     $env:VITE_API_URL='http://127.0.0.1:4401'; npm run dev --prefix apps/web -- --host 127.0.0.1 --port 5175
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
  check("TV sees the new call first with key 104:1", afterCall.body.recentCalls[0]?.code === "К-04" && afterCall.body.recentCalls[0]?.key === "104:1", afterCall.body.recentCalls[0]);
  const ticket = await call("reception", "/api/queue/appointments/106/ticket");
  check("ticket К-06: кабинет 3, 2 ahead", ticket.status === 200 && ticket.body.code === "К-06" && ticket.body.room === "3" && ticket.body.aheadCount === 2 && ticket.body.clinicName === "Тестовая клиника", ticket.body);
  const back = await call("reception", "/api/appointments/103", "PUT", { status: "arrived" });
  check("missed К-03 returns to the end of the queue as К-07", back.status === 200 && back.body.queueCode === "К-07", back.body);
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
  console.log(`Web: $env:VITE_API_URL='http://127.0.0.1:${PORT}'; npm run dev --prefix apps/web -- --host 127.0.0.1 --port 5175`);
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
```

- [ ] **Step 2: Run the smoke test**

Run (from the repo root): `node services/api/scripts/queue-preview.cjs --smoke; echo "exit=$?"`
Expected: PASS. The output is:
- the 5 banner lines: API, accounts, the web command, and the 2 TV links with random codes;
- 22 lines starting `[smoke] ok  `, from `reception sees 4 cabinets ordered by room (3, 5, 7, no room)` to `superadmin lists 2 screens`. They include `«Выдать номер» gives Н-03 to a visit marked «Пришёл» without a number`, `«Выдать номер» refuses yesterday's visit` and `unknown TV code → 404 JSON, not cached, rate-limited`;
- `[smoke] 22 checks passed` and `exit=0`, within about 5 s.

If you get `[smoke] FAIL <name>: <json>`, read the JSON: it is the actual response. Compare it with the contract (§3 types, §6/§7 rules) and fix the owning task (see the task intro).

- [ ] **Step 3: Write the user documentation**

Create `docs/queue.md` (Russian; follows the tone of `docs/call-center.md`). Quoted staff labels are verbatim ru locale strings: `queue.displays.*` and `queue.displays.form.*` (Task 9), `queue.actions.*` and `queue.cabinet.missed` (Task 10), `appointments.queue.*` (Task 8), `doctors.room*` / `doctors.queuePrefix` (Task 7), plus the existing `appointment.markArrived` and `common.edit` / `common.delete` / `common.save`. TV texts are the bilingual constants of Tasks 11–12. The role table follows `CabinetQueueCard` permissions (Task 10): `canCallQueue` roles call, start, mark missed and complete; `canIssueQueue` (reception, superadmin) returns missed patients; «Открыть приём» needs `canCallQueue` and `DOCTOR_WORKSPACE_ROLES`.
````markdown
# Электронная очередь и ТВ-экран

Каждый пришедший пациент получает номер в очереди своего врача (`К-05`). Врач, медсестра или регистратура вызывают пациентов по номеру, а телевизор в холле показывает очереди кабинетов и объявляет вызов сигналом и голосом на узбекском и русском. Устройство и решения — в спецификации `docs/superpowers/specs/2026-09-30-electronic-queue-design.md`.

## Как работает очередь

- **Номер выдаётся сам.** Когда регистратура нажимает «Отметить приход» у записи на сегодня, запись получает следующий номер у своего врача.
  - В «Записях» появляется «Выдан номер К-05» с кнопкой «Печать талона». Позже талон печатается кнопкой «Талон»: она есть у записи в статусе «Пришёл» с номером.
  - На главной странице после «Отметить приход» на пару секунд появляется то же уведомление «Выдан номер К-05». Талон печатается из «Записей».
  - Записи на другие дни отмечаются как раньше, без номера.
- **«Выдать номер».** Запись в статусе «Пришёл» без номера (например, отмеченная до выхода очереди) получает номер кнопкой «Выдать номер» на карточке записи. Кнопка есть у регистратуры и суперадмина. Номер выдаётся только записи на сегодня; для другого дня появится ошибка «Запись не на сегодня».
- **Код талона** — буква врача и номер из двух и более цифр: `К-05`, `К-123`; без буквы — `07`. Счёт у каждого врача свой и начинается с 1 каждый день (по времени клиники, `REPORTS_TIMEZONE`, по умолчанию Asia/Tashkent). Номер отменённой записи повторно не выдаётся. Пациент, записанный к двум врачам, получает два номера.
- **Страница «Очередь»** (`/queue`, пункт меню «Очередь») обновляется каждые 5 секунд:
  - «Вызвать следующего · К-06» вызывает наименьший номер среди ждущих. Ждущего можно вызвать и вне порядка кнопкой «Вызвать»;
  - у вызванного пациента есть «Начать приём», «Повторить вызов» (объявляет вызов ещё раз) и «Не пришёл»;
  - у пациента на приёме есть «Завершить приём» и «Открыть приём» (карточка приёма);
  - пропустившие видны в списке «Не пришли». «Вернуть в очередь» даёт пациенту **новый** номер в конце очереди (только для записи на сегодня).
- **Кто что видит.**

  | Роль | Кабинеты | Кнопки на странице «Очередь» |
  |---|---|---|
  | Регистратура | все | «Вызвать следующего», «Вызвать», «Повторить вызов», «Начать приём», «Не пришёл», «Завершить приём», «Вернуть в очередь» |
  | Врач | только свой | «Вызвать следующего», «Вызвать», «Повторить вызов», «Начать приём», «Не пришёл»; у пациента на приёме — «Завершить приём» и «Открыть приём» |
  | Медсестра | кабинет своего врача | те же, что у врача |
  | Менеджер, директор | все | нет, только просмотр |
  | Суперадмин | все | все кнопки регистратуры, «Открыть приём» и «Экраны» |

  В «Записях» кнопку «Талон» видят все эти роли, а «Выдать номер» — регистратура и суперадмин.
- **Смена врача или даты.** Если у записи с номером сменить врача, пришедший сегодня пациент получает номер у нового врача. Если перенести запись на другой день, номер снимается.
- **Полночь.** Очередь нового дня пуста. Вчерашние ждущие в неё не попадают.

## Кабинет и буква врача

«Врачи» → карточка врача:

- **Кабинет** — до 20 символов, например `5` или `2Б`. Голос называет номер кабинета, если это число от 1 до 999. Иначе, и если кабинет не указан, звучит «Qabulga marhamat / Пройдите на приём», а на ТВ показывается «Кабинет —».
- **Буква очереди** — необязательная, одна буква, приводится к заглавной (`к` → `К`). Буква, набранная поверх старой, заменяет её. Буква не озвучивается: кабинет и так однозначно указывает очередь. Уже напечатанные талоны сохраняют ту букву, с которой их выдали.

На карточке врача это выглядит как «Кабинет 5 · К».

## ТВ-экран

### Создать экран (суперадмин)

1. «Очередь» → «Экраны» → «Новый экран».
2. «Название» — например, «Холл, 1 этаж».
3. «Какие кабинеты показывать»:
   - «Всех врачей, у кого сегодня есть очередь» (по умолчанию);
   - «Только выбранных врачей» — отметьте врачей в списке, рядом с каждым видно «Кабинет N» или «Кабинет не указан». Если не отметить ни одного, при сохранении появится «Выберите хотя бы одного врача».
4. «Язык надписей и голоса»: «Узбекский и русский» (по умолчанию), «Узбекский» или «Русский».
5. Флажки «Показывать имена пациентов («Алишер К.»)» и «Объявлять вызов голосом»; оба включены по умолчанию. Полное ФИО на экран не выводится никогда.
6. Если у врача, которого покажет экран, не указан кабинет, в форме появится предупреждение «У врача не указан кабинет: <ФИО>. На экране будет «Кабинет —», а голос не назовёт номер кабинета.» Сохранить экран можно и так.
7. Нажмите «Сохранить». Появится плашка «Код экрана «Холл, 1 этаж»» с кодом вида `K7M2Q-9XR4P`, ссылкой `https://<адрес CRM>/tv/K7M2Q-9XR4P` и кнопками «Копировать ссылку», «Открыть экран» и «Готово». Код показывается **один раз**: скопируйте ссылку сразу.
8. В списке экранов:
   - «Редактировать» меняет настройки, код остаётся прежним;
   - «Новый код» (после подтверждения) выдаёт экрану новый код и снова показывает плашку; старая ссылка сразу перестаёт работать;
   - «Удалить» (после подтверждения) отключает экран.

### Открыть экран на телевизоре

1. Откройте в браузере телевизора ссылку `/tv/<код>`. Можно открыть и `https://<адрес CRM>/tv` и набрать код пультом в поле «Ekran kodini kiriting / Введите код экрана»: дефис и регистр не важны.
2. Нажмите «Ekranni ishga tushirish / Запустить экран» (кнопка «OK» на пульте). Это включает звук, полный экран и запрет засыпания экрана, если браузер это поддерживает.
3. Экран опрашивает сервер каждые 2 секунды.
   - При вызове поверх экрана на 10 секунд появляется код, имя и «Xona / Кабинет N», звучит сигнал и фраза. Несколько вызовов объявляются по очереди.
   - На одной странице помещается до 9 кабинетов. Если кабинетов больше, страницы сменяются каждые 10 секунд.
4. Каждый день в 04:00 страница перезагружается сама; если в это время нет связи, перезагрузка откладывается до её возвращения. На телевизорах, где звук требует нажатия, после перезагрузки снова появится кнопка «Запустить экран». На мини-ПК с флагом автозвука (см. ниже) этого не нужно.

Что может показать экран:

- «Aloqa yo‘q / Нет связи» — сервер не ответил 3 раза подряд. Последние данные остаются на экране, запросы повторяются с паузой до 10 секунд.
- «Ekran o‘chirilgan. Administratordan yangi kod so‘rang. / Экран отключён. Попросите администратора выдать новый код.» — экран удалён, ему выдан новый код или код неизвестен. Экран проверяет код раз в минуту и сам вернётся к работе, если сервер снова его узнает (например, после сбоя при обновлении CRM).
- «Klinika obunasi faol emas. / Подписка клиники неактивна.» — экран проверяет подписку каждые 30 секунд и заработает сам после оплаты.

Один телевизор — один экран. Экран не требует входа в CRM и никогда не показывает телефоны, полные ФИО, услуги и суммы.

### Оборудование

- **Нужен браузер на Chromium 87 или новее.** Встроенные браузеры подходят у LG webOS 22 (2022 год) и новее и у Samsung Tizen 2023 и новее. На более старых телевизорах страница может не работать или работать без стилей.
- **Надёжнее всего мини-ПК с Chrome, подключённый по HDMI.** Подойдёт любой неттоп на Windows или Linux. Второй вариант — Android TV / Google TV приставка с браузером на Chromium 87 или новее.
- **Запуск Chrome на мини-ПК в режиме киоска с автозвуком.** Отдельный профиль нужен, чтобы флаги применялись, даже если Chrome уже открыт:

  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble --user-data-dir="C:\queue-tv-profile" "https://<адрес CRM>/tv/<код>"
  ```

  Положите ярлык с этой командой в автозагрузку (`Win+R` → `shell:startup`). В схеме электропитания Windows отключите сон и отключение экрана.
- **Настройки телевизора.** Отключите энергосбережение, автовыключение и заставку. Звук включите на слышимую в холле громкость.

## Печать талонов

Подходит любой чековый принтер 58 или 80 мм, установленный в Windows. Талон свёрстан шириной 58 мм, на ленте 80 мм он печатается с полями.

1. Установите драйвер принтера и напечатайте пробную страницу из Windows.
2. В «Настройках печати» принтера выберите бумагу 58 мм (или 80 мм), длина — по содержимому или рулон.
3. Нажмите в CRM «Печать талона» и в окне печати Chrome выберите:
   - принтер — чековый;
   - «Поля» — «Нет»;
   - «Масштаб» — 100 %;
   - снимите «Верхний и нижний колонтитулы».

   Chrome запомнит эти настройки для принтера.
4. Необязательно: печать без окна. Сделайте чековый принтер принтером по умолчанию в Windows и запускайте Chrome регистратуры отдельным ярлыком с флагом `--kiosk-printing`. Учтите, что так без окна печатается всё, что печатают из этого профиля Chrome.

На талоне: клиника, «Navbat raqami / Номер очереди», крупный код, врач и специальность, «Xona / Кабинет», дата и время выдачи, «Oldingizda / Перед вами: N».

## Голос

Сигнал «динь-дон» синтезируется браузером, файлов для него не нужно. Фразы собираются из готовых mp3-клипов в `apps/web/public/queue-voice/{uz,ru}/<id>.mp3`:

- uz: «Navbat raqami 27. Xona raqami 5.», запасная фраза — «Navbat raqami 27. Qabulga marhamat.»;
- ru: «Номер 27. Пройдите в кабинет номер 5.», запасная фраза — «Номер 27. Пройдите на приём.»

Номер больше 999 не озвучивается, звучит только сигнал. **Пока клипов нет, экран работает только с сигналом.** После «Запустить экран» телевизор заранее загружает клипы в фоне, если голос у экрана включён. Тексты клипов (69 штук) лежат в `apps/web/src/modules/queue/tv/voiceClips.json`. Узбекское «oʻ» в них записано знаком U+02BB.

### Сгенерировать клипы (один раз)

1. Создайте на portal.azure.com ресурс «Speech» с бесплатным тарифом **F0**. Регион — например, West Europe.
2. В ресурсе откройте «Ключи и конечная точка» и возьмите **KEY 1** и регион (`westeurope`).
3. Выполните в PowerShell. Ключ живёт только в этом окне и в файлы не попадает:

   ```powershell
   cd "C:\Users\user\Desktop\kamilovs CRM 1\apps\web"
   $env:AZURE_SPEECH_KEY = "<KEY 1 из портала>"
   $env:AZURE_SPEECH_REGION = "westeurope"
   npm run voice:generate -- --dry-run     # список 69 клипов, без сети
   npm run voice:generate                  # около 5 минут: бесплатный тариф — не больше 20 запросов в минуту
   Remove-Item Env:AZURE_SPEECH_KEY, Env:AZURE_SPEECH_REGION
   ```

   Другие голоса задаются переменными `AZURE_VOICE_UZ` (по умолчанию `uz-UZ-MadinaNeural`, другой — `uz-UZ-SardorNeural`) и `AZURE_VOICE_RU` (по умолчанию `ru-RU-SvetlanaNeural`, другой — `ru-RU-DmitryNeural`). Флаг `--only=uz` или `--only=ru` генерирует один язык. Без `--force` скрипт озвучивает только недостающие файлы, с `--force` перезаписывает все файлы выбранных языков.
4. Прослушайте клипы, особенно `uz/4.mp3`, `uz/9.mp3`, `uz/10.mp3`, `uz/30.mp3`, `uz/90.mp3`, `uz/400.mp3` и `uz/900.mp3` со звуком «oʻ».
   - Если слово звучит неверно, сначала попробуйте другой узбекский голос: `$env:AZURE_VOICE_UZ = "uz-UZ-SardorNeural"`, затем `npm run voice:generate -- --force --only=uz` (перезапишет все 30 узбекских клипов).
   - Чтобы изменить написание, поправьте текст в `voiceClips.json` и в том же коммите два теста, которые закрепляют написание: `src/modules/queue/tv/voicePhrases.test.ts` и `scripts/queueVoice.test.mjs`. Затем удалите только этот mp3 и выполните `npm run voice:generate -- --only=uz`: озвучится один недостающий клип.
   - Проверьте фразы на стенде (раздел ниже). Затем закоммитьте папку `apps/web/public/queue-voice`.
5. После генерации ключ можно перевыпустить в портале («Повторно создать ключ 1»).

Код ключ не использует: он нужен только для генерации. Клип можно заменить живой записью без изменения кода: mp3 моно, то же имя файла, без тишины в начале и в конце.

## Проверка локально

Тесты и сборка:

```powershell
npm test --prefix services/api
npm run typecheck --prefix services/api
npm test --prefix apps/web
npm run typecheck --prefix apps/web
npm run check-i18n --prefix apps/web
npm run build --prefix apps/web
```

Стенд с вымышленными пациентами — в памяти, без `.env` и без подключения к рабочей БД:

```powershell
node services/api/scripts/queue-preview.cjs --smoke   # самопроверка через HTTP: 22 проверки, затем выход
node services/api/scripts/queue-preview.cjs           # стенд на http://127.0.0.1:4401, Ctrl+C — остановить
# Во втором окне PowerShell:
$env:VITE_API_URL='http://127.0.0.1:4401'
npm run dev --prefix apps/web -- --host 127.0.0.1 --port 5175
```

- **Никогда не проверяйте на production.** `apps/web/.env` указывает на рабочий API, поэтому `VITE_API_URL` обязательно задаётся в том же окне перед `npm run dev`.
- **Входы:** `admin`, `reception`, `doctor` (Каримов, кабинет 3, буква К), `nurse` (медсестра Усмановой, кабинет 5, буква У), `manager`; пароль у всех — `preview`. Если не ставить «Запомнить меня», в разных вкладках можно войти разными ролями.
- **Данные стенда.** На сегодня уже есть очереди:
  - кабинет 3: К-02 на приёме, К-04 и К-05 ждут, К-03 пропустил, К-01 принят;
  - кабинет 5: У-01 вызван, У-02 и У-03 ждут;
  - кабинет 7: Н-01 и Н-02 ждут;
  - педиатр без кабинета: 01 ждёт.

  Абдуллаева Зебо (10:30, Каримов) ждёт «Отметить приход». Сайфуллаев Отабек (12:00, Назарова) отмечен «Пришёл» без номера: «Выдать номер» даст ему Н-03. У вчерашней записи Бекмуратовой Нодиры (Каримов) тоже нет номера, и «Выдать номер» ответит «Запись не на сегодня». Стенд печатает ссылки на два ТВ-экрана: «Холл» (все врачи, uz+ru, имена) и «Коридор» (кабинет 3 и педиатр, ru, без имён).
- **Ограничения стенда.** Реально работают очередь, экраны, записи, врачи, пациенты и услуги. Панель управления и другие разделы CRM не реализованы и отвечают ошибкой. Данные и коды экранов исчезают при остановке. После полуночи по Ташкенту стенд нужно перезапустить.

## Выпуск

Миграция `services/api/migrations/035_electronic_queue.sql` только добавляет колонки, индексы и таблицы (`queue_counters`, `queue_displays`). Она применяется автоматически при старте API на Render (`db-migrate.cjs`).

После выкладки:

1. Заполните у врачей «Кабинет» и «Буква очереди».
2. Суперадмин создаёт экран и открывает его на телевизоре.
3. Сделайте пробную выдачу номера, вызов и печать талона. Записям, отмеченным «Пришёл» до выкладки, номер выдаёт кнопка «Выдать номер».
4. Проверьте сервер (только чтение, данные не меняются):
   - `curl -si https://kamilovs-crm.onrender.com/api/public/queue-display/XXXXX-XXXXX` отвечает `404` с `{"error":"Экран не найден"}` и заголовками `Cache-Control: no-store` и `RateLimit-Policy: 300;w=60`;
   - в логах Render нет строк с успешными опросами `/api/public/queue-display/`, а неудачные записаны с `***` вместо кода экрана;
   - в базе `SELECT filename, applied_at FROM schema_migrations WHERE filename = '035_electronic_queue.sql';` возвращает одну строку.

Для существующих сценариев меняются две вещи: «Пришёл» у записи на сегодня теперь выдаёт номер, и появился переход «Неявка → Пришёл» для записей на сегодня. Лимит публичного адреса ТВ — 300 запросов в минуту с одного IP (IP клиента берётся из заголовка Cloudflare `CF-Connecting-IP`). При опросе раз в 2 секунды это около 10 телевизоров за одним интернет-подключением клиники. Успешные опросы ТВ и страницы «Очередь» не пишутся в журнал запросов, чтобы не засорять логи и не раскрывать коды экранов.
````

- [ ] **Step 4: Append the planning refinements to the spec**

In `docs/superpowers/specs/2026-09-30-electronic-queue-design.md` replace:
```markdown
**Оборудование:** любой ТВ с современным браузером; надёжнее Android TV-приставка или мини-ПК с Chrome по HDMI. Талоны — любой чековый принтер 58/80 мм, установленный в Windows.
```
with:
````markdown
**Оборудование:** любой ТВ с современным браузером; надёжнее Android TV-приставка или мини-ПК с Chrome по HDMI. Талоны — любой чековый принтер 58/80 мм, установленный в Windows.

## Уточнения при планировании

Эти решения приняты при составлении плана реализации. Где они расходятся с текстом выше, действуют они.

### Данные и API

1. **Буква на талоне сохраняется на момент выдачи.** В `appointments` добавлена колонка `queue_prefix`: в неё записывается буква врача в момент выдачи номера. Код талона строится из `queue_prefix` и `queue_number`. Поэтому смена буквы у врача не меняет уже выданные и напечатанные талоны. Новая колонка входит в миграцию 035.
2. **Вызов не меняет `updated_at` записи.** `call` и `call-next` пишут только `queue_called_at` и `queue_call_count`. Иначе счёт и услуги получали бы ложный ответ 409 от оптимистичной блокировки. Смена статуса, как и раньше, меняет `updated_at`.
3. **Пропустившие видны персоналу.** Ответ `GET /api/queue/today` содержит список `missed`: записи `no_show` с номером на сегодня. У регистратуры и суперадмина для них есть кнопка «Вернуть в очередь» (PUT статуса `arrived`).
   - Переход `no_show → arrived` разрешён только для записи на сегодня. Иначе сервер отвечает 400 «Вернуть в очередь можно только запись на сегодня».
   - Этот переход не проверяет пересечение слотов врача (`ensureNoDoctorConflict` и `findConflicting`): порядок вернувшегося пациента задаёт очередь, а не время записи.
   - Production проверен 2026-10-01 (только чтение): у `appointments` есть только первичный ключ, три внешних ключа, CHECK по `billing_status` и NOT NULL, ограничения-исключения `appointments_doctor_active_no_overlap` нет. Поэтому возврат на уже занятый слот проходит. Если `services/api/src/sql/appointments_schedule_exclusion_patch.sql` когда-нибудь применят вручную, такой возврат получит 409 «У врача уже есть запись на это время».
   - На ТВ пропустившие не показываются.
4. **Ответы API содержат часовой пояс клиники.** Поле `timeZone` (значение `REPORTS_TIMEZONE`, по умолчанию Asia/Tashkent) есть в `QueueToday`, `QueueTicket` и `QueueDisplayState`. Время на ТВ и на талоне показывается по клинике, а не по часовому поясу браузера.
5. **Пустой список врачей экрана хранится как `NULL`.** `doctorIds: []` сохраняется как `doctor_ids = NULL`, то есть «все врачи, у кого сегодня есть очередь». Повторы в списке удаляются.
6. **«Выдать номер» — только на сегодня.** `POST /api/queue/appointments/:id/issue` отвечает 409 «Запись не на сегодня» для записи на другой день и 409 «Номер выдаётся только пришедшему пациенту», если запись не в статусе «Пришёл».
7. **Код талона собирает только сервер.** Web показывает готовые поля `code` и `queueCode` и сам код не форматирует. Поэтому проверка «формат кода талона» из раздела «Проверка» находится в тестах API (`formatQueueCode` в `services/api/src/services/queue/queueRules.test.ts`), а не в тестах web.
8. **`SKIP LOCKED` не проверяется одновременными запросами.** PGlite в тестах работает через одно соединение, поэтому два одновременных «Вызвать следующего» тестом не воспроизвести. Тесты проверяют выбор наименьшего невызванного номера. От двойного вызова защищает `FOR UPDATE SKIP LOCKED` внутри одного SQL-запроса.
9. **Ещё один частичный индекс.** Миграция 035 создаёт и `idx_appointments_in_consultation_day ON appointments (clinic_id, start_at) WHERE status = 'in_consultation' AND deleted_at IS NULL`. Он обслуживает вторую ветку запроса дня очереди: «На приёме» по `start_at`, в том числе без номера. ТВ выполняет этот запрос каждые 2 с, страница «Очередь» — каждые 5 с, а индекса по `start_at` в production нет.
10. **Журнал запросов без опросов очереди.** `requestLogger` не пишет успешные (статус меньше 400) `GET /api/public/queue-display/…` и `GET /api/queue/today`. В строках с ошибкой код экрана заменён на `***`: `/api/public/queue-display/***`. Строки остальных маршрутов не меняются.
11. **Лимит по IP клиента.** Лимит публичного адреса (300 запросов в минуту) считается по IP клиента из `CF-Connecting-IP`: production на Render стоит за Cloudflare, это видно по заголовкам ответа. `trust proxy` не включается, чтобы не менять лимит входа и IP в аудите.

### Голос

12. **Фразы голоса уточнены по источникам.** Клипы — данные: их тексты лежат в `apps/web/src/modules/queue/tv/voiceClips.json` и правятся до генерации.
    - uz: «Navbat raqami N. Xona raqami R.», запасная — «Navbat raqami N. Qabulga marhamat.». Вариант «R raqamli xonaga kiring» отклонён: «besh raqamli» читается и как «пятизначный».
    - ru: «Номер N. Пройдите в кабинет номер R.», запасная — «Номер N. Пройдите на приём.». Она заменила незаконченное «Вас приглашают».
    - Клипы uz: `navbat_raqami`, `xona_raqami`, `qabulga_marhamat` и 27 чисел. Клипы ru: `nomer`, `proydite_v_kabinet_nomer`, `proydite_na_priyom` и 36 чисел. Всего 69 файлов. Клипов `raqamli_xonaga_kiring` и `vas_priglashayut` из текста выше нет.
    - Узбекское «oʻ» записано знаком U+02BB. N больше 999 не озвучивается, буква очереди не озвучивается.
    - После «Запустить экран» ТВ с включённым голосом заранее загружает и декодирует клипы языков экрана в фоне; объявление вызова эту загрузку не ждёт.

### Интерфейс

13. **«Талон» — только у пришедшего с номером.** Кнопка есть у записи в статусе «Пришёл» с кодом очереди. После «Начать приём» она не показывается.
14. **«Выдать номер».** У записи в статусе «Пришёл» без номера (например, отмеченной до выхода очереди) регистратура и суперадмин видят кнопку «Выдать номер». Она вызывает `POST /api/queue/appointments/:id/issue` и показывает то же уведомление «Выдан номер К-05».
15. **Номер на главной странице.** После «Отметить приход» на главной странице появляется уведомление «Выдан номер К-05», если номер выдан.
16. **ТВ повторяет проверку отключённого экрана.** На 404 (код неизвестен, экран удалён или получил новый код) ТВ показывает «Экран отключён…» и проверяет код раз в минуту; при неактивной подписке — раз в 30 секунд. Первый успешный ответ убирает сообщение, так что короткий сбой при выкладке не гасит экран до ночной перезагрузки.
17. **ТВ-маршруты вне авторизации.** `/tv` и `/tv/:code` рендерятся вне `AuthProvider`, поэтому устаревший токен сотрудника не уводит телевизор на `/login`.
18. **Опрос ТВ без заголовков.** ТВ опрашивает API простым `fetch` без авторизации и без своих заголовков (`cache: "no-store"`), чтобы браузер не отправлял лишний CORS-запрос перед каждым опросом.
19. **Браузер ТВ — Chromium 87 или новее.**
    - Стили ТВ — отдельный CSS с цветами в hex/rgba, без Tailwind, `oklch`, `color-mix`, `@layer` и `:has()`.
    - Сборка web понижена до синтаксиса Chromium 87: `build.target` в `apps/web/vite.config.ts` — `es2020`, `chrome87`, `edge88`, `firefox78`, `safari14`. ТВ загружает и основной бандл приложения, поэтому цель действует для всей сборки.
20. **До 9 кабинетов на странице ТВ.** Если кабинетов больше, страницы сменяются каждые 10 с.

### Проверка

21. **Ручная проверка только на стенде.** Ручная проверка идёт только на стенде `services/api/scripts/queue-preview.cjs` (порт 4401, PGlite в памяти); production API и БД не используются. Порядок проверки описан в `docs/queue.md`.
````

- [ ] **Step 5: Run the full automated verification**

Run each command from the repo root in Git Bash:
```bash
(cd services/api && npm test)
(cd services/api && npm run typecheck)
(cd services/api && npm run build)
(cd apps/web && npm test)
(cd apps/web && npm run typecheck)
(cd apps/web && npm run check-i18n)
(cd apps/web && npm run build)
ls apps/web/dist/assets | grep -i tvapp
grep -cE "oklch|color-mix|@layer|:has\(" apps/web/dist/assets/TvApp-*.css || true
grep -lE "static[{]|#[A-Za-z_$][A-Za-z0-9_$]* in " apps/web/dist/assets/*.js || echo "no static blocks or #x-in checks"
node services/api/scripts/queue-preview.cjs --smoke
```
Expected:
- **API tests.** `Test Files  20 passed (20)`, `Tests  337 passed (337)`, 0 failed. Two existing suites read `JWT_SECRET` from `services/api/.env`, as before this feature; without that file prefix the command with `JWT_SECRET=local-tests-only`.
- **API typecheck.** Exit 0, no output after npm's banner.
- **API build.** Exit 0; `tsc && tsc-alias` writes the git-ignored `services/api/dist`.
- **Web tests.** `Test Files  39 passed (39)`, `Tests  244 passed (244)`, including `scripts/queueVoice.test.mjs (21 tests)`.
- **Web typecheck.** Exit 0, no output after npm's banner.
- **check-i18n.** `[i18n] OK: 1811 keys, full ru/uz parity, all code references resolve.`
- **Web build.** `prebuild` prints the same i18n line, then the chunk list and `✓ built in …`. The warning "Some chunks are larger than 500 kB" existed before this feature. The list includes:
  - `dist/assets/TvApp-<hash>.css` 6.90 kB and `dist/assets/TvApp-<hash>.js` 18.64 kB: the TV is its own lazy chunk;
  - `dist/assets/index-<hash>.js` 1,422.87 kB.
- **TV chunk.** `ls … | grep -i tvapp` prints exactly two names, `TvApp-<hash>.css` and `TvApp-<hash>.js`. `apps/web/dist/queue-voice` exists only if clips were generated.
- **TV browser syntax.** The CSS grep prints `0`, and the JS grep prints `no static blocks or #x-in checks` (Task 12, Chromium 87 target).
- **Smoke.** `[smoke] 22 checks passed`.

Any failure is blocking: fix it before continuing.

- [ ] **Step 6: Start the stand and the web dev server (never against production)**

`apps/web/.env` points at the production API, and Vite lets a shell variable override `.env`. Therefore start the web server only with `VITE_API_URL` set on the same command, and verify it before any login.
- Do not start Vite through `.claude/launch.json` / `preview_start` with a `name`: that would use `.env`, which means production.
- Start both servers with the Bash tool and `run_in_background: true`:
```bash
cd "C:/Users/user/Desktop/kamilovs CRM 1" && node services/api/scripts/queue-preview.cjs
```
```bash
cd "C:/Users/user/Desktop/kamilovs CRM 1/apps/web" && VITE_API_URL=http://127.0.0.1:4401 npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```
Wait until both answer, using the Monitor tool with an until-loop: `until curl -sf http://127.0.0.1:4401/api/health >/dev/null && curl -sf http://127.0.0.1:5175/tv >/dev/null; do sleep 1; done`.
- Read the stand's background output and note the two codes from the lines `TV «Холл, 1 этаж» … /tv/<HALL>` and `TV «Коридор: кабинет 3 и педиатр» … /tv/<CORRIDOR>`.

Guard. Run: `curl -s http://127.0.0.1:5175/src/api/http.ts | grep -o '"VITE_API_URL": "[^"]*"'`
Expected: exactly one line, `"VITE_API_URL": "http://127.0.0.1:4401"` (Vite prepends `import.meta.env = {…}` to the served module). If it shows `onrender.com`, stop the web server and restart it with the variable. **Do not log in** until this check passes.

- [ ] **Step 7: Browser checks with screenshots**

Use the Browser pane:
- Open with `preview_start` with a `url`, or with `navigate`; use `tabs_create` for new tabs.
- Take screenshots with `computer` → `screenshot`. Keep them in the conversation; do not add them to the repo.
- Log in at `http://127.0.0.1:5175/login` with the stand's test accounts (password `preview`). Leave «Запомнить меня» unchecked: the token then goes to sessionStorage, so each tab can hold a different role.
- If the pane cannot answer a native `confirm()` (for «Не пришёл», «Новый код», «Удалить»), run `window.confirm = () => true` in that tab with `javascript_tool` before clicking. This is test-only; do not change code.

Seed state on a fresh stand:
- кабинет 3 (Каримов, К): К-02 Юсупова Мадина на приёме; К-04 Ким Ольга and К-05 Турсунов Бобур wait; К-03 Рахимов Тимур missed; 1 done;
- кабинет 5 (Усманова, У): У-01 Хасанова Гулноза called; У-02 Мирзаев Жасур and У-03 Петрова Анна wait;
- кабинет 7 (Назарова, Н): Н-01 Садыкова Лола and Н-02 Ким Ольга wait;
- педиатр Юлдашев (no room, no letter): 01 Норматов Улугбек waits;
- Абдуллаева Зебо 10:30 at Каримов is still `scheduled`;
- Сайфуллаев Отабек 12:00 at Назарова is `arrived` with no number (marked before the release), and so is Бекмуратова Нодира at Каримов, but yesterday 15:00.

A. **TV, full HD** (tab 1, no login).
   1. `resize_window` 1920×1080. Open `http://127.0.0.1:5175/tv/<HALL>`. A dark start screen shows «Ekranni ishga tushirish / Запустить экран».
   2. Click it. You should see:
      - a header with «Тестовая клиника», «Navbat / Очередь» and a clock;
      - 4 cards in the order «Xona / Кабинет 3», «… 5», «… 7», «… —»;
      - Кабинет 3: current К-02 «Мадина Ю.» marked «Qabulda / На приёме», next К-04 «Ольга К.», К-05 «Бобур Т.»;
      - Кабинет 5: current У-01 «Гулноза Х.» marked «Chaqirildi / Вызван»;
      - the «So‘nggi chaqiruvlar / Последние вызовы» feed starting with У-01.
   3. No overlay on the first load: existing calls count as old. Screenshot **tv-hall-1080p**.
   4. `resize_window` 1280×720. Everything still fits: no page scroll, text readable. Screenshot **tv-hall-720p**. Then `resize_window` preset `desktop`.
B. **Reception calls next** (tab 2).
   1. Log in as `reception` and open `/queue`. You see 4 cabinet columns with actions. Кабинет 3 shows «Вызвать следующего · К-04». The «Не пришли» list shows К-03 with «Вернуть в очередь». Screenshot **queue-reception**.
   2. Click «Вызвать следующего · К-04». The notice «Вызван К-04» appears.
   3. Switch to tab 1 within 10 s. The call overlay shows К-04, «Ольга К.», «Xona / Кабинет 3» for about 10 s. Screenshot **tv-overlay**.
   4. `read_network_requests` with `urlPattern` `queue-display` in tab 1 lists a request to `http://127.0.0.1:4401/api/public/queue-display/<HALL>` about every 2 s, status 200.
C. **Issue a number from Appointments** (tab 2, reception).
   1. Open `/appointments`, find Абдуллаева Зебо Камоловна 10:30 (Каримов) and click «Отметить приход».
   2. The notice «Выдан номер К-06» appears with «Печать талона». The card shows the К-06 badge and a «Талон» button. Screenshot **appointments-issued**.
   3. Click «Печать талона». If a print preview opens, screenshot **ticket-preview**: 58 mm, «Тестовая клиника», «Navbat raqami / Номер очереди», К-06, Каримов · Кардиолог, «Xona / Кабинет 3», «Oldingizda / Перед вами: 2». Otherwise press Escape and ask the user to click «Печать талона» in their own Chrome at the same URL.
   4. Check the data. Run:
      `TOKEN=$(curl -s -X POST http://127.0.0.1:4401/api/auth/login -H "Content-Type: application/json" -d '{"username":"reception","password":"preview"}' | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).accessToken))") && curl -s http://127.0.0.1:4401/api/queue/appointments/106/ticket -H "Authorization: Bearer $TOKEN"`
      Expected: JSON with `"code":"К-06"`, `"room":"3"`, `"aheadCount":2` (К-04 was called but is still `arrived`, plus К-05), `"clinicName":"Тестовая клиника"` and `"timeZone":"Asia/Tashkent"`.
   5. Find Сайфуллаев Отабек Равшанович 12:00 (Назарова): status «Пришёл», no code, and a «Выдать номер» button instead of «Талон». Click it. The notice «Выдан номер Н-03» appears, and the card now shows the Н-03 badge and «Талон». Screenshot **appointments-issue-backfill**.
   6. Set «Дата» to yesterday and click «Выдать номер» on Бекмуратова Нодира Шавкатовна 15:00. The error card reads «Запись не на сегодня», and the card keeps no code.
   The dashboard notice (Task 8) cannot be checked here: the stand does not implement the dashboard endpoints.
D. **Return a missed patient** (tab 2). In Кабинет 3 «Не пришли», click «Вернуть в очередь» on К-03. К-03 leaves the missed list. Рахимов Тимур appears as **К-07** at the end of the waiting list, after К-05 and К-06.
E. **Doctor, nurse, manager.**
   1. Tab 3: log in as `doctor` and open `/queue`. Only Кабинет 3 is shown: К-02 serving with «Открыть приём» and «Завершить приём», and the big «Вызвать следующего · К-05», because К-04 is already called. К-04 has «Начать приём», «Повторить вызов» and «Не пришёл». Screenshot **queue-doctor**.
   2. Click it: TV tab 1 shows the К-05 «Бобур Т.» overlay.
   3. Click «Повторить вызов» on К-04: the TV announces К-04 again, because the key changed from 104:1 to 104:2.
   4. Log out, log in as `nurse`: `/queue` shows only Кабинет 5.
   5. Log out, log in as `manager`: `/queue` shows all 4 cabinets with **no** action buttons and no «Экраны». Screenshot **queue-manager**.
F. **Displays panel** (tab 3, `admin`).
   1. `/queue` → «Экраны» lists «Холл, 1 этаж» and «Коридор: кабинет 3 и педиатр».
   2. Click «Новый экран». «Всех врачей, у кого сегодня есть очередь» is selected, and the warning «У врача не указан кабинет: Юлдашев Бекзод Олимович. …» is already shown. Type «Название» «Тест» and choose «Только выбранных врачей» without ticking anyone: the warning disappears. Click «Сохранить»: the form shows «Выберите хотя бы одного врача» and stays open.
   3. Tick Юлдашев («Кабинет не указан» next to him): the warning is back. Click «Сохранить». The green banner «Код экрана «Тест»» shows the code, `http://127.0.0.1:5175/tv/XXXXX-XXXXX`, «Копировать ссылку», «Открыть экран» and «Готово». Screenshot **displays-code**.
   4. Open that link in tab 4 and start the screen.
   5. Back in tab 3, click «Новый код» on «Тест» and confirm. Within about 2 s tab 4 shows «Ekran o‘chirilgan… / Экран отключён. Попросите администратора выдать новый код.» The banner in tab 3 shows the new code. Tab 4 now re-checks its old code once a minute (Task 12) and stays on this message.
   6. Click «Удалить» on «Тест» and confirm; the list shows only the two stand screens.
G. **Doctor room and letter** (tab 3, `admin`).
   1. `/doctors`: the cards read «Кабинет 3 · К», «Кабинет 5 · У», «Кабинет 7 · Н».
   2. Edit Юлдашев: Кабинет `9`, Буква `п`. The field shows `П`. Save; the card reads «Кабинет 9 · П». Screenshot **doctors-room-letter**.
   3. TV tab 1, within 2 s: the pediatric card reads «Xona / Кабинет 9» and moves after Кабинет 7. The existing ticket still reads `01`: the letter is a snapshot taken at issue time.
H. **Other TV states.**
   1. Open `http://127.0.0.1:5175/tv/<CORRIDOR>`: 2 cards (Кабинет 3 and Кабинет 9), Russian labels only, no patient names. Screenshot **tv-corridor**.
   2. Open `http://127.0.0.1:5175/tv`, type the hall code in lowercase without the dash and submit. You land on `/tv/<HALL>`.
   3. In tab 2, where the reception token is stored, open `/tv/<HALL>`. The TV renders and does **not** redirect to `/login`.
   4. Stop only the stand: `powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 4401 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`. Within about 10 s tab 1 shows «Aloqa yo‘q / Нет связи» and keeps the last data. Screenshot **tv-offline**.
   5. Start the stand again (Step 6 command, in the background). Within about 10 s tab 1 shows «Экран отключён…», because stand codes are new after a restart; it keeps re-checking the old code once a minute.
I. **Staff page on a phone.** Use `resize_window` preset `mobile` on `/queue` (reception). The restarted stand has fresh seed data; tokens stay valid because the preview JWT secret is fixed. The cards stack and there is no horizontal scroll. Screenshot **queue-mobile**. Then preset `desktop`.
J. **Console.** Run `read_console_messages` with `onlyErrors: true` on a TV tab and on `/queue`. There are no uncaught errors.

Missing clips need no fix. Until clips exist, Vite's SPA fallback answers `/queue-voice/*.mp3` with `index.html` (200, text/html). The announcer must treat the failed decode as a missing clip and play only the chime; that is expected.

- [ ] **Step 8: Stop the servers**

Run: `powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 4401,5175 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4401/api/health`
Expected: `000`, meaning nothing listens any more (curl then exits with code 7; that is the expected result, not a failure).

- [ ] **Step 9: Voice clips — manual, by the user (optional)**

Ask the user whether they have an Azure Speech key (free F0).
- **If yes.** Ask them to run, in **their own** PowerShell window, the block «One-time generation» from Task 13 (the same text is in `docs/queue.md`, «Сгенерировать клипы»). Never ask for the key in chat, and never type or store it.
- **If they do not have a key, or decline.** Skip this step. The TV works with the chime only, and `HANDOFF.md` lists the generation under «Дальше».

After they finish, verify:
- `ls apps/web/public/queue-voice/uz/*.mp3 | wc -l` → `30`;
- `ls apps/web/public/queue-voice/ru/*.mp3 | wc -l` → `39`;
- `cd apps/web && npm run voice:generate -- --dry-run` → `[voice] Nothing to generate: every clip exists (use --force to regenerate).`

Then start the stand and web again (Step 6) and reload TV tab 1. Click «Запустить экран» and call next from `/queue`. Calling next in Кабинет 3 on the fresh seed calls К-04. The user should hear the chime, «Navbat raqami toʻrt. Xona raqami uch.», and then «Номер четыре. Пройдите в кабинет номер три.». Calling next in the pediatric column (no room) ends with «Qabulga marhamat.» / «Пройдите на приём.». Stop the servers afterwards (Step 8).

- [ ] **Step 10: Write HANDOFF.md**

Per the user's global instructions, `HANDOFF.md` records the date, the PC name from `~/.projects-hub/config.local.json`, «Сделано», «Дальше» (first item = the very next action) and «Заметки». It uses the format from `~/.projects-hub/SETUP.md`. Run from the repo root. The script picks the voice lines according to whether clips exist:
```bash
node - <<'EOF'
const fs = require("fs");
const os = require("os");
const path = require("path");
const pc = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".projects-hub/config.local.json"), "utf8").replace(/^\uFEFF/, "")).pcName;
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
const voice = fs.existsSync("apps/web/public/queue-voice/uz/1.mp3") && fs.existsSync("apps/web/public/queue-voice/ru/1.mp3");
const lines = [
  "# HANDOFF",
  `Обновлено: ${day} · ПК: ${pc}`,
  "",
  "## Сделано",
  "- Ветка `feat/electronic-queue`: электронная очередь — номер у каждого врача на день (миграция 035), «Вызвать следующего», вызов и повтор, «Вернуть в очередь», талон 58 мм.",
  "- ТВ-экран `/tv/<код>`: кабинеты, лента вызовов, окно вызова, сигнал и голос uz/ru; управление экранами у суперадмина («Очередь» → «Экраны»).",
  "- Поля «Кабинет» и «Буква очереди» у врача; код очереди, «Талон» и «Выдать номер» в записях; номер в уведомлении на главной.",
  "- Стенд `services/api/scripts/queue-preview.cjs` (порт 4401, `--smoke`) и инструкция `docs/queue.md`; уточнения дописаны в спецификацию.",
  voice
    ? "- Голосовые клипы (69 mp3, Azure) сгенерированы и лежат в `apps/web/public/queue-voice`."
    : "- Голосовые клипы ещё не сгенерированы: ТВ объявляет вызов только сигналом.",
  "- Проверено: API и web — test, typecheck, build; check-i18n; smoke стенда (22 проверки); ручная проверка в браузере на стенде.",
  "",
  "## Дальше",
  "- Открыть PR `feat/electronic-queue` → `main` и выкатить: миграция 035 применится при старте API на Render.",
  "- После выкладки: проверка из `docs/queue.md` («Выпуск», п. 4): 404 ТВ-адреса с `no-store` и `RateLimit-*`, логи Render без опросов ТВ, 035 в `schema_migrations`.",
  "- У врачей заполнить «Кабинет» и «Буква очереди», создать ТВ-экран и открыть `/tv/<код>` на телевизоре.",
  voice ? null : "- Сгенерировать голос: бесплатный ключ Azure Speech (F0) → `npm run voice:generate` в `apps/web` (docs/queue.md, «Голос»).",
  "- Проверить печать талона на реальном чековом принтере 58/80 мм.",
  "",
  "## Заметки",
  "- Локально проверять только на стенде (`VITE_API_URL=http://127.0.0.1:4401`): `apps/web/.env` указывает на production.",
  "- Ключ Azure не хранить в файлах: только `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` в текущем окне терминала (`.env.local` в `apps/web` игнорируется git).",
  "- ТВ: Chromium ≥ 87; надёжнее мини-ПК с Chrome в режиме киоска (`--kiosk --autoplay-policy=no-user-gesture-required`).",
].filter((line) => line !== null);
fs.writeFileSync("HANDOFF.md", lines.join("\n") + "\n");
console.log(fs.readFileSync("HANDOFF.md", "utf8"));
EOF
```
Expected: the file is printed. The second line reads `Обновлено: <today in Tashkent> · ПК: <pcName>`; on this PC that is `ПК: Камиловс`. The voice line matches Step 9's outcome.

- [ ] **Step 11: Commit**

Run: `git status --short`
Expected entries:
- `?? HANDOFF.md`
- `?? docs/queue.md`
- `?? services/api/scripts/queue-preview.cjs`
- ` M docs/superpowers/specs/2026-09-30-electronic-queue-design.md`
- `?? apps/web/public/queue-voice/`, only if Step 9 ran.

There must be no `.env*`, `dist/`, keys or dumps.
```bash
git add services/api/scripts/queue-preview.cjs docs/queue.md docs/superpowers/specs/2026-09-30-electronic-queue-design.md HANDOFF.md \
  && { [ -d apps/web/public/queue-voice ] && git add apps/web/public/queue-voice || true; }
git diff --cached --name-only | grep -E '(^|/)\.env|\.pem$|\.key$' && echo "STOP: secret-like file staged" \
  || git commit -m "docs(queue): local preview stand, setup guide, spec refinements and handoff"
```
Expected: no `STOP` line. The commit lists 4 files, plus 69 mp3 files if Step 9 ran.

- [ ] **Step 12: Push the branch**

Run: `git push -u origin feat/electronic-queue`
Expected: `branch 'feat/electronic-queue' set up to track 'origin/feat/electronic-queue'`. The remote branch did not exist before; `git branch -a` shows no `remotes/origin/feat/electronic-queue`. Then run `git status -sb`; it shows `## feat/electronic-queue...origin/feat/electronic-queue` with no ahead/behind count.

- [ ] **Step 13: Post-deploy check — MANUAL, done by the user after they deploy**

This plan never deploys: merging the PR and the Render deploy are the user's actions. When the user says the new version is live, ask them to run these read-only checks. Run them yourself only if the user asks you to; they change no data.
1. **Public TV endpoint.** In Git Bash (or open the URL in a browser and look at DevTools → Network):
   `curl -si https://kamilovs-crm.onrender.com/api/public/queue-display/XXXXX-XXXXX`
   Expected:
   - status `404` with body `{"error":"Экран не найден"}` and `content-type: application/json; charset=utf-8`;
   - `cache-control: no-store`;
   - `ratelimit-policy: 300;w=60`, `ratelimit-limit: 300`, `ratelimit-remaining` (299 or less) and `ratelimit-reset`;
   - Cloudflare's `cf-ray` header, as before this feature.

   `XXXXX-XXXXX` is well-formed (X is in the code alphabet) but belongs to no screen, so nothing is created. The same request against the stand is the smoke check `unknown TV code → 404 JSON, not cached, rate-limited`.
2. **Render logs.** Render dashboard → the API service → Logs, search `queue-display`.
   Expected: the request from check 1 appears only as `GET /api/public/queue-display/*** 404 <bytes> - <ms> ms` (morgan `tiny` in production). With a TV screen open for a few minutes there are no `GET /api/public/queue-display/…` lines with status 200 and no `GET /api/queue/today` lines with status 200, and no line shows a real screen code.
3. **Migration record.** Read-only queries on the production database `clinic-db` (`psql` with Render's external connection string, or the Render MCP `query_render_postgres`, which is read-only):
   ```sql
   SELECT filename, applied_at FROM schema_migrations WHERE filename = '035_electronic_queue.sql';
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'appointments'
     AND indexname IN ('ux_appointments_queue_ticket', 'idx_appointments_queue_day', 'idx_appointments_in_consultation_day')
   ORDER BY indexname;
   ```
   Expected: one row `035_electronic_queue.sql | <time of the deploy>`, then three rows: `idx_appointments_in_consultation_day`, `idx_appointments_queue_day`, `ux_appointments_queue_ticket`.

If check 1 lacks `no-store` or the RateLimit headers, the fault is in Task 5 (controller or `publicRateLimit`). If the logs show codes or 200 polls, it is Task 5's `requestLogger`. If the migration row is missing, read the Render deploy log for the `db-migrate.cjs` output. In the next session, record the outcome in `HANDOFF.md` («Сделано» / «Дальше») and commit it, per the user's global instructions.

---

## Appendix A — Design contract

The shared contract all tasks were written against. The tasks above are authoritative where they refine it (each refinement is listed in the spec addendum written by Task 14).


Spec: `docs/superpowers/specs/2026-09-30-electronic-queue-design.md` (approved). This contract REFINES the spec where noted (★).


### 0. Global decisions

1. No new runtime or dev dependencies in either app.
2. Migration `services/api/migrations/035_electronic_queue.sql` is additive only; no BEGIN/COMMIT, no CONCURRENTLY; IF NOT EXISTS everywhere.
3. Day semantics: "today" is computed in JS: `clinicToday(timeZone, now)` → `"YYYY-MM-DD"` in the clinic time zone (env.reportsTimezone,
   default "Asia/Tashkent"). Services receive `timeZone` and a clock `now: () => Date` via constructor (dependency injection; tests pass a fixed clock).
   Repositories never compute "today"; they receive `day: string`.
4. `appointments.start_at` stores clinic WALL-CLOCK as if UTC. The mapped `Appointment.startAt` is `"YYYY-MM-DD HH:mm:ss"` wall-clock
   (via existing `normalizeToLocalDateTime`). "Appointment is on day D" in JS = `startAt.slice(0, 10) === D`.
   In SQL, a day range is expressed with string literals cast the SAME way appointments are written:
   `a.start_at >= $n::timestamptz AND a.start_at < $m::timestamptz` with params `${day} 00:00:00` and `${addDays(day,1)} 00:00:00`.
   Never use `AT TIME ZONE` on start_at in new code.
5. pg vs PGlite typing: always `Number(...)` ids/counts; select DATE columns as `to_char(col, 'YYYY-MM-DD')`; map bigint[] with `.map(Number)`;
   map timestamptz instants (`queue_issued_at`, `queue_called_at`, `updated_at`) with `new Date(v).toISOString()`.
6. Clinic scoping: every staff query filters `clinic_id`. New queue repositories take `clinicId` as an EXPLICIT parameter (services pass
   `auth.clinicId`; the public endpoint passes the display's clinic id). New repos take `pool: QueryPool` (from `repositories/postgres/queryPool.ts`).
7. Error style: `throw new ApiError(status, "<Russian message>")`; JSON is always `{ error }`.
8. RBAC: new module `"queue"` + named key `QUEUE_DISPLAY_MANAGE: ["superadmin"]`, mirrored in BOTH `services/api/src/auth/permissions.ts`
   and `apps/web/src/auth/permissions.ts`. Grants: reception queue [read, create, update]; doctor [read, update]; nurse [read, update];
   manager [read]; director [read]; superadmin implicit all. Doctor/nurse are scoped to their effective doctor
   (`isDoctorScopedRole` + `getEffectiveDoctorId` from `services/clinicalDataScope.ts`; never call getEffectiveDoctorId for non-scoped roles).
   Foreign doctor → 403 "Можно работать только со своей очередью".
9. ★ Queue letter snapshot: new column `appointments.queue_prefix` stores the doctor's letter AT ISSUE TIME, so printed tickets stay valid
   if the doctor's letter changes later. Code = `formatQueueCode(queue_prefix, queue_number)`.
10. ★ `call` / `call-next` do NOT bump `appointments.updated_at` (avoid optimistic-lock 409s on invoices/service edits). Status changes do.
11. ★ Staff day view includes `missed` (no_show with today's number) so reception can press «Вернуть в очередь» (PUT status arrived).
    Service rule: transition `no_show → arrived` is allowed only when the appointment date is today (else 400
    "Вернуть в очередь можно только запись на сегодня") and it SKIPS the time-slot conflict checks (service `ensureNoDoctorConflict`
    and repository `findConflicting`) because queue order, not the slot, governs a returning patient.
12. ★ Voice phrases (refined per research; clips are data, editable before generation):
    - uz: `Navbat raqami <N>. Xona raqami <R>.`   fallback (room not 1–999): `Navbat raqami <N>. Qabulga marhamat.`
    - ru: `Номер <N>. Пройдите в кабинет номер <R>.` fallback: `Номер <N>. Пройдите на приём.`
    - N > 999 → no speech, chime only. Letter prefix is never spoken.
13. ★ Responses carry the clinic time zone: `QueueToday.timeZone`, `QueueTicket.timeZone`, `QueueDisplayState.timeZone` (= env.reportsTimezone).
14. TV page and ticket use BILINGUAL CONSTANT strings (uz + ru), not i18n JSON. Staff UI (Queue page, displays panel, appointments,
    doctors) uses i18n keys in BOTH `apps/web/src/locales/ru.json` and `uz.json` (check-i18n enforces parity; `ru.json` has CRLF line endings —
    preserve them). New staff keys live under top-level namespace `queue` (plus `pages.queue`, `doctors.*`, `appointments.queue.*` as listed).
15. TV CSS: dedicated plain CSS file with `qtv-` prefix, hex/rgba colors only; no Tailwind utilities, no `oklch`, `color-mix`, `@layer`,
    `:has()`, container queries. Sizes via `vw`/`vh`/`clamp()`. TV code must avoid APIs newer than Chrome 87 without feature detection.
16. The TV never sends auth: plain `fetch` (no custom headers) to `${import.meta.env.VITE_API_URL}/api/public/queue-display/${code}`
    with `cache: "no-store"`. TV routes render OUTSIDE `AuthProvider` (App.tsx switch) so a stale staff token can never redirect a TV to /login.
17. Azure key never touches the repo: script reads `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` from the process env only.
18. Local manual testing NEVER uses production: `apps/web/.env` points at the production API. Use the PGlite preview stand
    (`services/api/scripts/queue-preview.cjs`, port 4401) with `VITE_API_URL=http://127.0.0.1:4401` set in the shell.
19. Tests: API — vitest (node) + PGlite, template `src/repositories/postgres/PostgresQuestionnairesRepository.test.ts` (serialized pool
    gate with `connect`; mock `../../config/env`, `../../container` (getter), `../../config/database` with BOTH `query` and `connect`
    delegating to the gated pool). Inside a transaction code must use only the client (the gated pool deadlocks otherwise).
    Web — vitest node env, no DOM; pure functions tested directly; components with react-test-renderer + `vi.stubGlobal("window", …)`
    + `vi.mock("react-i18next", …)`, API modules mocked.
20. Commands (run from repo root in Git Bash):
    - API single test: `cd services/api && npx vitest run <path>`; all: `cd services/api && npm test`; types: `cd services/api && npm run typecheck`
    - Web single test: `cd apps/web && npx vitest run <path>`; all: `cd apps/web && npm test`; types: `cd apps/web && npm run typecheck`;
      i18n: `cd apps/web && npm run check-i18n`; build: `cd apps/web && npm run build`
21. One commit per task: `git add <files> && git commit -m "<type(scope): message>"` (the executor appends its attribution trailer).

### 1. Migration `services/api/migrations/035_electronic_queue.sql` (Task 1)

Exactly the spec SQL PLUS (★) `queue_prefix` on appointments:
```sql
-- Электронная очередь: номер у каждого врача на день, вызов на ТВ-экран. Только добавления.
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS room TEXT NULL
    CHECK (room IS NULL OR char_length(btrim(room)) BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL
    CHECK (queue_prefix IS NULL OR char_length(queue_prefix) = 1);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS queue_number INTEGER NULL CHECK (queue_number > 0),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL,
  ADD COLUMN IF NOT EXISTS queue_date DATE NULL,
  ADD COLUMN IF NOT EXISTS queue_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_called_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_call_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_queue_ticket
  ON appointments (doctor_id, queue_date, queue_number)
  WHERE queue_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_queue_day
  ON appointments (clinic_id, queue_date, doctor_id)
  WHERE queue_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_in_consultation_day
  ON appointments (clinic_id, start_at)
  WHERE status = 'in_consultation' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS queue_counters (
  clinic_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL REFERENCES doctors(id),
  queue_date DATE NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (doctor_id, queue_date)
);

CREATE TABLE IF NOT EXISTS queue_displays (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE,
  doctor_ids BIGINT[] NULL,
  show_names BOOLEAN NOT NULL DEFAULT TRUE,
  language TEXT NOT NULL DEFAULT 'uz_ru' CHECK (language IN ('uz', 'ru', 'uz_ru')),
  voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_displays_clinic
  ON queue_displays (clinic_id) WHERE revoked_at IS NULL;
```
(Keep Russian comments explaining each block, like 034.) Also add a named mapping in `middleware/errorHandler.ts` `mapPostgresError`:
`if (err.constraint === "ux_appointments_queue_ticket") return new ApiError(409, "Номер очереди уже занят, повторите действие");`

Test stub tables for PGlite (tests must create these BEFORE executing 035; add columns your code under test reads):
```sql
CREATE TABLE clinics(id bigint primary key, name text, subscription_status text, subscription_ends_at timestamptz);
CREATE TABLE users(id bigint primary key, clinic_id bigint);
CREATE TABLE patients(id bigint primary key, clinic_id bigint not null, full_name text, phone text, deleted_at timestamptz);
CREATE TABLE doctors(id bigint primary key, clinic_id bigint not null, full_name text, specialty text default '', percent numeric default 0,
  phone text, birth_date date, active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
CREATE TABLE appointments(id bigserial primary key, clinic_id bigint, patient_id bigint, doctor_id bigint, service_id bigint,
  price numeric, start_at timestamptz, end_at timestamptz, status text, billing_status text default 'draft',
  cancel_reason text, cancelled_at timestamptz, cancelled_by bigint, cancelled_by_role text,
  created_by_doctor_id bigint, created_by_user_id bigint, diagnosis text, treatment text, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz);
-- then exec migrations/033_call_center_daily_workflow.sql (adds recommended_return_date) and migrations/035_electronic_queue.sql
```
Fixtures insert `start_at` as literals `'2026-09-30 10:00:00'` (wall clock) and tests `SET TIME ZONE '<Intl resolved zone of Node>'`
right after creating PGlite, like `PostgresAppointmentsRepository.test.ts`. The fixed test clock is `new Date("2026-09-30T06:00:00Z")`
(= 11:00 in Tashkent, day "2026-09-30").

### 2. API pure helpers (Task 1)

#### `services/api/src/services/queue/queueRules.ts`
```ts
import type { AppointmentStatus } from "../../repositories/interfaces/coreTypes";
import type { QueueDirective } from "../../repositories/interfaces/queueTypes";

/** Calendar day "YYYY-MM-DD" of `now` in `timeZone` (Intl en-CA). */
export function clinicToday(timeZone: string, now: Date): string;
/** "YYYY-MM-DD" + n days (UTC date arithmetic on the calendar string). */
export function addDays(day: string, n: number): string;
/** "К-05", "К-123", "07"; number padded to 2 digits; prefix upper-cased; null/empty prefix → digits only. */
export function formatQueueCode(prefix: string | null | undefined, queueNumber: number): string;
/** "Фамилия Имя Отчество" → "Имя Ф."; single word → as is; empty → "". Unicode-safe first letter (Array.from), upper-cased. */
export function maskPatientName(fullName: string | null | undefined): string;
/** Sort key for cabinets: numeric rooms ascending first, then other rooms (localeCompare "ru"), then null rooms; ties by doctorName. */
export function compareCabinets(a: { room: string | null; doctorName: string }, b: { room: string | null; doctorName: string }): number;

export type QueueSnapshot = { status: AppointmentStatus; doctorId: number; startAt: string; queueNumber: number | null; queueDate: string | null };
export type QueueTargetState = { status: AppointmentStatus; doctorId: number; startAt: string };
/**
 * Rules (current = null for a new appointment):
 *   isToday = next.startAt.slice(0,10) === today
 *   hasToday = current?.queueNumber != null && current.queueDate === today
 *   doctorChanged = current != null && current.doctorId !== next.doctorId
 *   dateChanged = current != null && current.startAt.slice(0,10) !== next.startAt.slice(0,10)
 *   if next.status === "arrived" && isToday:
 *       current?.status === "no_show" → issue; !hasToday → issue; doctorChanged → issue; else keep
 *   if current?.queueNumber != null && (doctorChanged || dateChanged) → clear
 *   else keep
 *   issue → { kind: "issue", day: today }
 */
export function planQueueChange(current: QueueSnapshot | null, next: QueueTargetState, today: string): QueueDirective;
```

#### `services/api/src/services/queue/displayCode.ts`
```ts
export const DISPLAY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars
/** 10 random chars from the alphabet (crypto.randomInt). Returns canonical form (no dash). */
export function generateDisplayCode(): string;
/** "K7M2Q9XR4P" → "K7M2Q-9XR4P". */
export function formatDisplayCode(canonical: string): string;
/** Uppercases, strips everything except [0-9A-Z]; returns canonical 10-char code or null if length != 10 or any char outside the alphabet. */
export function normalizeDisplayCode(input: string): string | null;
/** sha256 hex of the canonical code. */
export function hashDisplayCode(canonical: string): string;
```

### 3. API shared types — NEW file `services/api/src/repositories/interfaces/queueTypes.ts` (Task 1 creates it with ALL types below;
later tasks only import)

```ts
import type { AppointmentStatus } from "./coreTypes";

export type QueueDirective = { kind: "keep" } | { kind: "issue"; day: string } | { kind: "clear" };

export type QueueEntryState = "waiting" | "called" | "serving" | "missed" | "done";

export type QueueEntry = {
  appointmentId: number;
  doctorId: number;
  patientId: number;
  patientName: string;
  number: number | null;      // null only for "serving" without a ticket
  code: string | null;        // formatQueueCode(queuePrefix, number) or null
  state: QueueEntryState;
  startAt: string;            // wall clock "YYYY-MM-DD HH:mm:ss"
  issuedAt: string | null;    // ISO instant
  calledAt: string | null;    // ISO instant
  callCount: number;
};

export type QueueDoctorDay = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  prefix: string | null;
  serving: QueueEntry | null;  // in_consultation today (latest by updatedAt)
  waiting: QueueEntry[];       // status arrived (states waiting + called), by number asc
  missed: QueueEntry[];        // status no_show with today's number, by number asc
  doneCount: number;           // status completed with today's number
};

export type QueueToday = { date: string; timeZone: string; serverTime: string; doctors: QueueDoctorDay[] };

export type QueueTicket = {
  appointmentId: number; clinicName: string; code: string; number: number; doctorName: string; specialty: string;
  room: string | null; issuedAt: string; aheadCount: number; timeZone: string;
};

/** Repository row for one appointment in a queue day. */
export type QueueDayRow = {
  appointmentId: number; doctorId: number; patientId: number; patientName: string; status: AppointmentStatus;
  startAt: string; queueNumber: number | null; queuePrefix: string | null; queueDate: string | null;
  issuedAt: string | null; calledAt: string | null; callCount: number; updatedAt: string;
};
export type QueueDoctorRow = { id: number; name: string; specialty: string; room: string | null; prefix: string | null };
export type QueueTarget = {
  appointmentId: number; doctorId: number; status: AppointmentStatus; startAt: string;
  queueNumber: number | null; queueDate: string | null;
};

export interface IQueueRepository {
  /** Rows with (queue_date = day AND queue_number NOT NULL) OR (status = in_consultation AND start_at within day); excludes cancelled
   *  and deleted; optional doctor filter (null = all). Ordered by doctor_id, queue_number NULLS LAST, id. */
  listDayRows(clinicId: number, day: string, doctorIds: number[] | null): Promise<QueueDayRow[]>;
  getDayRow(clinicId: number, appointmentId: number): Promise<QueueDayRow | null>;
  listDoctors(clinicId: number, doctorIds: number[]): Promise<QueueDoctorRow[]>;
  findTarget(clinicId: number, appointmentId: number): Promise<QueueTarget | null>;
  /** Transaction: lock row FOR UPDATE; if status <> 'arrived' → ApiError 409; if already numbered for `day` → no-op; else allocate. */
  issue(clinicId: number, appointmentId: number, day: string): Promise<void>;
  /** Sets queue_called_at = now(), queue_call_count + 1 for an arrived row numbered on `day`; false if no row matched. */
  call(clinicId: number, appointmentId: number, day: string): Promise<boolean>;
  /** Calls the lowest-numbered arrived, never-called row of the doctor on `day` (FOR UPDATE SKIP LOCKED); returns its id or null. */
  callNext(clinicId: number, doctorId: number, day: string): Promise<number | null>;
  /** Arrived rows of the doctor on `day` with queue_number < number. */
  countAhead(clinicId: number, doctorId: number, day: string, queueNumber: number): Promise<number>;
  /** clinics.name trimmed, or "Клиника" when empty/missing. */
  clinicName(clinicId: number): Promise<string>;
}

export type QueueDisplayLanguage = "uz" | "ru" | "uz_ru";
export type QueueDisplay = {
  id: number; name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage;
  voiceEnabled: boolean; createdAt: string; updatedAt: string;
};
export type QueueDisplayInput = {
  name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage; voiceEnabled: boolean;
};
export type QueueDisplayWithCode = { display: QueueDisplay; code: string }; // code formatted "XXXXX-XXXXX", returned ONCE
export type QueueDisplayLookup = {
  display: QueueDisplay; clinicId: number; clinicName: string;
  subscriptionStatus: string | null; subscriptionEndsAt: string | null;
};

export interface IQueueDisplaysRepository {
  list(clinicId: number): Promise<QueueDisplay[]>;                         // revoked excluded, ordered by id
  create(clinicId: number, input: QueueDisplayInput, tokenHash: string, createdBy: number | null): Promise<QueueDisplay>;
  update(clinicId: number, id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay | null>; // bumps updated_at
  revoke(clinicId: number, id: number): Promise<boolean>;                  // sets revoked_at
  rotate(clinicId: number, id: number, tokenHash: string): Promise<QueueDisplay | null>;
  findByTokenHash(tokenHash: string): Promise<QueueDisplayLookup | null>; // NOT clinic scoped; excludes revoked; joins clinics
  existingDoctorIds(clinicId: number, doctorIds: number[]): Promise<number[]>;
}

export type QueueDisplayCabinet = {
  doctorId: number; doctorName: string; specialty: string; room: string | null;
  current: null | { code: string | null; name: string | null; state: "called" | "serving" };
  waiting: Array<{ code: string; name: string | null }>; // first 5 entries in state "waiting"
  waitingCount: number;                                   // all entries in state "waiting"
};
export type QueueDisplayCall = {
  key: string;            // `${appointmentId}:${callCount}`
  code: string; number: number; name: string | null; room: string | null; doctorName: string; calledAt: string;
};
export type QueueDisplayState = {
  serverTime: string; timeZone: string; clinicName: string;
  display: { name: string; language: QueueDisplayLanguage; voiceEnabled: boolean; showNames: boolean };
  cabinets: QueueDisplayCabinet[];
  recentCalls: QueueDisplayCall[]; // last 20 calls of the day (rows with calledAt and number, any status except cancelled), newest first
};
```

### 4. Doctors (Task 2)

API `Doctor` (coreTypes) gains `room?: string | null; queuePrefix?: string | null;` (DoctorCreateInput/UpdateInput inherit).
JSON body keys: `room`, `queuePrefix` (alias `queue_prefix` accepted by `normalizeDoctorPayload`). Validation (400 before DB):
room: string trimmed, "" → null, ≤ 20 chars ([...s].length), non-string/non-null → 400 "Field 'room' must be a string up to 20 characters";
queuePrefix: trimmed, "" → null, exactly one letter `/^\p{L}$/u`, stored upper-cased (`toUpperCase()`), else 400
"Field 'queuePrefix' must be a single letter". Both added to `hasAnyField`. Controller whitelists both (create: `room ?? null`,
`queuePrefix ?? null`; update: conditional spreads). PostgresDoctorsRepository: all column lists + GROUP BY + INSERT + SET branches +
row type + mapRow (`room: row.room ?? null, queuePrefix: row.queue_prefix ?? null`). Mock `DoctorRecord` gains optional fields.

### 5. Appointments integration (Task 3)

- `coreTypes.Appointment` gains OPTIONAL fields (mock may omit):
  `queueNumber?: number | null; queueCode?: string | null; queueDate?: string | null; queueIssuedAt?: string | null; queueCalledAt?: string | null; queueCallCount?: number;`
  Queue fields are NOT added to `AppointmentCreateInput`/`AppointmentUpdateInput` (clients can never write them via PUT); if present in a
  request body the service must delete them from the normalized payload (keys: queueNumber, queueCode, queueDate, queueIssuedAt, queueCalledAt,
  queueCallCount, queuePrefix).
- `IAppointmentsRepository`:
  ```ts
  export type AppointmentWriteOptions = { queue?: QueueDirective; skipConflictCheck?: boolean };
  create(data: AppointmentCreateInput, options?: AppointmentWriteOptions): Promise<Appointment>;
  update(id: number, data: AppointmentUpdateInput, options?: AppointmentWriteOptions): Promise<Appointment | null>;
  ```
  (`AppointmentWriteOptions` exported from `IAppointmentsRepository.ts`.)
- `services/api/src/repositories/postgres/queueAllocation.ts` (shared by Task 3 and Task 4):
  ```ts
  import type { QueryClient } from "./queryPool";
  /** Atomic per-doctor/day counter + doctor letter snapshot. Must run inside the caller's transaction on `client`. */
  export async function allocateQueueNumber(client: QueryClient, clinicId: number, doctorId: number, day: string): Promise<{ queueNumber: number; queuePrefix: string | null }>;
  // SQL: INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number) VALUES ($1, $2, $3::date, 1)
  //      ON CONFLICT (doctor_id, queue_date) DO UPDATE SET last_number = queue_counters.last_number + 1 RETURNING last_number
  //      then SELECT queue_prefix FROM doctors WHERE id = $1 AND clinic_id = $2
  ```
- PostgresAppointmentsRepository: `AppointmentRow`, `SELECT_LIST` (`queue_number, queue_prefix, to_char(queue_date, 'YYYY-MM-DD') AS queue_date,
  queue_issued_at, queue_called_at, queue_call_count`), `mapAppointmentRow` (`queueCode` = formatQueueCode(queue_prefix, queue_number) when
  number not null). `update(id, data, options = {})`: keep pre-checks outside the transaction (findById; findConflicting unless
  `options.skipConflictCheck`), then do the UPDATE in a `dbPool.connect()` transaction; for `issue` call `allocateQueueNumber` on the client
  for `data.doctorId ?? current.doctorId` and add SET clauses `queue_number, queue_prefix, queue_date = $::date, queue_issued_at = NOW(),
  queue_called_at = NULL, queue_call_count = 0`; for `clear` set all queue columns NULL and count 0; zero rows → ROLLBACK and return null.
  `syncPrimaryAppointmentServiceRow` and `withServices` stay after COMMIT. `create(data, options)`: inside its existing transaction, after the
  INSERT, apply `issue` the same way (UPDATE by new id).
- MockAppointmentsRepository: accepts options; `issue` → number = 1 + max queueNumber among mock appointments of that doctor with same
  queueDate; prefix from mock doctor `queuePrefix ?? null`; sets queueCode via formatQueueCode; `clear` → nulls/0. `AppointmentRecord` gains
  the optional queue fields (+ `queuePrefix?`).
- AppointmentsService: `constructor(private readonly appointmentsRepository: IAppointmentsRepository, private readonly timeZone: string = "Asia/Tashkent", private readonly now: () => Date = () => new Date())`.
  `ALLOWED_STATUS_TRANSITIONS.no_show = ["arrived"]`. In `update`: compute `today`, `isReturnToQueue = current.status === "no_show" && mergedStatus === "arrived"`
  (400 if not today — see §0.11), skip `ensureNoDoctorConflict` when isReturnToQueue, compute `queue = planQueueChange(...)`, call
  `repo.update(id, payload, { queue, skipConflictCheck: isReturnToQueue })`. In `create`: `queue = planQueueChange(null, {...}, today)` and pass it.
- Container: `appointments: new AppointmentsService(repositories.appointments, env.reportsTimezone)`.
- Existing tests that stub `appointments` must be updated to include the new columns (exec 035 after their DDL, add a `doctors` stub where needed).

### 6. Queue staff API (Task 4)

Files: `repositories/postgres/PostgresQueueRepository.ts` (implements IQueueRepository, `constructor(private readonly pool: QueryPool)`),
`services/queue/queueDay.ts`, `services/queueService.ts`, `controllers/queueController.ts`, `routes/queueRoutes.ts`, `validators/queueValidators.ts`.

`services/queue/queueDay.ts` (pure + one loader):
```ts
export function toQueueEntry(row: QueueDayRow): QueueEntry | null;
//  arrived + calledAt null → "waiting"; arrived + calledAt → "called"; in_consultation → "serving"; no_show → "missed";
//  completed → "done"; anything else → null. code = row.queueNumber != null ? formatQueueCode(row.queuePrefix, row.queueNumber) : null
export function buildQueueDoctors(rows: QueueDayRow[], doctors: QueueDoctorRow[], alwaysInclude: number[]): QueueDoctorDay[];
//  one QueueDoctorDay per doctor that has ≥1 mapped entry OR is in alwaysInclude (and exists in `doctors`);
//  serving = latest (updatedAt desc) "serving"; waiting = waiting+called sorted by number; missed sorted by number; doneCount;
//  ordered with compareCabinets
export async function loadQueueDay(repo: IQueueRepository, clinicId: number, day: string, doctorFilter: number[] | null, alwaysInclude: number[]):
  Promise<{ rows: QueueDayRow[]; doctors: QueueDoctorDay[] }>;
//  rows = repo.listDayRows(clinicId, day, doctorFilter); ids = unique(rows.doctorId ∪ alwaysInclude);
//  doctorRows = ids.length ? repo.listDoctors(clinicId, ids) : []; doctors = buildQueueDoctors(rows, doctorRows, alwaysInclude)
```
`services/queueService.ts`:
```ts
export class QueueService {
  constructor(private readonly repo: IQueueRepository, private readonly timeZone: string = "Asia/Tashkent", private readonly now: () => Date = () => new Date()) {}
  today(auth: AuthTokenPayload, query: unknown): Promise<QueueToday>;          // query.doctorId optional positive int
  issue(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }>;
  call(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }>;
  callNext(auth: AuthTokenPayload, doctorId: number): Promise<{ entry: QueueEntry | null }>;
  ticket(auth: AuthTokenPayload, appointmentId: number): Promise<QueueTicket>;
}
```
Rules: scoped roles see only their doctor (a different ?doctorId → 403) and their doctor is always included (alwaysInclude) even if empty;
issue: 404 "Запись не найдена"; scope; status must be arrived else 409 "Номер выдаётся только пришедшему пациенту"; startAt day must be
today else 409 "Запись не на сегодня"; then repo.issue and return entry via getDayRow. call: 404; scope; `repo.call` false → 409
"Пациент не ожидает в очереди". callNext: scope on doctorId. ticket: 404 when no appointment or no number ("У записи нет номера очереди");
scope; aheadCount = countAhead(clinicId, doctorId, queueDate, number). `QueueToday.serverTime = now().toISOString()`, `timeZone`.
Routes (`routes/queueRoutes.ts`, `router.use(requireAuth)`, literal paths first):
```
GET  /today                          checkPermission("queue","read")
POST /appointments/:id/issue         checkPermission("queue","create")
POST /appointments/:id/call          checkPermission("queue","update")
GET  /appointments/:id/ticket        checkPermission("queue","read")
POST /doctors/:doctorId/call-next    checkPermission("queue","update")
GET    /displays                     allowPermission("QUEUE_DISPLAY_MANAGE")   (Task 5)
POST   /displays                     allowPermission("QUEUE_DISPLAY_MANAGE")   (Task 5)
PATCH  /displays/:id                 allowPermission("QUEUE_DISPLAY_MANAGE")   (Task 5)
DELETE /displays/:id                 allowPermission("QUEUE_DISPLAY_MANAGE")   (Task 5)
POST   /displays/:id/rotate-code     allowPermission("QUEUE_DISPLAY_MANAGE")   (Task 5)
```
Mounted in `routes/index.ts`: `router.use("/queue", requireAuth, subscriptionGuard, queueRouter);`
Container (`container/services.ts`): `const queueRepository = new PostgresQueueRepository(dbPool);` above `services`, and
`queue: new QueueService(queueRepository, env.reportsTimezone),`.

### 7. Displays + public endpoint (Task 5)

Files: `repositories/postgres/PostgresQueueDisplaysRepository.ts` (`constructor(private readonly pool: QueryPool)`),
`services/queue/displayState.ts`, `services/queueDisplaysService.ts`, `middleware/publicRateLimit.ts`, `routes/publicRoutes.ts`,
controller functions appended to `controllers/queueController.ts`, display routes appended to `routes/queueRoutes.ts`,
`middleware/subscriptionMiddleware.ts` refactor.

```ts
// services/queue/displayState.ts (pure)
export function buildDisplayState(input: {
  serverTime: string; timeZone: string; clinicName: string; display: QueueDisplay; doctors: QueueDoctorDay[]; rows: QueueDayRow[];
}): QueueDisplayState;
//  cabinet.current = serving ? {code, name, state:"serving"} : latest (calledAt desc) entry in state "called" ? {…, state:"called"} : null
//  cabinet.waiting = first 5 entries with state "waiting"; waitingCount = all "waiting"
//  name = display.showNames ? maskPatientName(patientName) : null
//  recentCalls from rows with calledAt != null && queueNumber != null && status !== "cancelled", sorted calledAt desc, top 20;
//  room/doctorName from the doctors list (doctor missing → room null, doctorName "")

// services/queueDisplaysService.ts
export class QueueDisplaysService {
  constructor(private readonly displays: IQueueDisplaysRepository, private readonly queue: IQueueRepository,
              private readonly timeZone: string = "Asia/Tashkent", private readonly now: () => Date = () => new Date()) {}
  list(auth: AuthTokenPayload): Promise<QueueDisplay[]>;
  create(auth: AuthTokenPayload, body: unknown): Promise<QueueDisplayWithCode>;
  update(auth: AuthTokenPayload, id: number, body: unknown): Promise<QueueDisplay>;      // 404 "Экран не найден"
  remove(auth: AuthTokenPayload, id: number): Promise<{ success: true; id: number }>;
  rotate(auth: AuthTokenPayload, id: number): Promise<QueueDisplayWithCode>;
  publicState(code: string): Promise<QueueDisplayState>;
}
```
Validation of display input (400): name trimmed 1..100; doctorIds null or array of positive ints (dedupe) that all exist in the clinic
(`existingDoctorIds`) else 400 "Неизвестный врач в списке экрана"; showNames/voiceEnabled booleans (default true on create);
language in uz|ru|uz_ru (default "uz_ru"). PATCH accepts any subset. Codes: generateDisplayCode → hashDisplayCode stored; response code =
formatDisplayCode(canonical). publicState: normalizeDisplayCode → null → 404 "Экран не найден"; lookup null → 404; subscription blocked
(`getSubscriptionBlock(...)` below) → 403 "Подписка клиники неактивна"; day = clinicToday; `loadQueueDay(queue, clinicId, day,
display.doctorIds, display.doctorIds ?? [])`; state = buildDisplayState(...). The response never contains patient ids, phones, full names,
appointment ids (except inside `key`), prices or services.

`middleware/subscriptionMiddleware.ts` gains (and the middleware uses it, behaviour unchanged):
```ts
export type SubscriptionFields = { subscription_status: string | null; subscription_ends_at: Date | string | null };
/** "suspended" | "expired" | null (active) — same rules as requireActiveSubscription. */
export function getSubscriptionBlock(row: SubscriptionFields, nowMs: number): "suspended" | "expired" | null;
```
`middleware/publicRateLimit.ts`:
```ts
import { isIP } from "node:net";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
export const publicQueueDisplayRateLimit = rateLimit({
  windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: "Слишком много запросов. Повторите позже." },
  keyGenerator: (request) => {
    const cf = request.headers["cf-connecting-ip"];
    const ip = typeof cf === "string" && isIP(cf) ? cf : request.ip ?? "";
    return ipKeyGenerator(ip);
  },
});
```
`routes/publicRoutes.ts`: `router.get("/queue-display/:code", publicQueueDisplayRateLimit, asyncHandler(getPublicQueueDisplayController));`
exported as `publicRouter`; mounted in `routes/index.ts` next to `/auth`: `router.use("/public", publicRouter);`.
Controller sets `res.set("Cache-Control", "no-store")`.
Container: `queueDisplays: new QueueDisplaysService(new PostgresQueueDisplaysRepository(dbPool), queueRepository, env.reportsTimezone),`.

### 8. Web shared (Task 6)

- Permissions mirror (§0.8) in `apps/web/src/auth/permissions.ts`; `apps/web/src/auth/roleGroups.ts` adds:
  ```ts
  export const QUEUE_ROLES = rolesWithPermission("queue", "read");
  export const canReadQueue = (role: UserRole | undefined | null): boolean => !!role && hasPermission(role, "queue", "read");
  export const canIssueQueue = (role: UserRole | undefined | null): boolean => !!role && hasPermission(role, "queue", "create");
  export const canCallQueue = (role: UserRole | undefined | null): boolean => !!role && hasPermission(role, "queue", "update");
  export const canManageQueueDisplays = (role: UserRole | undefined | null): boolean => !!role && roleHasPermissionKey(role, "QUEUE_DISPLAY_MANAGE");
  ```
- `apps/web/src/modules/queue/api/queueTypes.ts`: exact mirrors of §3 web-facing types: QueueEntryState, QueueEntry, QueueDoctorDay,
  QueueToday, QueueTicket, QueueDisplayLanguage, QueueDisplay, QueueDisplayInput, QueueDisplayWithCode, QueueDisplayCabinet,
  QueueDisplayCall, QueueDisplayState (comment: "Mirrors services/api/src/repositories/interfaces/queueTypes.ts").
- `apps/web/src/modules/queue/api/queueApi.ts` (implicit stored token, like call-center `workspaceApi`):
  ```ts
  const base = "/api/queue";
  export const queueApi = {
    today: (doctorId?: number | null, signal?: AbortSignal) => requestJson<QueueToday>(`${base}/today${doctorId ? `?doctorId=${doctorId}` : ""}`, { signal }),
    issue: (appointmentId: number) => requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/issue`, { method: "POST" }),
    call: (appointmentId: number) => requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/call`, { method: "POST" }),
    callNext: (doctorId: number) => requestJson<{ entry: QueueEntry | null }>(`${base}/doctors/${doctorId}/call-next`, { method: "POST" }),
    ticket: (appointmentId: number) => requestJson<QueueTicket>(`${base}/appointments/${appointmentId}/ticket`),
    listDisplays: () => requestJson<QueueDisplay[]>(`${base}/displays`),
    createDisplay: (input: QueueDisplayInput) => requestJson<QueueDisplayWithCode>(`${base}/displays`, { method: "POST", body: input }),
    updateDisplay: (id: number, patch: Partial<QueueDisplayInput>) => requestJson<QueueDisplay>(`${base}/displays/${id}`, { method: "PATCH", body: patch }),
    deleteDisplay: (id: number) => requestJson<{ success: boolean; id: number }>(`${base}/displays/${id}`, { method: "DELETE" }),
    rotateCode: (id: number) => requestJson<QueueDisplayWithCode>(`${base}/displays/${id}/rotate-code`, { method: "POST" }),
  };
  ```
- `apps/web/src/modules/queue/api/publicQueueApi.ts`:
  ```ts
  export type QueueDisplayErrorKind = "not_found" | "inactive" | "network";
  export class QueueDisplayError extends Error { constructor(public readonly kind: QueueDisplayErrorKind, message: string) {…} }
  /** Bare fetch, no auth header, no redirects; 404 → not_found, 403 → inactive, else/network → network. */
  export async function fetchQueueDisplayState(code: string, signal?: AbortSignal): Promise<QueueDisplayState>;
  // URL: `${import.meta.env.VITE_API_URL}/api/public/queue-display/${encodeURIComponent(code)}`, { cache: "no-store", signal }
  ```
- `appointmentsFlowApi.ts` `Appointment` gains the optional queue fields of §5 (`queueNumber?`, `queueCode?`, `queueDate?`, `queueIssuedAt?`,
  `queueCalledAt?`, `queueCallCount?`).
- i18n: add `pages.queue` (ru "Очередь", uz "Navbat") and a top-level `queue` object in both locale files; Task 6 seeds
  `queue.title` ("Электронная очередь" / "Elektron navbat") and `queue.subtitle`; later tasks add their keys under `queue.*` as listed in
  their task (namespaces: `queue.cabinet.*`, `queue.states.*`, `queue.actions.*`, `queue.entry.*`, `queue.empty.*`, `queue.errors.*`,
  `queue.notices.*`, `queue.displays.*`), plus `doctors.room`, `doctors.queuePrefix`, `doctors.queuePrefixHint`,
  `doctors.validation.roomTooLong`, `doctors.validation.queuePrefixOneLetter`, `doctors.roomShort` (Task 7) and
  `appointments.queue.issued` ("Выдан номер {{code}}"), `appointments.queue.printTicket`, `appointments.queue.ticket`,
  `appointments.queue.dismiss`, `appointments.queue.printFailed` (Task 8).

### 9. Web features (Tasks 7–12) — fixed names

- Task 7 Doctors page: `apps/web/src/modules/doctors/pages/DoctorsPage.tsx` fields `room` (maxLength 20) and `queuePrefix` (maxLength 1,
  upper-cased on input), payload keys `room`, `queuePrefix` (empty → null); list card line "Кабинет N · К"; pure helper
  `apps/web/src/modules/doctors/utils/queueFields.ts`: `normalizeQueuePrefixInput(value: string): string` (last typed letter upper-cased,
  non-letters dropped, "" allowed) and `validateDoctorQueueFields(room: string, queuePrefix: string): "roomTooLong" | "queuePrefixOneLetter" | null`.
- Task 8 Appointments + ticket:
  `apps/web/src/modules/queue/components/QueueCodeBadge.tsx` (`export function QueueCodeBadge({ code }: { code: string | null | undefined })` → null when no code);
  `apps/web/src/modules/queue/print/ticketHtml.ts` (`export function buildTicketHtml(ticket: QueueTicket): string`, bilingual constants,
  escapes all values, 58mm root, `@page { size: 58mm auto; margin: 0 }`);
  `apps/web/src/modules/queue/print/printTicket.ts` (`export function printQueueTicket(ticket: QueueTicket): void` via hidden iframe);
  AppointmentsPage: state `issuedTicket: { appointmentId: number; code: string } | null` shown until dismissed/30 s, with «Печать талона»;
  `appointmentActions.ts`: label for scheduled/confirmed = `t("appointment.markArrived")`; desktop `AppointmentCard` status label map fixed
  to `appointments.statusLabels.*` for all 7 statuses; cards show QueueCodeBadge and a «Талон» button when `queueCode && status === "arrived"`
  and `canReadQueue(role)`.
- Task 10 Queue page: route `/queue` (RoleGuard `QUEUE_ROLES`, lazy), nav item in `nav.main` after appointments (`labelKey: "pages.queue"`,
  icon `ListOrdered`), MainLayout map `"/queue": "pages.queue"`. Files:
  `apps/web/src/modules/queue/pages/QueuePage.tsx` (`export const QueuePage: React.FC`),
  `apps/web/src/modules/queue/components/CabinetQueueCard.tsx`, `apps/web/src/modules/queue/components/QueueEntryRow.tsx`,
  `apps/web/src/modules/queue/hooks/usePolling.ts`
  (`export function usePolling<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: React.DependencyList): { data: T | null; error: string | null; loading: boolean; refresh: () => void }`),
  `apps/web/src/modules/queue/utils/queueView.ts` (`nextWaiting(day: QueueDoctorDay): QueueEntry | null` = first entry with state "waiting";
  `waitMinutes(issuedAt: string | null, serverTime: string, clientSkewMs: number, nowMs: number): number | null`;
  `formatWallTime(startAt: string): string` → "HH:MM"). Actions: call-next, call/re-call, start (PUT status in_consultation via
  `appointmentsFlowApi.updateAppointmentStatus`), not-came (PUT no_show), return-to-queue for missed (PUT arrived; needs `canIssueQueue`),
  complete for serving (PATCH complete via existing `appointmentsFlowApi.completeAppointment`), open workspace (navigate
  `/doctor-workspace/:id`, roles in `DOCTOR_WORKSPACE_ROLES`). Read-only roles (manager/director) see no action buttons.
  Polling every 5000 ms.
- Task 9 Displays panel: `apps/web/src/modules/queue/components/DisplaysPanel.tsx` (`export function DisplaysPanel({ onClose }: { onClose: () => void })`),
  `apps/web/src/modules/queue/components/DisplayFormModal.tsx`; opened from the Task 10 QueuePage header button «Экраны» when `canManageQueueDisplays`.
  After create/rotate shows the code once with link `${window.location.origin}/tv/${code}` + copy button.
  Warns for selected doctors without room (doctors loaded via `requestJson<Array<{ id: number; name: string; room?: string | null }>>("/api/doctors")`).
- Task 11 TV logic (pure, in `apps/web/src/modules/queue/tv/`):
  `voiceClips.json` — `{ "ru": { "<id>": "<text>" }, "uz": { … } }`; ids: ru numbers "1".."19","20","30",…,"90","100","200",…,"900";
  uz numbers "1".."9","10","20",…,"90","100",…,"900"; phrases ru `nomer`="Номер", `proydite_v_kabinet_nomer`="Пройдите в кабинет номер",
  `proydite_na_priyom`="Пройдите на приём."; uz `navbat_raqami`="Navbat raqami", `xona_raqami`="Xona raqami",
  `qabulga_marhamat`="Qabulga marhamat." Uzbek number words use U+02BB (toʻrt, toʻqqiz, oʻn, oʻttiz, toʻqson, toʻrt yuz, toʻqqiz yuz).
  `voicePhrases.ts`: `export type VoiceLang = "uz" | "ru"; export function numberClipIds(lang: VoiceLang, n: number): string[] | null;
  export function announcementClipIds(lang: VoiceLang, queueNumber: number, room: string | null): string[];
  export function voiceLangs(language: QueueDisplayLanguage): VoiceLang[]` (uz_ru → ["uz","ru"]).
  `callTracker.ts`: `export function createCallTracker(freshMs = 120_000): { ingest(state: QueueDisplayState): QueueDisplayCall[] }`.
  `tvLabels.ts`: `export const TV_LABELS = {…} as const; export function tvLabel(key: keyof typeof TV_LABELS, language: QueueDisplayLanguage): string`.
  `tvLayout.ts`: `export function pageCabinets<T>(items: T[], pageIndex: number): { page: T[]; pageCount: number }` (≤9 per page) and
  `export function gridColumns(count: number): number` (1→1, 2→2, 3–4→2, 5–9→3).
  `audioTrim.ts`: `export function silenceBounds(samples: Float32Array, threshold = 0.003): [number, number]`.
- Task 12 TV page: `apps/web/src/App.tsx` switch (paths `/tv` and `/tv/*` render lazy `TvApp` without AuthProvider);
  `apps/web/src/modules/queue/tv/TvApp.tsx` (routes `/tv` → TvLaunchPage, `/tv/:code` → TvDisplayPage),
  `TvLaunchPage.tsx`, `TvDisplayPage.tsx`, `useQueueDisplay.ts`
  (`export function useQueueDisplay(code: string): { state: QueueDisplayState | null; error: "not_found" | "inactive" | null; offline: boolean }`,
  poll 2000 ms, on failure back off 2→4→8→10 s, offline after 3 consecutive failures, keep last state),
  `announcer.ts` (`export function createAnnouncer(baseUrl = "/queue-voice"): { unlock(): Promise<boolean>; isUnlocked(): boolean; announce(clipGroups: string[][], langs: VoiceLang[]): Promise<void> }` — chime synthesized with Web Audio, clips fetched+decoded+trimmed+cached, back-to-back scheduling; missing clips → chime only),
  `tv.css` (qtv- prefix); `codeInput.ts` (created in Task 11: `export function normalizeCodeInput(value: string): string` → uppercase, strip non [0-9A-Z],
  max 10, and `export function formatCodeForDisplay(canonical: string): string` → "XXXXX-XXXXX").
- Task 13 voice script: `apps/web/scripts/generate-queue-voice.mjs` reads `src/modules/queue/tv/voiceClips.json`, writes
  `public/queue-voice/{uz,ru}/{id}.mp3`; flags `--dry-run`, `--force`, `--only=uz|ru`; env `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`,
  optional `AZURE_VOICE_UZ` (default uz-UZ-MadinaNeural), `AZURE_VOICE_RU` (default ru-RU-SvetlanaNeural); throttle 3500 ms; retry 429/5xx
  with backoff (Retry-After honored), SSML with `mstts:silence` Leading-exact/Tailing-exact 0ms; add `.env.local` to `apps/web/.gitignore`.
- Task 14: `services/api/scripts/queue-preview.cjs` (port 4401), `docs/queue.md` (setup, TV hardware, printer, voice generation,
  preview), end-to-end verification, spec addendum listing the ★ refinements.
