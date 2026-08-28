import { ApiError } from "../../middleware/errorHandler";
import { requireClinicId } from "../../tenancy/clinicContext";
import { nextRetryAt } from "../../services/callCenterWorkspaceService";
import type { ICallCenterWorkspaceRepository } from "../interfaces/ICallCenterWorkspaceRepository";
import { DEFAULT_WORKSPACE_SETTINGS } from "../interfaces/callCenterWorkspaceTypes";
import type { ContactAttempt, WorkspaceAttemptInput, WorkspaceClaim, WorkspaceCounts, WorkspaceFilters, WorkspacePatient, WorkspaceResult, WorkspaceSettings } from "../interfaces/callCenterWorkspaceTypes";

// Inject the pool so SQL tests can execute real PostgreSQL without loading application credentials.
export interface WorkspaceQueryClient { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
export interface WorkspacePool extends WorkspaceQueryClient { connect(): Promise<WorkspaceQueryClient & { release(): void }> }
const iso = (value: Date | string | null): string | null => value == null ? null : new Date(value).toISOString();
const numberOrNull = (value: unknown): number | null => value == null ? null : Number(value);
const mapAttempt = (r: any): ContactAttempt => ({
  id: Number(r.id), patientId: Number(r.patient_id), patientName: r.patient_name,
  campaign: r.campaign, outcome: r.outcome, note: r.note, calledAt: iso(r.called_at)!,
  calledByName: r.called_by_name, callbackAt: iso(r.callback_at),
});

/** $1 clinic, $2 settings JSON, $3 reporting timezone. Appointment timestamps are wall-clock-as-UTC. */
const WORKSPACE_CTE = `WITH config AS (SELECT $2::jsonb AS s),
  patient_facts AS (
    SELECT p.id AS patient_id, p.full_name AS patient_name, p.phone,
      lv.id AS last_appointment_id, lv.start_at AS last_visit_at, lv.doctor_id AS last_doctor_id,
      lv.doctor_name AS last_doctor_name, COALESCE(lv.visits_count, 0) AS visits_count,
      nv.id AS next_appointment_id, nv.start_at AS next_visit_at, nv.doctor_id AS next_doctor_id, nv.doctor_name AS next_doctor_name
    FROM patients p
    LEFT JOIN LATERAL (
      SELECT a.id, a.start_at, a.doctor_id, d.full_name AS doctor_name, count(*) OVER () AS visits_count
      FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id AND d.clinic_id=$1
      WHERE a.patient_id=p.id AND a.clinic_id=$1 AND a.deleted_at IS NULL AND a.status='completed'
        AND (a.start_at AT TIME ZONE 'UTC') <= (now() AT TIME ZONE $3)
      ORDER BY a.start_at DESC, a.id DESC LIMIT 1
    ) lv ON true
    LEFT JOIN LATERAL (
      SELECT a.id, a.start_at, a.doctor_id, d.full_name AS doctor_name
      FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id AND d.clinic_id=$1
      WHERE a.patient_id=p.id AND a.clinic_id=$1 AND a.deleted_at IS NULL
        AND a.status IN ('scheduled','confirmed','arrived','in_consultation')
        AND (a.start_at AT TIME ZONE 'UTC') > (now() AT TIME ZONE $3)
      ORDER BY a.start_at, a.id LIMIT 1
    ) nv ON true
    WHERE p.clinic_id=$1 AND p.deleted_at IS NULL
  ), candidates AS (
    SELECT patient_id, 'base'::text AS campaign, 'patient:' || patient_id AS episode_key, NULL::timestamptz AS default_due FROM patient_facts
    UNION ALL
    SELECT f.patient_id, 'recall', 'visit:' || f.last_appointment_id,
      ((f.last_visit_at AT TIME ZONE 'UTC') + (s->>'recallDays')::int * interval '1 day') AT TIME ZONE $3
    FROM patient_facts f CROSS JOIN config WHERE (s->>'recallEnabled')::boolean AND f.next_appointment_id IS NULL
      AND (f.last_visit_at AT TIME ZONE 'UTC') <= (now() AT TIME ZONE $3) - (s->>'recallDays')::int * interval '1 day'
    UNION ALL
    SELECT f.patient_id, 'followup', 'visit:' || f.last_appointment_id,
      ((f.last_visit_at AT TIME ZONE 'UTC') + (s->>'followupDays')::int * interval '1 day') AT TIME ZONE $3
    FROM patient_facts f CROSS JOIN config WHERE (s->>'followupEnabled')::boolean
      AND (f.last_visit_at AT TIME ZONE 'UTC') <= (now() AT TIME ZONE $3) - (s->>'followupDays')::int * interval '1 day'
    UNION ALL
    SELECT f.patient_id, 'reminder', 'appointment:' || f.next_appointment_id,
      ((f.next_visit_at AT TIME ZONE 'UTC') - (s->>'reminderDays')::int * interval '1 day') AT TIME ZONE $3
    FROM patient_facts f CROSS JOIN config WHERE (s->>'reminderEnabled')::boolean
      AND (f.next_visit_at AT TIME ZONE 'UTC')::date <= (now() AT TIME ZONE $3)::date + (s->>'reminderDays')::int
  ), work AS (
    SELECT c.patient_id, c.campaign, c.episode_key, c.campaign AS segment, t.id AS task_id,
      COALESCE(t.status,'new') AS status, COALESCE(t.due_at,c.default_due) AS due_at,
      COALESCE(t.attempts,0) AS attempts, t.assigned_to
    FROM candidates c LEFT JOIN call_center_tasks t ON t.clinic_id=$1 AND t.patient_id=c.patient_id AND t.campaign=c.campaign AND t.episode_key=c.episode_key
    UNION ALL
    SELECT t.patient_id,t.campaign,t.episode_key,'callbacks',t.id,t.status,t.due_at,t.attempts,t.assigned_to
    FROM call_center_tasks t JOIN patient_facts p ON p.patient_id=t.patient_id WHERE t.clinic_id=$1 AND t.status='callback'
  )`;

export class PostgresCallCenterWorkspaceRepository implements ICallCenterWorkspaceRepository {
  constructor(private readonly pool: WorkspacePool, private readonly timeZone = "Asia/Tashkent") {}

