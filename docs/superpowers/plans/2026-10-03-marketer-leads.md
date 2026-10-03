# Marketer Account and Leads from a Google Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An external ad contractor ("таргетолог") gets a CRM account that sees only their own leads; leads from their link-shared Google Sheet are read into the CRM every 5 minutes; clinic staff work the leads and book appointments.

**Architecture:** A new role `marketer` with an empty permission row and one named key on one endpoint. Two new tables (`lead_sources`, `leads`) wired like the electronic queue: SQL-first repository with explicit `clinicId`, service, thin controller, per-route guards. The sheet is read by the API through Google's CSV export URL (no Google credential), parsed by pure functions, and inserted with `ON CONFLICT DO NOTHING`. Web gets a staff page `/leads` and a contractor page `/my-leads`.

**Tech Stack:** Express + TypeScript + `pg` (API, vitest + PGlite tests), React + Vite + react-i18next (web, vitest + react-test-renderer in node env), PostgreSQL 18. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-marketer-leads-design.md` — read it first; it holds the SQL, the status rules, the phone rules and the sheet-reading rules verbatim.

## Global Constraints

- No new npm dependencies in either app.
- Personal data never reaches logs or error bodies: no cell values, names, phones or the spreadsheet id in `console.*`; inserts on unique keys use `ON CONFLICT`. Use `services/api/src/utils/logRedaction.ts` (`errorForLog`) for caught errors.
- Every SQL statement on `leads` / `lead_sources` filters by `clinic_id`; repository methods take `clinicId` as an explicit first argument (queue style), never `requireClinicId()`. The only cross-clinic statement is the poller's "sources with sync enabled".
- Every API test that touches the new tables seeds a second clinic and proves isolation.
- `marketer` permission row is `{}` in both apps and is written from scratch.
- Migration files: `NNN_name.sql`, no `BEGIN`/`COMMIT`, no `CONCURRENTLY`, no `DO` blocks, additive, re-runnable. Head on `main` is `036`; this plan adds `037` and `038`. Re-check the head before committing.
- JSON over HTTP is camelCase, as in the queue API.
- Web texts exist in both `apps/web/src/locales/ru.json` and `uz.json`; i18n keys in source are string literals (`scripts/check-i18n.cjs` only checks literals).
- UI strings are Russian/Uzbek; code comments match the surrounding file's language and density.
- TDD: write the failing test, run it, see it fail for the stated reason, implement, run it green.
- Implementers do not run any `git` command that changes state (no commit, stash, checkout, reset). The orchestrator commits.
- Do not start servers, do not run `npm run db:migrate`, do not touch any real database, do not read or print `.env` files.
- Checks: `npm test --prefix services/api`, `npm run typecheck --prefix services/api`, `npm test --prefix apps/web`, `npm run typecheck --prefix apps/web`, `npm run check-i18n --prefix apps/web`. PGlite does not fill `rowCount`: use `RETURNING` and `rows.length`. `pg` returns `bigint` as string: wrap ids in `Number(...)`.

---

## File Structure

### API (`services/api`)

| File | Responsibility |
|---|---|
| `migrations/037_users_role_marketer.sql` (new) | Drop `users_role_check` if present. |
| `migrations/038_leads.sql` (new) | `lead_sources`, `leads`, index. SQL verbatim from the spec. |
| `src/auth/permissions.ts` | Role `marketer`, `EXTERNAL_ROLES`, module `leads`, keys `LEAD_SOURCES_MANAGE`, `LEADS_OWN_READ`. |
| `src/middleware/authMiddleware.ts` | Per-request account check for external roles. |
| `src/routes/index.ts` | Guard `POST /clinics`; mount `/leads`. |
| `src/controllers/clinicController.ts` | Omit subscription fields for external roles. |
| `src/services/usersService.ts`, `src/repositories/postgres/PostgresUsersRepository.ts` | Clinic of a new user from the creator's token; superadmin actions limited to own clinic. |
| `src/services/clinicalDataScope.ts` | `marketer` in `APPOINTMENT_CLINICAL_HIDDEN_ROLES`. |
| `src/utils/phone.ts` (new) | `canonicalizePhone`. |
| `src/utils/csv.ts` (new) | `parseCsv`. |
| `src/services/leads/sheetCsvClient.ts` (new) | `parseSheetUrl`, `buildSheetUrl`, `fetchSheetCsv`. |
| `src/services/leads/sheetMapping.ts` (new) | `mapSheetRows`: header detection, column mapping, typed rows. |
| `src/repositories/interfaces/leadTypes.ts` (new) | DTO types and `ILeadsRepository`. |
| `src/repositories/postgres/PostgresLeadsRepository.ts` (new) | All SQL for leads and sources. |
| `src/services/leadsService.ts` (new) | Validation, `ingestLeadRows`, list/update, patient link, sources, `/mine`. |
| `src/services/leads/leadSheetSyncService.ts` (new) | `check`, `syncNow`, `runCycle`, `startLeadSheetSync`. |
| `src/controllers/leadsController.ts`, `src/validators/leadsValidators.ts`, `src/routes/leadsRoutes.ts` (new) | HTTP surface. |
| `src/container/services.ts` | Register `leads`, `leadSheetSync`. |
| `src/config/env.ts`, `src/server.ts` | `LEADS_SHEET_SYNC_ENABLED` flag; start the poller. |

### Web (`apps/web`)

| File | Responsibility |
|---|---|
| `src/auth/permissions.ts` | Mirror of the API matrix. |
| `src/auth/roleGroups.ts` | `EXTERNAL_ROLES`, `isExternalRole`, `CLINIC_STAFF`, `ROLE_LABEL_KEYS`, `LEADS_ROLES`, `LEADS_UPDATE_ROLES`, `LEAD_SOURCES_MANAGE_ROLES`, `MARKETER_ROLES`. |
| `src/components/Sidebar.tsx`, `src/layouts/MainLayout.tsx`, `src/modules/users/pages/UsersPage.tsx` | Translated role labels; route titles. |
| `src/shared/ui/MobileBottomNav.tsx` | Hidden for external roles. |
| `src/components/SubscriptionNotice.tsx` | Neutral block text for external roles. |
| `src/modules/leads/api/leadsTypes.ts`, `leadsApi.ts` (new) | Types and `requestJson` wrappers. |
| `src/modules/leads/utils/leadFormat.ts` (new) | `formatLeadPhone`, stage → i18n key, stage → badge class. |
| `src/modules/leads/pages/LeadsPage.tsx` (new) | Staff list, filters, paging. |
| `src/modules/leads/components/LeadDetails.tsx` (new) | Expanded row: extra, status, note, patient block. |
| `src/modules/leads/components/LeadSourcesPanel.tsx`, `LeadSourceFormModal.tsx` (new) | Superadmin: sources, sheet link, check, sync. |
| `src/modules/leads/pages/MyLeadsPage.tsx` (new) | Contractor's read-only list. |
| `src/router/AppRouter.tsx`, `src/navigation/navigationConfig.tsx` | Routes `/leads`, `/my-leads`; nav items; home redirect for external roles. |
| `src/locales/ru.json`, `uz.json` | `users.marketer`, `pages.leads`, `pages.myLeads`, namespace `leads`. |

---

## HTTP Contract (shared by the API and web tasks)

```ts
export type LeadStatus = "new" | "in_progress" | "no_answer" | "booked" | "declined" | "invalid";
export type LeadStage = LeadStatus | "visited";
export type LeadSyncStatus =
  | "ok" | "empty" | "no_access" | "not_found" | "columns_not_found" | "too_large" | "timeout" | "http_error";
