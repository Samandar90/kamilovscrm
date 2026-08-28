# Call-center daily workflow implementation plan

**Goal:** Implement the four improvements approved in this conversation: daily queue, bounded campaign dates, clinician-recommended return dates, and patient contact safeguards.
**Architecture:** Extend the existing call-center service/repository and React components. Add migration 033 for appointment return dates and patient contact preferences; reuse appointment clinical-write authorization. No new runtime dependencies or automatic calls/messages.
**Spec:** User-approved items 1–4 in this conversation; exact decisions below. Booking-in-panel, analytics and telephony are not part of this increment.

## Contract and decisions

- Existing campaigns remain `base|recall|followup|reminder`; segments add `today|archive` to existing segments. Base remains accessible. Today is the default operator view, one row per patient, prioritized due callbacks, reminders, recommended returns, recall, followup. Future callbacks today stay visible but are not callable early; a pending callback suppresses competing campaigns. Old followups are in archive, not today's queue.
- Settings add `followupMaxDays:14` (>=followupDays), `returnLeadDays:7`, `maxCallsPerDay:3`, `minContactIntervalMinutes:120`; existing settings JSON merges defaults. Followup has inclusive lower/upper age bounds. These are operational defaults, not medical advice.
- `WorkspacePatient` adds `contactPreferences:{doNotCall:boolean,preferredLanguage:'ru'|'uz'|null,preferredCallStart:string|null,preferredCallEnd:string|null}`, `recommendedReturnDate:string|null`, `reason:'base'|'callback'|'reminder'|'recommended_return'|'recall'|'followup'`, and `contactBlockReason:'do_not_call'|'no_phone'|'outside_hours'|'daily_limit'|'cooldown'|'callback_scheduled'|null`.
- Response adds `dailyProgress:{completed:number,pending:number}`. Completed is distinct patients contacted today; pending is distinct today's patients still needing work, not a misleading conversion rate. Display labels explicitly as clinic-wide when filters are active.
- `PUT /api/call-center/patients/:patientId/preferences` accepts the complete preferences object; operator/superadmin only, clinic scoped, canonical nullable HH:mm pair (both present or both null), start<end. Server enforces DNC, phone, work window intersection, per-patient rolling cooldown and clinic-day maximum across campaigns during claim; attempts recheck DNC/global limits under same patient lock. Retrying an already committed request remains idempotent before new policy checks. No emergency/medical triage decisions.
- Preferences table: `call_center_patient_preferences(clinic_id,patient_id,do_not_call,preferred_language,preferred_call_start,preferred_call_end,updated_by,updated_at)` with clinic+patient PK and constraints. Concurrent preferences/claim/attempt writes serialize on patient row. No cross-clinic writes.
- `appointments.recommended_return_date DATE NULL`; API `recommendedReturnDate?:string|null`. Valid actual YYYY-MM-DD strictly after appointment's local visit date, nullable clearing, only clinical-authorized roles, existing doctor ownership guard. Included in normal update and complete payload, Postgres reads/writes and mock provider.
- Latest completed visit's recommended date drives recall priority from `date - returnLeadDays`; fallback recallDays applies only without a recommendation. An active future appointment suppresses return invitation and related recall callbacks (logical closure while booking is active, no invented call outcome; cancellation can make invitation relevant again).
- Base/archive can show blocked patients with reasons; cannot bypass server guards. Non-base working queues exclude DNC/no phone where appropriate. No resetting prior contact history or settings.
- UI supports reasons, daily progress, safe Next action without dropping drafts, patient preferences form, new setting inputs, all RU/UZ keys. Preserve existing ambiguous-save retry and lease safety.
- Work on branch `codex/call-center-daily-workflow` from deployed origin/main; preserve unrelated `.claude/`. Local work first. Production release requires additive migration before API/web update.

## Tasks / owners

- [x] Backend worker: extend call-center contracts/service/repository/routes and SQL tests. RED tests for dedup priority, bounded/archive eligibility, preferred hours, DNC/cooldown/daily cap across campaigns, recommendation eligibility and booked suppression, tenant and idempotency safety; GREEN minimal implementation. Own only call-center API files/tests and preview script.
- [x] Frontend worker: extend call-center API/types/components/CSS/locales, today/archive/reasons/progress/next/preferences/settings. RED component regression tests for blocked calls, preferences, stale responses/next navigation; GREEN. Own call-center frontend and RU/UZ JSON. Include doctorWorkspace.returnDate/returnDateHint labels for parent integration.
- [x] Parent: migration 033 plus appointment recommendedReturnDate end-to-end and doctor form. Extend existing appointment service tests for valid date persistence, invalid calendar date, date before visit, forbidden operator and unrelated doctor; exercise Postgres mapping/update through real SQL where practical. Update preview schema to consume migration in coordination with backend owner.
- [x] Integration: API/web tests, typechecks/build, isolated PGlite/browser workflows, independent review and fixes, docs, then report exact release state.

## Interface check

| Producers / consumers | Shared surface | Decision |
| --- | --- | --- |
| Backend / frontend | New types, endpoints above | Fixed here before parallel work |
| Parent / backend | migration033 and appointments.recommended_return_date | Parent owns schema; backend owns fixture adjustments and query use |
| Parent / frontend | doctorWorkspace.returnDate labels | Frontend adds labels; parent changes doctor form only |
| All tasks | Existing history and auth | No replacement or weakening |

## Verification commands

`npm test --prefix services/api`; `npm run build --prefix services/api`; `npm test --prefix apps/web`; `npm run typecheck --prefix apps/web`; `npm run build --prefix apps/web`.

Baseline: 47 API + 10 web tests passed on 2026-08-28 before changes.


Verification 2026-08-28: 74 API tests and 33 web tests passed; API build, web typecheck/build and RU/UZ parity passed. Independent review clean after a PostgreSQL DATE timezone regression fix. Synthetic browser checks: settings save, recommendation display, DNC persistence and blocked claim, save-and-next with fresh queue, mobile layout. Production release tracked separately in this task.
