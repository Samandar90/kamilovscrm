import { dbPool } from "../../config/database";
import { requireClinicId } from "../../tenancy/clinicContext";
import type { ICallCenterRepository } from "../interfaces/ICallCenterRepository";
import type {
  CallMarkInput,
  CallOutcome,
  CallQueueItem,
  CallReminderLog,
  CallReminderRule,
} from "../interfaces/callCenterTypes";

type QueueRow = {
  appointment_id: string | number;
  days_before: number;
  patient_id: string | number;
  patient_name: string;
  patient_phone: string | null;
  doctor_name: string;
  appointment_date: string;
  appointment_time: string;
  appointment_status: string;
  outcome: CallOutcome | null;
  note: string | null;
  called_by: string | number | null;
  called_by_name: string | null;
  called_at: Date | string | null;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export class PostgresCallCenterRepository implements ICallCenterRepository {
  async listRules(): Promise<CallReminderRule[]> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: string | number; days_before: number }>(
      `SELECT id, days_before FROM call_reminder_rules WHERE clinic_id = $1 ORDER BY days_before DESC`,
      [clinicId]
    );
    return result.rows.map((r) => ({ id: Number(r.id), daysBefore: r.days_before }));
  }

  async addRule(daysBefore: number): Promise<CallReminderRule> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: string | number; days_before: number }>(
      `
        INSERT INTO call_reminder_rules (clinic_id, days_before)
        VALUES ($1, $2)
        ON CONFLICT (clinic_id, days_before) DO UPDATE SET days_before = EXCLUDED.days_before
        RETURNING id, days_before
      `,
      [clinicId, daysBefore]
    );
    return { id: Number(result.rows[0].id), daysBefore: result.rows[0].days_before };
  }

  async removeRule(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: string | number }>(
      `DELETE FROM call_reminder_rules WHERE id = $1 AND clinic_id = $2 RETURNING id`,
      [id, clinicId]
    );
    return result.rows.length > 0;
  }

  async queueForDate(callDate: string): Promise<CallQueueItem[]> {
    const clinicId = requireClinicId();
    // start_at хранится как «настенное время как UTC» (см. smsReminderService),
    // поэтому настенная дата приёма — (start_at AT TIME ZONE 'UTC')::date.
    const result = await dbPool.query<QueueRow>(
      `
        SELECT
          a.id AS appointment_id,
          r.days_before,
          p.id AS patient_id,
          p.full_name AS patient_name,
          p.phone AS patient_phone,
          d.full_name AS doctor_name,
          to_char(a.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS appointment_date,
          to_char(a.start_at AT TIME ZONE 'UTC', 'HH24:MI') AS appointment_time,
          a.status AS appointment_status,
          l.outcome,
          l.note,
          l.called_by,
          cu.full_name AS called_by_name,
          l.called_at
        FROM call_reminder_rules r
        JOIN appointments a
          ON a.clinic_id = r.clinic_id
          AND a.deleted_at IS NULL
          AND a.status IN ('scheduled', 'confirmed')
          AND (a.start_at AT TIME ZONE 'UTC')::date = $2::date + r.days_before
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        LEFT JOIN call_reminder_logs l
          ON l.appointment_id = a.id AND l.days_before = r.days_before
        LEFT JOIN users cu ON cu.id = l.called_by
        WHERE r.clinic_id = $1
        ORDER BY r.days_before DESC, a.start_at, a.id
      `,
      [clinicId, callDate]
    );
    return result.rows.map((row) => ({
      appointmentId: Number(row.appointment_id),
      daysBefore: row.days_before,
      patientId: Number(row.patient_id),
      patientName: row.patient_name,
      patientPhone: row.patient_phone,
      doctorName: row.doctor_name,
      appointmentDate: row.appointment_date,
      appointmentTime: row.appointment_time,
      appointmentStatus: row.appointment_status,
      log: row.outcome
        ? {
            outcome: row.outcome,
            note: row.note,
            calledBy: row.called_by == null ? null : Number(row.called_by),
            calledByName: row.called_by_name,
            calledAt: row.called_at ? toIso(row.called_at) : "",
          }
        : null,
    }));
  }

  async mark(input: CallMarkInput): Promise<CallReminderLog> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{
      outcome: CallOutcome;
      note: string | null;
      called_by: string | number | null;
      called_at: Date | string;
    }>(
      `
        INSERT INTO call_reminder_logs
          (clinic_id, appointment_id, days_before, outcome, note, called_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (appointment_id, days_before) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          note = EXCLUDED.note,
          called_by = EXCLUDED.called_by,
          called_at = now()
        RETURNING outcome, note, called_by, called_at
      `,
      [clinicId, input.appointmentId, input.daysBefore, input.outcome, input.note, input.calledBy]
    );
    const row = result.rows[0];
    const nameResult = await dbPool.query<{ full_name: string | null }>(
      `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
      [input.calledBy]
    );
    return {
      outcome: row.outcome,
      note: row.note,
      calledBy: row.called_by == null ? null : Number(row.called_by),
      calledByName: nameResult.rows[0]?.full_name ?? null,
      calledAt: toIso(row.called_at),
    };
  }
}