export type LeadColumnMap = { phone: string; name: string | null };

export type Lead = {
  id: number;
  createdAt: string;                 // ISO
  fullName: string | null;
  phone: string;                     // digits only, 10-15; the web shows it with "+"
  extra: Record<string, string>;
  status: LeadStatus;                // stored
  stage: LeadStage;                  // derived, what the UI shows
  note: string | null;
  sourceId: number;
  sourceName: string;
  patientId: number | null;
  patientName: string | null;
  staffUpdatedAt: string | null;
  staffUpdatedByName: string | null;
};
export type LeadsPage = { items: Lead[]; nextBeforeId: number | null };

export type LeadSourceBrief = { id: number; name: string };
export type LeadSource = {
  id: number;
  name: string;
  marketerUserId: number | null;
  marketerName: string | null;
  sheetUrl: string | null;           // https://docs.google.com/spreadsheets/d/<id>/edit#gid=<gid>
  columnMap: LeadColumnMap | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: LeadSyncStatus | null;
  lastSyncRows: number | null;
  lastSyncSkipped: number | null;
  leadsCount: number;
  createdAt: string;
  updatedAt: string;
};
export type LeadMarketerOption = { id: number; fullName: string; username: string };
export type LeadSourcesManage = { items: LeadSource[]; marketers: LeadMarketerOption[] };
export type LeadSourceInput = { name: string; marketerUserId: number | null; sheetUrl: string | null };
export type LeadSourcePatch = Partial<LeadSourceInput> & { columnMap?: LeadColumnMap | null; syncEnabled?: boolean };

export type LeadSheetCheck = {
  status: LeadSyncStatus;
  headers: string[];
  detected: { phone: string | null; name: string | null };
  rows: number;      // data rows read
  valid: number;     // rows with a usable phone
  skipped: number;   // rows without one
};
export type LeadSyncResult = { status: LeadSyncStatus; rows: number; added: number; duplicates: number; skipped: number };

export type LeadPatientMatch = { id: number; fullName: string; phone: string | null };

export type MyLead = { id: number; receivedAt: string; fullName: string | null; phone: string; sourceName: string; stage: LeadStage };
export type MyLeadsPage = { items: MyLead[]; nextBeforeId: number | null };
```

| Method and path | Guard | Request | Response |
|---|---|---|---|
| `GET /api/leads` | `checkPermission("leads","read")` | query `stage?`, `sourceId?`, `beforeId?`, `limit?` (default 50, max 200) | `LeadsPage` |
| `PATCH /api/leads/:id` | `checkPermission("leads","update")` | `{status?: LeadStatus (not "new"), expectedStatus?: LeadStatus, note?: string \| null}`; at least one of `status`, `note` | `Lead`; 404; 409 when `expectedStatus` no longer matches |
| `GET /api/leads/:id/patient-matches` | `leads.read` + `allowPermission("PATIENT_READ")` | — | `{items: LeadPatientMatch[]}` (max 5) |
| `PUT /api/leads/:id/patient` | `leads.update` + `allowPermission("PATIENT_READ")` | `{patientId: number \| null}` | `Lead`; 404 for a lead or patient outside the clinic |
| `GET /api/leads/sources` | `checkPermission("leads","read")` | — | `{items: LeadSourceBrief[]}` |
| `GET /api/leads/sources/manage` | `allowPermission("LEAD_SOURCES_MANAGE")` | — | `LeadSourcesManage` |
| `POST /api/leads/sources` | `LEAD_SOURCES_MANAGE` | `LeadSourceInput` | 201 `LeadSource`; 400 bad name; 422 bad marketer or sheet link |
| `PATCH /api/leads/sources/:id` | `LEAD_SOURCES_MANAGE` | `LeadSourcePatch` | `LeadSource`; 404; 422 (`syncEnabled: true` without a sheet, bad marketer, bad link) |
| `POST /api/leads/sources/:id/check` | `LEAD_SOURCES_MANAGE` | — | `LeadSheetCheck`; 422 when the source has no sheet |
| `POST /api/leads/sources/:id/sync` | `LEAD_SOURCES_MANAGE` | — | `LeadSyncResult`; 422 when the source has no sheet |
| `GET /api/leads/mine` | `allowPermission("LEADS_OWN_READ")` | query `beforeId?`, `limit?` (default 50, max 200) | `MyLeadsPage` |

Rules:

- `/mine` and `/sources…` are declared before `/:id` routes.
- `allowPermission` does not auto-pass superadmin; `LEAD_SOURCES_MANAGE` lists `superadmin` explicitly and `LEADS_OWN_READ` lists only `marketer`.
- A sheet read failure is not an HTTP error: `check` and `sync` answer 200 with the `status` code.
- `sheetUrl` input: any Google Sheets link or a bare id; the server extracts `/d/<id>` and `gid=<n>` (default 0). Unparseable → 422. `sheetUrl: null` clears the sheet and switches sync off.
- Changing `sheetUrl` resets `column_map` and `last_sync_*`.
- Linking a patient to a lead whose status is `new` moves it to `in_progress`.
- Status texts in error bodies are fixed Russian messages; they never contain a phone or a name.

### Pure-module signatures (shared by tasks 2, 3 and 4)

```ts
// src/utils/phone.ts
export function canonicalizePhone(value: unknown): string | null;        // digits only, 10-15, or null

// src/utils/csv.ts
export function parseCsv(text: string): string[][];                      // RFC 4180; strips a leading BOM

