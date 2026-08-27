# Call-center implementation plan

**Goal:** A patient-first call center with configurable recall, follow-up and appointment reminders, durable callbacks and append-only contact history.
**Architecture:** Extend the existing call-center router, retain old reminder endpoints, add a patient workspace service/repository and additive migration 032. No production data changes or deployment in this phase.
**Tech stack:** Existing React/TypeScript/i18next, Express, pg, Vitest. No new runtime dependencies.
**Spec:** User-approved design in this task; the exact contract below is the implementation specification.

## Constraints and decisions
- Work in local branch codex/call-center-workspace, preserve unrelated changes and existing installed dependencies. No push or production migration.
- All reads/writes are clinic-scoped; role superadmin configures, operator works.
- Base shows patients without a future appointment or a configured reminder being required.
- Recall requires a completed visit older than recallDays and no future active appointment. Followup requires last completed visit older than followupDays. Reminders use upcoming active appointments within reminderDays. Distinct tasks per campaign and visit episode.
- All contact attempts append; no_answer schedules a retry within work hours until maxAttempts. Explicit callback requires a future instant. Completed tasks stay out of campaign pending work, visible in history/base. Callback tasks persist independently of current campaign eligibility.
- Patient-level exclusive lease prevents two operators processing the same patient at once; attempt idempotency protects double submit. No automatic dialing or SMS.
- Existing scheduling page handles creating/moving/cancelling appointments; a call outcome alone must not imply a scheduling mutation.
- RU and UZ text parity, responsive table + detail panel, nonempty base as default, clear empty/error/loading states.

## HTTP contract (under /api/call-center)
GET /workspace?segment=base|recall|followup|reminder|callbacks&search=&page=1&status=all|new|callback|overdue|done&doctorId=&operatorId=
returns {items: WorkspacePatient[], total:number, page:number, pageSize:30, counts:{base,recall,followup,reminder,callbacks}, doctors:NamedOption[], operators:NamedOption[], settings:WorkspaceSettings}.

WorkspaceSettings = {recallEnabled:boolean,recallDays:number,followupEnabled:boolean,followupDays:number,reminderEnabled:boolean,reminderDays:number,workStart:string,workEnd:string,retryMinutes:number,maxAttempts:number,script:string}.
Default: recall 90 days, followup 3 days, reminder 1 day; enabled true; hours 09:00–18:00; retry 120 minutes; maxAttempts 3. Script supports {patient}, {doctor}, {lastVisit}, {nextVisit}.

WorkspacePatient = {patientId:number,patientName:string,phone:string|null,lastVisitAt:string|null,lastDoctorName:string|null,lastDoctorId:number|null,nextAppointmentId:number|null,nextVisitAt:string|null,nextDoctorName:string|null,visitsCount:number,taskId:number|null,episodeKey:string,campaign:'base'|'recall'|'followup'|'reminder',dueAt:string|null,status:'new'|'callback'|'done'|'exhausted',attempts:number,assignedTo:number|null,assignedToName:string|null,claimedBy:number|null,claimedByName:string|null,claimExpiresAt:string|null,lastOutcome:string|null,lastContactAt:string|null}.
NamedOption = {id:number,name:string}.

GET /settings returns WorkspaceSettings. PUT /settings accepts WorkspaceSettings (admin only).
POST /preview accepts WorkspaceSettings (admin only), returns {base,recall,followup,reminder,callbacks} without changing settings.
GET /history?patientId=123&page=1 returns {items:ContactAttempt[],total:number} (omit patientId for clinic history).
ContactAttempt = {id:number,patientId:number,patientName:string,campaign:string,outcome:string,note:string|null,calledAt:string,calledByName:string|null,callbackAt:string|null}.
POST /claim accepts {patientId,campaign,episodeKey} returns {taskId:number}. Reject foreign patient or stale episode, and active other-operator lease with 409; own lease renewed. Lease 10 min.
POST /release accepts {patientId:number}, returns {success:true}; only own lease released.
POST /attempts accepts {taskId:number,outcome:'contacted'|'confirmed'|'no_answer'|'callback'|'declined'|'wrong_number',note:string|null,callbackAt:string|null,requestId:string} returns ContactAttempt. Valid lease mandatory, update task + append attempt atomically and release lease.
POST /assign accepts {taskId:number,operatorId:number|null} (admin only) returns {success:true}; operator must belong to clinic and have operator/superadmin role.

## Tasks
- [x] Backend: write failing service/repository tests for validation, existing-patient selection, campaign eligibility, foreign clinic rejection, callbacks/history and claim conflicts; run Vitest to establish RED. Implement typed contracts, additive schema, SQL repository and router endpoints. Run tests and API typecheck.
- [x] Frontend: implement matching API client; workspace with segment sidebar, counts, search/filters/paging, selectable patients and detail action panel; settings with editable controls + preview; history with immutable attempts; RU/UZ translations. Validate typecheck, i18n and build. Keep request races and unsaved notes safe.
- [x] Integration: validate migration and repository queries against isolated PostgreSQL-compatible test DB, exercise workflows, inspect rendered UI at desktop/mobile, review changes and fix findings. Summarize production migration/deployment requirements without deploying.

## Verification
`npm test` and `npm run typecheck` in services/api; `npm run typecheck` and `npm run build` in apps/web. A successful build alone is not evidence of working SQL or UI.

## Verification result
47 API tests and 10 web tests passed; both typechecks and production builds passed. Browser verified existing-patient base, claim/save/no-answer callback, history, settings preview/save, RU/UZ and 390px mobile layout against isolated synthetic PGlite data. Independent review findings fixed and re-reviewed. Local branch only; no production mutations or publishing.