  private async settings(client: WorkspaceQueryClient): Promise<WorkspaceSettings> {
    const result = await client.query("SELECT settings FROM call_center_settings WHERE clinic_id=$1", [requireClinicId()]);
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...result.rows[0]?.settings };
  }
  getSettings() { return this.settings(this.pool); }
  async saveSettings(settings: WorkspaceSettings) {
    await this.pool.query(`INSERT INTO call_center_settings(clinic_id,settings) VALUES($1,$2::jsonb)
      ON CONFLICT(clinic_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`, [requireClinicId(), JSON.stringify(settings)]);
    return settings;
  }
  private params(settings: WorkspaceSettings): unknown[] { return [requireClinicId(), JSON.stringify(settings), this.timeZone]; }
  async preview(settings: WorkspaceSettings): Promise<WorkspaceCounts> {
    const result = await this.pool.query(`${WORKSPACE_CTE} SELECT
      count(*) FILTER(WHERE segment='base') AS base,
      count(*) FILTER(WHERE segment='recall' AND status IN ('new','callback')) AS recall,
      count(*) FILTER(WHERE segment='followup' AND status IN ('new','callback')) AS followup,
      count(*) FILTER(WHERE segment='reminder' AND status IN ('new','callback')) AS reminder,
      count(*) FILTER(WHERE segment='callbacks') AS callbacks FROM work`, this.params(settings));
    const r = result.rows[0];
    return { base: Number(r.base), recall: Number(r.recall), followup: Number(r.followup), reminder: Number(r.reminder), callbacks: Number(r.callbacks) };
  }
  async workspace(filters: WorkspaceFilters): Promise<WorkspaceResult> {
    const settings = await this.getSettings();
    const params = [...this.params(settings), filters.segment, filters.status, `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`, filters.doctorId, filters.operatorId];
    const filterSql = `FROM work w JOIN patient_facts p ON p.patient_id=w.patient_id WHERE w.segment=$4
      AND CASE $5::text
        WHEN 'all' THEN (w.segment='base' OR w.status IN ('new','callback'))
        WHEN 'new' THEN w.status='new'
        WHEN 'callback' THEN w.status='callback'
        WHEN 'overdue' THEN w.status IN ('new','callback') AND w.due_at < now()
        WHEN 'done' THEN w.status IN ('done','exhausted') ELSE false END
      AND (p.patient_name ILIKE $6 OR COALESCE(p.phone,'') ILIKE $6)
      AND ($7::bigint IS NULL OR p.last_doctor_id=$7 OR p.next_doctor_id=$7)
      AND ($8::bigint IS NULL OR w.assigned_to=$8)`;
    const [total, rows, counts, doctors, operators] = await Promise.all([
      this.pool.query(`${WORKSPACE_CTE} SELECT count(*) AS total ${filterSql}`, params),
      this.pool.query(`${WORKSPACE_CTE}, filtered AS (SELECT w.*, p.patient_name,p.phone,p.last_visit_at,p.last_doctor_id,p.last_doctor_name,p.visits_count,p.next_appointment_id,p.next_visit_at,p.next_doctor_name ${filterSql}
        ORDER BY w.due_at ASC NULLS LAST,p.patient_name,p.patient_id,w.task_id LIMIT 30 OFFSET $9)
        SELECT f.*, au.full_name AS assigned_to_name, l.claimed_by, cu.full_name AS claimed_by_name,l.expires_at AS claim_expires_at,
          contact.outcome AS last_outcome,contact.called_at AS last_contact_at
        FROM filtered f
        LEFT JOIN users au ON au.id=f.assigned_to AND au.clinic_id=$1
        LEFT JOIN call_patient_leases l ON l.clinic_id=$1 AND l.patient_id=f.patient_id AND l.expires_at>now()
        LEFT JOIN users cu ON cu.id=l.claimed_by AND cu.clinic_id=$1
        LEFT JOIN LATERAL (SELECT a.outcome,a.called_at FROM call_contact_attempts a WHERE a.clinic_id=$1 AND a.patient_id=f.patient_id
          AND (f.campaign='base' OR a.task_id=f.task_id) ORDER BY a.called_at DESC,a.id DESC LIMIT 1) contact ON true
        ORDER BY f.due_at ASC NULLS LAST,f.patient_name,f.patient_id,f.task_id`, [...params, (filters.page - 1) * 30]),
      this.preview(settings),
      this.pool.query("SELECT id,full_name AS name FROM doctors WHERE clinic_id=$1 AND deleted_at IS NULL AND active=true ORDER BY full_name,id", [requireClinicId()]),
      this.pool.query("SELECT id,full_name AS name FROM users WHERE clinic_id=$1 AND deleted_at IS NULL AND is_active=true AND role IN ('operator','superadmin') ORDER BY full_name,id", [requireClinicId()]),
    ]);
    return {
      items: rows.rows.map((r): WorkspacePatient => ({
        patientId: Number(r.patient_id), patientName: r.patient_name, phone: r.phone,
        lastVisitAt: iso(r.last_visit_at), lastDoctorId: numberOrNull(r.last_doctor_id), lastDoctorName: r.last_doctor_name,
        nextAppointmentId: numberOrNull(r.next_appointment_id), nextVisitAt: iso(r.next_visit_at), nextDoctorName: r.next_doctor_name, visitsCount: Number(r.visits_count),
        taskId: numberOrNull(r.task_id), episodeKey: r.episode_key, campaign: r.campaign, dueAt: iso(r.due_at), status: r.status, attempts: Number(r.attempts),
        assignedTo: numberOrNull(r.assigned_to), assignedToName: r.assigned_to_name,
        claimedBy: numberOrNull(r.claimed_by), claimedByName: r.claimed_by_name, claimExpiresAt: iso(r.claim_expires_at),
        lastOutcome: r.last_outcome, lastContactAt: iso(r.last_contact_at),
      })), total: Number(total.rows[0].total), page: filters.page, pageSize: 30, counts,
      doctors: doctors.rows.map(r => ({ id: Number(r.id), name: r.name })), operators: operators.rows.map(r => ({ id: Number(r.id), name: r.name })), settings,
    };
  }
  async history(patientId: number | null, page: number) {
    const clinicId = requireClinicId();
    if (patientId !== null) await this.patient(this.pool, patientId, false);
    const params = [clinicId, patientId];
    // Legacy upsert logs remain in their original table. Negative IDs identify them
    // without importing/duplicating records or colliding with new immutable attempts.
    const historySql = `WITH history AS (
      SELECT id,patient_id,patient_name,campaign,outcome,note,called_at,called_by_name,callback_at
      FROM call_contact_attempts WHERE clinic_id=$1
      UNION ALL
      SELECT -l.id,p.id,p.full_name,'reminder',l.outcome,l.note,l.called_at,u.full_name,NULL::timestamptz
      FROM call_reminder_logs l
      JOIN appointments a ON a.id=l.appointment_id AND a.clinic_id=$1
      JOIN patients p ON p.id=a.patient_id AND p.clinic_id=$1
      LEFT JOIN users u ON u.id=l.called_by AND u.clinic_id=$1
      WHERE l.clinic_id=$1
    )`;
    const where = "WHERE ($2::bigint IS NULL OR patient_id=$2)";
    const [rows, count] = await Promise.all([
      this.pool.query(`${historySql} SELECT * FROM history ${where} ORDER BY called_at DESC,id DESC LIMIT 30 OFFSET $3`, [...params, (page - 1) * 30]),
      this.pool.query(`${historySql} SELECT count(*) AS total FROM history ${where}`, params),
    ]);
    return { items: rows.rows.map(mapAttempt), total: Number(count.rows[0].total) };
  }
  private async transaction<T>(fn: (client: WorkspaceQueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private async patient(client: WorkspaceQueryClient, patientId: number, lock = true) {
    const result = await client.query(`SELECT id,full_name FROM patients WHERE id=$1 AND clinic_id=$2 AND deleted_at IS NULL ${lock ? "FOR UPDATE" : ""}`, [patientId, requireClinicId()]);
    if (!result.rows[0]) throw new ApiError(404, "Пациент не найден");
    return result.rows[0];
  }
  private async operator(client: WorkspaceQueryClient, operatorId: number) {
    const result = await client.query("SELECT id,full_name FROM users WHERE id=$1 AND clinic_id=$2 AND deleted_at IS NULL AND is_active=true AND role IN ('operator','superadmin')", [operatorId, requireClinicId()]);
    if (!result.rows[0]) throw new ApiError(400, "Оператор не найден в этой клинике");
    return result.rows[0];
  }
  async claim(input: WorkspaceClaim): Promise<{ taskId: number }> {
    return this.transaction(async client => {
      const clinicId = requireClinicId();
      // Every claim/attempt locks the same clinic patient before reading the lease.
      await this.patient(client, input.patientId);
      await this.operator(client, input.operatorId);
      const lease = await client.query("SELECT claimed_by FROM call_patient_leases WHERE clinic_id=$1 AND patient_id=$2 AND expires_at>now()", [clinicId, input.patientId]);
      if (lease.rows[0] && Number(lease.rows[0].claimed_by) !== input.operatorId) throw new ApiError(409, "Пациент уже в работе у другого оператора");
      const existing = await client.query("SELECT * FROM call_center_tasks WHERE clinic_id=$1 AND patient_id=$2 AND campaign=$3 AND episode_key=$4 FOR UPDATE", [clinicId, input.patientId, input.campaign, input.episodeKey]);
      let task = existing.rows[0];
      if (task && task.status !== "callback" && input.campaign !== "base" && ["done", "exhausted"].includes(task.status)) throw new ApiError(409, "Задача уже завершена");
      if (!task || task.status !== "callback") {
        const settings = await this.settings(client);
        const valid = await client.query(`${WORKSPACE_CTE} SELECT * FROM candidates WHERE patient_id=$4 AND campaign=$5 AND episode_key=$6`, [...this.params(settings), input.patientId, input.campaign, input.episodeKey]);
        if (!valid.rows[0]) throw new ApiError(409, "Эпизод устарел. Обновите список пациентов");
        if (!task) {
          const created = await client.query(`INSERT INTO call_center_tasks(clinic_id,patient_id,campaign,episode_key,due_at) VALUES($1,$2,$3,$4,$5) RETURNING *`, [clinicId,input.patientId,input.campaign,input.episodeKey,valid.rows[0].default_due]);
          task = created.rows[0];
        }
      }
      if (input.campaign === "base" && ["done", "exhausted"].includes(task.status)) {
        // The patient base supports a new conversation cycle. Keep the task ID and
        // all immutable contacts, but give the new cycle its full retry allowance.
        await client.query("UPDATE call_center_tasks SET status='new',attempts=0,due_at=NULL,updated_at=now() WHERE id=$1 AND clinic_id=$2", [task.id,clinicId]);
      }
      await client.query(`INSERT INTO call_patient_leases(clinic_id,patient_id,task_id,claimed_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')
        ON CONFLICT(clinic_id,patient_id) DO UPDATE SET task_id=EXCLUDED.task_id,claimed_by=EXCLUDED.claimed_by,expires_at=EXCLUDED.expires_at`, [clinicId,input.patientId,task.id,input.operatorId]);
      return { taskId: Number(task.id) };
    });
  }
  async release(patientId: number, operatorId: number, taskId?: number) {
    await this.pool.query("DELETE FROM call_patient_leases WHERE clinic_id=$1 AND patient_id=$2 AND claimed_by=$3 AND ($4::bigint IS NULL OR task_id=$4)", [requireClinicId(),patientId,operatorId,taskId ?? null]);
  }
  async attempt(input: WorkspaceAttemptInput): Promise<ContactAttempt> {
    return this.transaction(async client => {
      const clinicId = requireClinicId();
      const initial = await client.query("SELECT patient_id FROM call_center_tasks WHERE id=$1 AND clinic_id=$2", [input.taskId,clinicId]);
      if (!initial.rows[0]) throw new ApiError(404, "Задача не найдена");
      const patientId = Number(initial.rows[0].patient_id);
      const patient = await this.patient(client, patientId);
      const prior = await client.query("SELECT * FROM call_contact_attempts WHERE clinic_id=$1 AND called_by=$2 AND request_id=$3", [clinicId,input.operatorId,input.requestId]);
      if (prior.rows[0]) {
        const old = prior.rows[0];
        if (Number(old.task_id) !== input.taskId || old.outcome !== input.outcome || old.note !== input.note || (input.outcome === "callback" && iso(old.callback_at) !== input.callbackAt)) throw new ApiError(409, "requestId уже использован для другого результата");
        return mapAttempt(old);
      }
      if (input.outcome === "callback" && (!input.callbackAt || Date.parse(input.callbackAt) <= Date.now())) throw new ApiError(400, "Укажите будущее время обратного звонка");
      const user = await this.operator(client, input.operatorId);
      const task = (await client.query("SELECT * FROM call_center_tasks WHERE id=$1 AND clinic_id=$2 FOR UPDATE", [input.taskId,clinicId])).rows[0];
      const lease = await client.query("SELECT task_id FROM call_patient_leases WHERE clinic_id=$1 AND patient_id=$2 AND task_id=$3 AND claimed_by=$4 AND expires_at>now()", [clinicId,patientId,input.taskId,input.operatorId]);
      if (!lease.rows[0]) throw new ApiError(409, "Сначала возьмите пациента в работу: блокировка отсутствует или истекла");
      const settings = await this.settings(client);
      const attempts = Number(task.attempts) + 1;
      const retry = input.outcome === "no_answer" && attempts < settings.maxAttempts;
      const callbackAt = input.outcome === "callback" ? input.callbackAt : retry ? nextRetryAt(new Date(),settings,this.timeZone) : null;
      const status = input.outcome === "callback" || retry ? "callback" : input.outcome === "no_answer" ? "exhausted" : "done";
      const saved = await client.query(`INSERT INTO call_contact_attempts(clinic_id,task_id,patient_id,patient_name,campaign,outcome,note,called_by,called_by_name,callback_at,request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [clinicId,input.taskId,patientId,patient.full_name,task.campaign,input.outcome,input.note,input.operatorId,user.full_name,callbackAt,input.requestId]);
      await client.query("UPDATE call_center_tasks SET status=$3,attempts=$4,due_at=$5,updated_at=now() WHERE id=$1 AND clinic_id=$2", [input.taskId,clinicId,status,attempts,callbackAt]);
      await client.query("DELETE FROM call_patient_leases WHERE clinic_id=$1 AND patient_id=$2 AND claimed_by=$3", [clinicId,patientId,input.operatorId]);
      return mapAttempt(saved.rows[0]);
    });
  }
  async assign(taskId: number, operatorId: number | null) {
    return this.transaction(async client => {
      if (operatorId !== null) await this.operator(client, operatorId);
      const result = await client.query("UPDATE call_center_tasks SET assigned_to=$3,updated_at=now() WHERE id=$1 AND clinic_id=$2 RETURNING id", [taskId,requireClinicId(),operatorId]);
      if (!result.rows[0]) throw new ApiError(404, "Задача не найдена");
    });
  }
}