// src/services/leads/sheetCsvClient.ts
export function parseSheetUrl(input: string): { spreadsheetId: string; gid: number } | null;
export function buildSheetUrl(spreadsheetId: string, gid: number): string;
export type SheetFetchResult =
  | { status: "ok"; text: string }
  | { status: "no_access" | "not_found" | "too_large" | "timeout" | "http_error" };
export function fetchSheetCsv(spreadsheetId: string, gid: number, fetchImpl?: typeof fetch): Promise<SheetFetchResult>;

// src/services/leads/sheetMapping.ts
export type LeadRowInput = { phone: string; fullName: string | null; extra: Record<string, string> };
export type SheetMapping = {
  status: "ok" | "empty" | "columns_not_found";
  headers: string[];
  detected: { phone: string | null; name: string | null };
  rows: LeadRowInput[];   // only rows with a usable phone
  dataRows: number;       // non-empty rows below the header
  skipped: number;        // data rows without a usable phone
};
export function mapSheetRows(table: string[][], columnMap: LeadColumnMap | null): SheetMapping;
```

---

## Task 1: API — contractor role and hardening

**Files:**
- Create: `services/api/migrations/037_users_role_marketer.sql`, `services/api/src/repositories/postgres/migration037.test.ts`, `services/api/src/middleware/authMiddleware.test.ts`, `services/api/src/routes/marketerAccess.test.ts`, `services/api/src/services/usersService.test.ts`
- Modify: `services/api/src/auth/permissions.ts`, `services/api/src/auth/permissions.test.ts`, `services/api/src/services/clinicalDataScope.ts`, `services/api/src/middleware/authMiddleware.ts`, `services/api/src/routes/index.ts`, `services/api/src/controllers/clinicController.ts`, `services/api/src/services/usersService.ts`, `services/api/src/repositories/postgres/PostgresUsersRepository.ts`

**Interfaces:**
- Produces: `USER_ROLES` contains `"marketer"`; `export const EXTERNAL_ROLES = ["marketer"] as const satisfies readonly UserRole[]` in `auth/permissions.ts`; `ROLE_PERMISSIONS.marketer = {}`.

- [ ] **Step 1: Failing tests for the role.** In `permissions.test.ts`: `USER_ROLES` contains `"marketer"`; `hasPermission("marketer", m, a)` is false for every module × action; `roleHasPermissionKey("marketer", key)` is false for every key of `PERMISSIONS` (Task 3 later adds the one exception `LEADS_OWN_READ`); `rolesWithPermission` for `patients/read`, `appointments/read`, `ai/read` does not contain it. Next to `clinicalDataScope.ts`: `shouldRedactAppointmentClinicalFields("marketer")` is true and still false for `"reception"`. Run, see them fail.
- [ ] **Step 2: Add the role.** Append `"marketer"` to `USER_ROLES`; add `EXTERNAL_ROLES`; add the row `marketer: {}` with a comment that it is an external contractor with no clinic module; add `"marketer"` to `APPOINTMENT_CLINICAL_HIDDEN_ROLES`. Leave every literal role list in `PERMISSIONS` unchanged. Run the tests green.
- [ ] **Step 3: Migration 037 with its test.** `migration037.test.ts` (pattern: `migration035.test.ts`, PGlite, `readFileSync` of the real file), three databases: (A) `users` with the role CHECK text from `002_users.sql`: inserting `marketer` fails with 23514 before, the file runs twice, the constraint is gone, the insert succeeds; (B) no CHECK and a legacy row `admin`: the file runs twice, the row is untouched; (C) a legacy `users_role_check` listing `admin, manager, doctor, cashier` with an `admin` row: the file succeeds. Then create the file:

```sql
-- 037_users_role_marketer.sql
-- Новая роль "marketer": аккаунт внешнего таргетолога.
-- Список ролей проверяет API (src/auth/permissions.ts). В production ограничения на users.role нет,
-- там этот файл ничего не меняет. В базе, собранной из файлов, users_role_check из 002_users.sql
-- перечисляет девять старых ролей и не пустил бы новую. Ограничение не возвращается: значения
-- ролей в production не проверены. Только DROP: строки не читаются, повторный запуск безопасен.
-- BEGIN/COMMIT добавляет db-migrate.cjs.
SET LOCAL lock_timeout = '5s';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
```

If PGlite rejects `SET LOCAL lock_timeout` outside an explicit transaction, wrap the file's execution in `BEGIN`/`COMMIT` inside the test, as the runner does.

- [ ] **Step 4: `POST /api/clinics` behind `requirePlatformAdmin`.** `marketerAccess.test.ts` (pattern: `repositories/postgres/queueDisplays.test.ts`: Express + PGlite pool behind `vi.mock("../config/database")`, tokens from `signAccessToken`, `errorHandler` mounted, stub tables `clinics`, `users`, two clinics). Assert: marketer → 403 and `clinics` row count unchanged; clinic superadmin with `is_platform_admin = false` → 403; platform admin → 201. Change `routes/index.ts`: `router.post("/clinics", requireAuth, asyncHandler(requirePlatformAdmin), asyncHandler(createClinicController))`. If the root router does not import under vitest, mount this route alone with the real middlewares and say so in the report.
- [ ] **Step 5: Marketer is denied on every data router.** In `marketerAccess.test.ts`, with a marketer token request one route per mount (`/users`, `/patients`, `/doctors`, `/appointments`, `/services`, `/invoices`, `/payments`, `/expenses`, `/cash-register`, `/reports`, `/ai`, `/uzi-templates`, `/attendance`, `/call-center`, `/questionnaires`, `/queue`, `/auth/audit-log`): every answer is 403, never 200. Requests that need more stub tables than is reasonable may be covered by asserting the guard middleware directly; list which.
- [ ] **Step 6: New user lands in the creator's clinic.** `usersService.test.ts` with fake repositories: auth `{userId: 9, clinicId: 2, role: "superadmin"}`; `createUser` without `clinicId` and role `marketer` calls `usersRepository.create` with `clinicId: 2`, `role: "marketer"`, `doctorId: null`; with `clinicId: 1` it rejects with status 403 and `create` is not called; with `clinicId: 2` it is allowed. Implement in `usersService.createUser`: reject a body clinic that differs from `_auth.clinicId`, pass `_auth.clinicId`. In `PostgresUsersRepository.create` replace the `: 1` fallback with `requireClinicId()`.
- [ ] **Step 7: Superadmin acts only on users of their own clinic.** Tests in `usersService.test.ts`: `updateUser`, `deleteUser`, `toggleUserActive`, `changeUserPassword` for an id whose clinic-scoped `findById` returns null reject with status 404 and the mutating repository method is not called. Implement by loading the target through the clinic-scoped `findById` first in each of these service methods (read each method; some already do). Do not change repository statements used by login (`findByUsername*`, `updateSecurityState`).
- [ ] **Step 8: Account check for external roles in `requireAuth`.** `authMiddleware.test.ts` (pattern: `subscriptionMiddleware.test.ts`, `vi.mock("../config/database")` with a hoisted `query`): (1) reception token → `next()` synchronously, `query` not called; (2) marketer token, query resolves `[{role: "marketer"}]` → `next()` without error, query called once with `[userId, clinicId]`, and `requireClinicId()` inside `next` equals the token clinic; (3) rows `[]` → `next` called with ApiError 401; (4) `[{role: "reception"}]` → 401; (5) query rejects → `next(err)`; (6) a second `requireAuth` on the same `res` does not query again. Implementation: after the existing synchronous verification, when the token role is in `EXTERNAL_ROLES`, `env.dataProvider === "postgres"` and `res.locals.accountChecked !== true`, run

```sql
SELECT role FROM users
WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, true) = true
LIMIT 1
```

and continue inside `runWithClinicContext` only when the returned role equals the token role; otherwise `next(new ApiError(401, "Invalid or expired token"))`; `.catch(next)`. The staff path stays synchronous and byte-for-byte the same. Add to `marketerAccess.test.ts`: marketer `GET /api/auth/me` 200, then `UPDATE users SET is_active = false`, the same token gets 401 on `/api/auth/me` and `/api/clinic/me`.
- [ ] **Step 9: `GET /api/clinic/me` without subscription fields for external roles.** Test in `marketerAccess.test.ts`: marketer gets `id`, `name` and no key starting with `subscription`; reception of the same clinic still gets the three fields; a marketer of clinic 2 gets clinic 2's name. Implement in `clinicMeController`.
- [ ] **Step 10: Run** `npm test --prefix services/api` and `npm run typecheck --prefix services/api`; both green. Report files changed, test counts, and anything that differed from this plan.

## Task 2: API — phone, CSV, sheet client, column mapping (pure modules)

**Files:**
- Create: `services/api/src/utils/phone.ts`, `phone.test.ts`, `services/api/src/utils/csv.ts`, `csv.test.ts`, `services/api/src/services/leads/sheetCsvClient.ts`, `sheetCsvClient.test.ts`, `services/api/src/services/leads/sheetMapping.ts`, `sheetMapping.test.ts`

**Interfaces:**
- Produces: the pure-module signatures above. `LeadColumnMap` and `LeadSyncStatus` are declared in `sheetMapping.ts` / `sheetCsvClient.ts` for now; Task 3 moves them to `repositories/interfaces/leadTypes.ts` and re-exports.

- [ ] **Step 1: `canonicalizePhone`, tests first.** Table test:

| Input | Output |
|---|---|
| `"+998 90 123-45-67"` | `"998901234567"` |
| `"998901234567"` | `"998901234567"` |
| `998901234567` (number) | `"998901234567"` |
| `"901234567"` | `"998901234567"` |
| `901234567` (number) | `"998901234567"` |
| `"(90) 123 45 67"` | `"998901234567"` |
| `"p:+998901234567"` | `"998901234567"` |
| `"'+998901234567"` | `"998901234567"` |
| `"00998901234567"` | `"998901234567"` |
| `" +998 90 123 45 67 "` | `"998901234567"` |
| `"+7 912 345-67-89"` | `"79123456789"` |
| `"9.98901E+11"` | `null` |
| `9.98901234567e22` (number) | `null` |
| `901234567.5` | `null` |
| `"998 90 123 45"` (11 digits starting with `998`: a truncated Uzbek number) | `null` |
| `"998111234567"` (12 digits, operator code 11 not allowed) | `null` |
| `"123"` | `null` |
| `"abc"`, `""`, `null`, `undefined`, `{}` | `null` |
| `"111234567"` (9 digits, operator code 11 not allowed) | `null` |
| `"+998 90 123 45 67 доб. 12"` | `null` |

Rules, in order: number → must be `Number.isSafeInteger` and non-negative, then `String()`; non-string → `null`; trim, drop ` `, drop one leading apostrophe, drop one leading label matching `/^[A-Za-z]{1,2}:/`; reject unless the rest matches `/^\+?[\d\s().-]+$/`; keep digits; drop a leading `00`; 12 digits starting with `998` → valid only when the last 9 match `/^(?:20|33|[5-9]\d)\d{7}$/`; 9 digits matching that pattern → prefix `998`; any value starting with `998` that is not such a 12-digit number → `null`; other 10–15 digits → as is; else `null`.
- [ ] **Step 2: `parseCsv`, tests first.** Cases: plain rows; quoted cell with a comma; doubled quotes inside quotes; a line break inside a quoted cell; CRLF line ends; leading BOM stripped; trailing newline does not add an empty row; empty string → `[]`; a row of empty cells is kept as `["", ""]`. Implement as a single-pass state machine.
- [ ] **Step 3: `parseSheetUrl` / `buildSheetUrl`, tests first.** `https://docs.google.com/spreadsheets/d/<44-char id>/edit?usp=sharing` → `{spreadsheetId, gid: 0}`; `…/edit#gid=123` and `…/edit?gid=123#gid=123` → gid 123; a bare id matching `^[A-Za-z0-9_-]{20,100}$` → gid 0; another host, a path without `/d/<id>`, an id shorter than 20, empty input → `null`. `buildSheetUrl(id, 7)` → `https://docs.google.com/spreadsheets/d/<id>/edit#gid=7`.
- [ ] **Step 4: `fetchSheetCsv`, tests first, with an injected `fetchImpl`.** Requests `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>` with `redirect: "manual"` and `AbortSignal.timeout(20000)`. Cases: 307 to `https://doc-0-0-sheets.googleusercontent.com/...` then 200 `text/csv` → `{status: "ok", text}`; 302 to `https://accounts.google.com/...` → `no_access`; redirect to `https://evil.example/` → `no_access` and that URL is never requested; 401 and 403 → `no_access`; 404 and 410 → `not_found`; 200 with `text/html` → `no_access`; 429 and 500 → `http_error`; more than 5 redirects → `http_error`; `content-length` above 5 MB or a body longer than 5 000 000 characters → `too_large`; `fetchImpl` rejecting with a `TimeoutError`/`AbortError` → `timeout`; any other rejection → `http_error`; a 200 `text/csv` with an empty body → `{status: "ok", text: ""}`. Allowed redirect hosts: exactly `docs.google.com` or a host ending in `.googleusercontent.com`, protocol `https:`. The function never logs and never throws.
- [ ] **Step 5: `mapSheetRows`, tests first.** Header normalisation: lower case, then remove spaces, `_`, `-`, `.`, `:`. Synonym lists are in the spec, section «Колонки»; copy them verbatim. Cases: `[]` and a table of only empty rows → `empty`; header `["Дата","Имя","Телефон","Комментарий"]` with two data rows → `ok`, `detected {phone: "Телефон", name: "Имя"}`, rows with `extra {"Дата": …, "Комментарий": …}`; headers `phone_number` / `full_name` detected; a title row above the header (header is row 3) still found; no phone header in the first 10 rows → `columns_not_found` with `headers` = the first non-empty row; `columnMap {phone: "Контакт", name: null}` uses that column even though it is not a synonym; a `columnMap` whose phone header is absent → `columns_not_found`, `rows: []`; a row with an unusable phone is counted in `skipped` and not returned; fully empty rows are not counted in `dataRows`; a ragged row shorter than the header is read with missing cells as empty; empty extra values are omitted; an `extra` value longer than 500 characters is cut to 500; more than 40 extra columns → only the first 40 non-empty; a name longer than 200 is cut to 200, an empty name → `null`; an empty header cell is not used as an extra key; two columns with the same header → the first wins.
- [ ] **Step 6: Run** `npm test --prefix services/api -- src/utils src/services/leads` and `npm run typecheck --prefix services/api`. Report.

## Task 3: API — leads tables, repository, service, routes

**Files:**
- Create: `services/api/migrations/038_leads.sql`, `services/api/src/repositories/postgres/migration038.test.ts`, `services/api/src/repositories/interfaces/leadTypes.ts`, `services/api/src/repositories/postgres/PostgresLeadsRepository.ts`, `services/api/src/services/leadsService.ts`, `services/api/src/controllers/leadsController.ts`, `services/api/src/validators/leadsValidators.ts`, `services/api/src/routes/leadsRoutes.ts`, `services/api/src/repositories/postgres/leads.test.ts`
- Modify: `services/api/src/auth/permissions.ts`, `permissions.test.ts`, `services/api/src/container/services.ts`, `services/api/src/routes/index.ts`, `services/api/src/routes/marketerAccess.test.ts`

**Interfaces:**
- Consumes: `canonicalizePhone`, `LeadRowInput`, `parseSheetUrl`, `buildSheetUrl` from Task 2; `EXTERNAL_ROLES` from Task 1.
- Produces: the HTTP contract above except `check` and `sync`; `services.leads` in the container; `LeadsService.ingestLeadRows(clinicId: number, sourceId: number, rows: LeadRowInput[]): Promise<{received: number; added: number; duplicates: number}>`; repository methods the poller needs: `listSyncEnabledSources(): Promise<Array<{clinicId: number; id: number; spreadsheetId: string; gid: number; columnMap: LeadColumnMap | null}>>`, `findSource(clinicId, id)`, `recordSync(clinicId: number, sourceId: number, status: LeadSyncStatus, rows: number | null, skipped: number | null): Promise<void>`.

- [ ] **Step 1: Migration 038 with its test.** `migration038.test.ts`: stub `clinics`, `users`, `patients`; apply the real file twice; assert by name that `lead_sources_clinic_id_id_key`, `lead_sources_sync_needs_sheet`, `leads_source_fkey`, `leads_clinic_source_key` and `idx_leads_clinic_recent` exist once; a lead whose `(clinic_id, source_id)` points at another clinic's source is rejected; the same `external_key` is rejected twice in one source and allowed in another clinic; `sync_enabled = true` without `spreadsheet_id` is rejected. Create the file with the SQL from the spec, section «Данные», under a Russian header comment in the style of `035_electronic_queue.sql`.
- [ ] **Step 2: Permissions.** Tests: module `leads` exists; `reception`, `operator`, `manager` have exactly `read` and `update`; `director`, `doctor`, `nurse`, `cashier`, `accountant`, `marketer` have nothing; `PERMISSIONS.LEAD_SOURCES_MANAGE` equals `["superadmin"]`; `PERMISSIONS.LEADS_OWN_READ` equals `["marketer"]`; `marketer` is in no other key (update the Task 1 assertion). Implement.
- [ ] **Step 3: Types and repository.** `leadTypes.ts` holds the contract types (move `LeadColumnMap`, `LeadSyncStatus` here and re-export from the Task 2 files) and `ILeadsRepository`. `PostgresLeadsRepository` takes a `QueryPool`. The derived stage is one SQL fragment used by both list queries:

```sql
LEFT JOIN LATERAL (
  SELECT bool_or(a.status IN ('arrived','in_consultation','completed')) AS arrived,
         bool_or(a.status IN ('scheduled','confirmed')) AS upcoming
  FROM appointments a
  WHERE a.clinic_id = l.clinic_id AND a.patient_id = l.patient_id
    AND a.deleted_at IS NULL AND a.created_at >= l.created_at
) ap ON l.patient_id IS NOT NULL
-- stage:
CASE WHEN ap.arrived THEN 'visited' WHEN ap.upcoming THEN 'booked' ELSE l.status END
```

Check the appointment status values and the `deleted_at` / `created_at` columns against `migrations/006*` before using them. Staff list: filter by `stage` through a wrapping subquery, by `source_id`, keyset `id < $beforeId`, `ORDER BY id DESC LIMIT n + 1` to compute `nextBeforeId`; joins `lead_sources` (name), `users` (last editor's `full_name`), `patients` (name, same clinic). Insert: the statement from the spec, section «Запись»; if PGlite lacks `jsonb_to_recordset`, use `unnest($3::text[], $4::text[], $5::text[], $6::jsonb[])` and say so in the report. Staff update: one `UPDATE … WHERE id = $1 AND clinic_id = $2 [AND status = $expected] RETURNING id`; when no row returns, a second `SELECT` distinguishes 404 from 409. Patient link: the `UPDATE … AND EXISTS (SELECT 1 FROM patients …)` from the spec; `null` unlinks. Patient matches: `right(regexp_replace(phone, '\D', '', 'g'), 9) = right($2, 9)`, same clinic, not deleted, `ORDER BY id DESC LIMIT 5`. `/mine`: the query from the spec with an explicit column list. Sources: brief list; full list with `leadsCount` and marketer name; create; update (changing the sheet resets `column_map` and `last_sync_*`; clearing it also sets `sync_enabled = false`); `isBindableMarketer(clinicId, userId)` = same clinic, role `marketer`, active, not deleted; `listMarketers(clinicId)`; `listSyncEnabledSources()`; `recordSync`.
- [ ] **Step 4: Service.** Validation with `ApiError`: name 1–100 after trim (400); `marketerUserId` must pass `isBindableMarketer` (422); `sheetUrl` through `parseSheetUrl` (422); `syncEnabled: true` needs a sheet (422); `columnMap` must be `null` or `{phone: non-empty string ≤ 200, name: string ≤ 200 | null}` (400); lead patch: `status` in the stored list and not `new`, `note` ≤ 2000 with empty → `null`, at least one field (400); list query: `stage` in the stage list, positive integers, `limit` clamped to 1–200. `ingestLeadRows`: collapse duplicates by phone inside the batch (first wins), `external_key = "p:" + phone`, insert in chunks of 500, return counts. No role branches in this service.
- [ ] **Step 5: Controller, validators, routes, wiring.** Routes in the order of the contract table with `/mine` and `/sources…` before `/:id`; `router.use(requireAuth)` inside the router as `queueRoutes.ts` does; mount in `routes/index.ts` as `router.use("/leads", requireAuth, subscriptionGuard, leadsRouter)`; register `leads` in `container/services.ts`.
- [ ] **Step 6: Route tests on PGlite (`leads.test.ts`), written before the code of steps 3–5 where practical.** Stub tables `clinics`, `users`, `patients`, `appointments` plus the real `038_leads.sql`; two clinics; users: superadmin, reception, operator, manager, director, doctor, two marketers in clinic 1, a superadmin and a marketer in clinic 2. Assert:
  - ingest twice adds 0 the second time; duplicates inside one batch collapse; status and note set by staff survive a re-ingest;
  - `GET /api/leads`: reception, operator, manager, superadmin 200; director, doctor, both marketers 403; clinic 2's superadmin sees none of clinic 1's leads; `stage` filter, `sourceId` filter, paging with `beforeId` and `nextBeforeId`;
  - `PATCH`: status and note change, `staffUpdatedByName` set; `status: "new"` → 400; stale `expectedStatus` → 409; a lead of another clinic → 404;
  - patient: matches by last 9 digits for stored `+998…` and bare-digit patient phones, never a patient of clinic 2; link moves `new` to `in_progress`; a patient of clinic 2 → 404; unlink; stage `booked` with a `scheduled` appointment created after the lead, `visited` with `completed`, stored status again with only a `cancelled` one, and an appointment created before the lead is ignored;
  - sources: only superadmin may manage (manager → 403); binding a user who is not a marketer, is inactive, or belongs to clinic 2 → 422; a bad sheet link → 422; `syncEnabled: true` without a sheet → 422; changing the sheet resets the column map;
  - `/mine`: marketer A sees only leads of sources bound to A, not B's and nothing of clinic 2; unbinding empties the list with the same token; the key set of an item equals `id, receivedAt, fullName, phone, sourceName, stage`; superadmin and reception get 403; stage `visited` appears for a visited lead;
  - no response body of a 4xx contains the fixture phone or name.
- [ ] **Step 7:** Extend `marketerAccess.test.ts`: a marketer gets 403 on `GET /api/leads`, `PATCH /api/leads/1`, `GET /api/leads/sources`, `GET /api/leads/sources/manage`, `POST /api/leads/sources`.
- [ ] **Step 8: Run** the API tests and typecheck. Report, including the exact `ILeadsRepository` signatures Task 4 will use.

## Task 4: API — reading the sheet on a schedule

**Files:**
- Create: `services/api/src/services/leads/leadSheetSyncService.ts`, `leadSheetSyncService.test.ts`
- Modify: `services/api/src/controllers/leadsController.ts`, `services/api/src/routes/leadsRoutes.ts`, `services/api/src/container/services.ts`, `services/api/src/config/env.ts`, `services/api/src/server.ts`, `services/api/src/repositories/postgres/leads.test.ts`

**Interfaces:**
- Consumes: Task 2 modules; `LeadsService.ingestLeadRows`, `findSource`, `listSyncEnabledSources`, `recordSync` from Task 3.
- Produces: `POST /api/leads/sources/:id/check`, `POST /api/leads/sources/:id/sync`; `services.leadSheetSync`; `startLeadSheetSync()`.

- [ ] **Step 1: Service tests first**, with an injected `fetchSheet` stub and a PGlite-backed repository (or a fake repository where a database adds nothing):
  - `check`: returns headers, detected columns and counts; writes no lead and no `last_sync_*`;
  - `syncNow` on a sheet with three valid rows and one without a phone → `{status: "ok", rows: 4, added: 3, duplicates: 0, skipped: 1}`, `last_sync_status = 'ok'`, `last_sync_rows = 4`, `last_sync_skipped = 1`; a second run → `added: 0, duplicates: 3`;
  - empty body → `status: "empty"`, nothing inserted, `last_sync_status = 'empty'`;
  - fetch result `no_access` → status stored, nothing inserted, leads already in the table untouched;
  - a missing mapped header → `columns_not_found`, 0 rows inserted;
  - more than 5000 data rows → `too_large`, nothing inserted;
  - `runCycle`: processes only sources with `sync_enabled`, one after another, each with its own clinic id; a source of clinic 2 writes leads only into clinic 2; a failure of one source (thrown error) does not stop the next and is logged through `errorForLog` without cell values;
  - unchanged body between two cycles: the second cycle does not call the insert and still updates `last_sync_at`;
  - captured `console.*` output of a full cycle contains none of the fixture phones, names or the spreadsheet id.
- [ ] **Step 2: Implement** `LeadSheetSyncService` (`check`, `syncNow`, `runCycle`) and `startLeadSheetSync()`: first run 60 s after start, then every 5 min, a re-entrancy flag so cycles do not overlap, started only when `env.dataProvider === "postgres"` and the flag is on; one log line per cycle with counts only. The body hash (sha256, in a `Map` keyed by source id) is kept in the service instance.
- [ ] **Step 3: Env flag.** `LEADS_SHEET_SYNC_ENABLED` in `config/env.ts`, default on, `false`/`0`/`off` switch it off, following how the SMS flag is parsed. Start the poller in `server.ts` next to `startSmsReminderScheduler()`.
- [ ] **Step 4: Endpoints.** `check` and `sync` behind `allowPermission("LEAD_SOURCES_MANAGE")`; a source without a sheet → 422; a source of another clinic → 404. Route tests in `leads.test.ts` with the sheet fetch mocked at module level: superadmin gets 200 with the result; manager and marketer get 403; clinic 2's superadmin gets 404 for clinic 1's source.
- [ ] **Step 5: Run** the API tests and typecheck. Report.

## Task 5: Web — contractor role, labels, navigation guards

**Files:**
- Modify: `apps/web/src/auth/permissions.ts`, `permissions.test.ts`, `apps/web/src/auth/roleGroups.ts`, `apps/web/src/components/Sidebar.tsx`, `Sidebar.test.tsx`, `apps/web/src/layouts/MainLayout.tsx`, `apps/web/src/modules/users/pages/UsersPage.tsx`, `apps/web/src/shared/ui/MobileBottomNav.tsx`, `MobileBottomNav.test.tsx`, `apps/web/src/navigation/navigationConfig.test.ts`, `apps/web/src/locales/ru.json`, `uz.json`

**Interfaces:**
- Produces in `roleGroups.ts`: `EXTERNAL_ROLES: UserRole[]`, `isExternalRole(role: UserRole | null | undefined): boolean`, `CLINIC_STAFF` (all roles except external), `ROLE_LABEL_KEYS: Record<UserRole, string>`.

- [ ] **Step 1: Failing tests.** `permissions.test.ts`: `marketer` is denied for every module × action; `EXPECTED_QUEUE_ACTIONS` gains `marketer: []`; `CLINIC_STAFF` and `DASHBOARD_NAV_ROLES` do not contain `marketer`; `CLINIC_STAFF` equals `USER_ROLES` without `marketer`; `isExternalRole("marketer")` true, `("operator")` false, `(null)` false; for every role `ROLE_LABEL_KEYS[role]` resolves to a non-empty string in both `ru.json` and `uz.json`. `navigationConfig.test.ts`: no item (children included) lists `marketer` in `roles` (Task 7 later adds the one `/my-leads` item and narrows this assertion). `Sidebar.test.tsx`: rendered as `marketer`, no section headings; the user card shows the translated role. `MobileBottomNav.test.tsx`: as `marketer` the component renders `null`; as `superadmin` it still renders the four tabs and "More".
- [ ] **Step 2: Implement.** Mirror the role in `permissions.ts` (`marketer: {}`); in `roleGroups.ts` add `EXTERNAL_ROLES`, `isExternalRole`, derive `CLINIC_STAFF` by filtering, add `ROLE_LABEL_KEYS` with literal keys (`superadmin: "users.admin"`, `reception: "users.receptionist"`, `doctor: "users.doctor"`, `nurse: "users.nurse"`, `cashier: "users.cashier"`, `operator: "users.operator"`, `accountant: "users.accountant"`, `manager: "users.manager"`, `director: "users.director"`, `marketer: "users.marketer"`); verify each existing key in `ru.json` before relying on it. `MobileBottomNav`: after all hooks, `if (isExternalRole(user?.role)) return null;`.
- [ ] **Step 3: Role labels.** Use `ROLE_LABEL_KEYS` in `Sidebar.tsx` (replace the local map), in the `UsersPage` role dropdown (option text; the value stays the role id) and table chip, and in the `MainLayout` header. Add `"marketer": "Таргетолог"` to `users` in `ru.json` and `"marketer": "Targetolog"` in `uz.json`.
- [ ] **Step 4: Run** `npm test --prefix apps/web`, `npm run typecheck --prefix apps/web`, `npm run check-i18n --prefix apps/web`. Report.

## Task 6: Web — staff page «Лиды»

**Files:**
- Create: `apps/web/src/modules/leads/api/leadsTypes.ts`, `leadsApi.ts`, `leadsApi.test.ts`, `apps/web/src/modules/leads/utils/leadFormat.ts`, `leadFormat.test.ts`, `apps/web/src/modules/leads/pages/LeadsPage.tsx`, `LeadsPage.test.tsx`, `apps/web/src/modules/leads/components/LeadDetails.tsx`, `LeadDetails.test.tsx`
- Modify: `apps/web/src/auth/permissions.ts`, `permissions.test.ts`, `apps/web/src/auth/roleGroups.ts`, `apps/web/src/router/AppRouter.tsx`, `apps/web/src/navigation/navigationConfig.tsx`, `navigationConfig.test.ts`, `apps/web/src/layouts/MainLayout.tsx`, `apps/web/src/locales/ru.json`, `uz.json`

**Interfaces:**
- Consumes: the HTTP contract; `isExternalRole`, `ROLE_LABEL_KEYS` from Task 5.
- Produces: `leadsApi` with `list`, `update`, `patientMatches`, `setPatient`, `sources`, `sourcesManage`, `createSource`, `updateSource`, `checkSource`, `syncSource`, `mine` (all of them, so Task 7 only adds UI); in `roleGroups.ts`: `LEADS_ROLES = rolesWithPermission("leads","read")`, `LEADS_UPDATE_ROLES = rolesWithPermission("leads","update")`, `LEAD_SOURCES_MANAGE_ROLES = [...PERMISSIONS.LEAD_SOURCES_MANAGE]`, `MARKETER_ROLES = [...PERMISSIONS.LEADS_OWN_READ]`; in `leadFormat.ts`: `formatLeadPhone(digits: string): string`, `LEAD_STAGE_LABEL_KEYS: Record<LeadStage, string>`, `leadStageBadgeClass(stage: LeadStage): string`, `LEAD_STATUS_OPTIONS: LeadStatus[]` (the statuses staff may set: all but `new`).

- [ ] **Step 1: Permissions mirror.** Tests: module `leads`; `reception`, `operator`, `manager` have `read`, `update`; others nothing; `PERMISSIONS.LEAD_SOURCES_MANAGE` = `["superadmin"]`; `PERMISSIONS.LEADS_OWN_READ` = `["marketer"]`; `LEADS_ROLES` equals `["superadmin","reception","operator","manager"]` as a set. Implement in `permissions.ts` and `roleGroups.ts`.
- [ ] **Step 2: API module, test first** (pattern: `modules/queue/api/queueApi.test.ts`): every method maps to the exact path, method and body of the contract; query strings are built with `URLSearchParams` and omit empty filters.
- [ ] **Step 3: `leadFormat`, test first.** `formatLeadPhone("998901234567")` → `"+998 90 123 45 67"`; any other digit string → `"+" + digits`; every stage has a label key that exists in both locale files.
- [ ] **Step 4: Page, test first** (pattern: `modules/queue/pages/QueuePage.test.tsx`, react-test-renderer, mocked `react-i18next`, `AuthContext` and `leadsApi`): loads the list and sources on mount; shows received date, name or «Без имени», phone as an `<a href="tel:+…">`, source, stage badge; an API failure shows the error block with «Повторить», not the empty state; an empty list shows the empty state; changing a filter reloads with that filter; «Показать ещё» requests `beforeId = nextBeforeId` and appends; «Взять в работу» on a `new` lead calls `update(id, {status: "in_progress", expectedStatus: "new"})`; a 409 shows «Лид уже взял коллега» and reloads; roles without `leads.update` (none today except through future changes — test with a mocked role lacking update) see no action buttons. The filter «Статус» lists every stage including «Пришёл».
- [ ] **Step 5: `LeadDetails`, test first.** Shows `extra` as «заголовок: значение» lines rendered as text; a status select over `LEAD_STATUS_OPTIONS`; a note textarea saved with «Сохранить»; the patient block: when unlinked, «Найти пациента» loads `patientMatches` and lists candidates with «Привязать»; «Создать пациента» opens the existing patient-creation form/modal prefilled with the lead's name and `+phone` and `source: "advertising"`, then calls `setPatient` with the new id (find how other pages create a patient — `CreatePatientModal` or the quick-create form — and reuse it; hide the button for roles without `patients.create`); when linked: the patient's name, «Записать на приём» as a link to `/appointments?patientId=<id>` (hidden without `appointments.create`), «Отвязать».
- [ ] **Step 6: Route, navigation, titles, texts.** Lazy route `/leads` inside the protected layout with `RoleGuard roles={LEADS_ROLES}` (pattern: the `/queue` route); nav item `{labelKey: "pages.leads", path: "/leads", roles: LEADS_ROLES, icon}` in `nav.main` after the call-center item; `"/leads": "pages.leads"` in `MainLayout`'s route-title map; `pages.leads` = «Лиды» / «Lidlar»; a top-level `leads` namespace in both locale files for every text used. `navigationConfig.test.ts`: the item exists with these roles.
- [ ] **Step 7: Run** web tests, typecheck, check-i18n. Report.

## Task 7: Web — sources panel and the contractor's page

**Files:**
- Create: `apps/web/src/modules/leads/components/LeadSourcesPanel.tsx`, `LeadSourcesPanel.test.tsx`, `apps/web/src/modules/leads/components/LeadSourceFormModal.tsx`, `apps/web/src/modules/leads/pages/MyLeadsPage.tsx`, `MyLeadsPage.test.tsx`, `apps/web/src/router/AppRouter.test.tsx`
- Modify: `apps/web/src/modules/leads/pages/LeadsPage.tsx`, `apps/web/src/router/AppRouter.tsx`, `apps/web/src/navigation/navigationConfig.tsx`, `navigationConfig.test.ts`, `apps/web/src/layouts/MainLayout.tsx`, `apps/web/src/components/SubscriptionNotice.tsx`, `apps/web/src/components/Sidebar.test.tsx`, `apps/web/src/locales/ru.json`, `uz.json`

**Interfaces:**
- Consumes: `leadsApi`, `leadFormat`, role groups from Tasks 5–6.

- [ ] **Step 1: `LeadSourcesPanel`, test first** (pattern: `modules/queue/components/DisplaysPanel.test.tsx`). Rendered on `LeadsPage` only for `LEAD_SOURCES_MANAGE_ROLES`. Lists sources: name, contractor or «не привязан», sheet («подключена» / «не подключена»), reading on/off, last read time and a text for `lastSyncStatus`, counts «строк N, без телефона M», leads count. Actions: «Добавить источник», «Изменить», «Проверить таблицу», «Прочитать сейчас», the reading switch (disabled until the source has a sheet). The form modal: name, contractor select from `marketers` with «не привязан», sheet link input with the hint that the sheet must be open by link for reading. «Проверить таблицу» shows the result: the status text, the header list, detected phone and name columns; when the status is `columns_not_found` or the superadmin wants another column, two selects over `headers` save `columnMap` through `updateSource`. Every `LeadSyncStatus` has a Russian and an Uzbek text. A 422 from the API shows the API message.
- [ ] **Step 2: `MyLeadsPage`, test first.** Loads `leadsApi.mine()`; table: date, name or «Без имени», phone via `formatLeadPhone`, source, stage badge; «Показать ещё» with `beforeId`; empty state «Лиды появятся здесь после подключения вашей таблицы»; error block with «Повторить». No links to staff pages, no row actions.
- [ ] **Step 3: Routing for the contractor, test first** (`AppRouter.test.tsx`; mock page modules that do not load in node): `RoleAwareHomeRedirect` rendered as `marketer` yields `<Navigate to="/my-leads">` and never `DashboardPage`; as `reception` → `DashboardPage`; as `nurse` → `/appointments` as before. Export `RoleAwareHomeRedirect`. Add the lazy route `/my-leads` with `RoleGuard roles={MARKETER_ROLES}` in its own chunk; nav item `{labelKey: "pages.myLeads", path: "/my-leads", roles: MARKETER_ROLES, icon}`; `"/my-leads": "pages.myLeads"` in `MainLayout`; `pages.myLeads` = «Мои лиды» / «Mening lidlarim». `navigationConfig.test.ts`: the only item whose roles include `marketer` is `/my-leads`. `Sidebar.test.tsx`: as `marketer` exactly one link, `/my-leads`.
- [ ] **Step 4: Neutral subscription block for external roles, test first.** In `SubscriptionNotice.tsx`, when the signed-in role is external, the 402 block shows «Доступ временно недоступен. Обратитесь в клинику.» with no vendor contact and no dates; staff see the existing block unchanged.
- [ ] **Step 5: Run** web tests, typecheck, check-i18n, and `npm run build --prefix apps/web`. Report.

## Task 8: Docs, stand check, release (orchestrator)

- [ ] `docs/leads.md`: what the feature is, how to create the contractor's account and a source, how the sheet must be shared and which headers are recognised, status codes of reading, release order (API, then web), rollback.
- [ ] Local stand check in the browser (API on PGlite, web on port 5175): as superadmin create a source, check a sheet, read it; as reception take a lead, link a patient, book; as marketer see only «Мои лиды».
- [ ] `HANDOFF.md`: «Сделано», «Дальше», «Заметки».
- [ ] Fetch `origin/main`, rebase, re-run all checks, push, open the PR.
