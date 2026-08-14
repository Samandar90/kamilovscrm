import { dbPool } from "../../config/database";
import { requireClinicId } from "../../tenancy/clinicContext";
import type { IAttendanceRepository } from "../interfaces/IAttendanceRepository";
import type {
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRow,
  AttendanceUpsertInput,
} from "../interfaces/attendanceTypes";
import { ATTENDANCE_STATUSES } from "../interfaces/attendanceTypes";

type AttendanceRow = {
  id: string | number;
  user_id: string | number;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  note: string | null;
  marked_by: string | number | null;
  marked_by_name: string | null;
  updated_at: Date | string;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRecord = (row: AttendanceRow): AttendanceRecord => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  workDate: row.work_date,
  status: row.status,
  checkIn: row.check_in,
  checkOut: row.check_out,
  note: row.note,
  markedBy: row.marked_by == null ? null : Number(row.marked_by),
  markedByName: row.marked_by_name,
  updatedAt: toIso(row.updated_at),
});

/**
 * DATE/TIME отдаём строками через to_char: node-pg парсит DATE в JS Date
 * с полуночью в локальной таймзоне процесса, и toISOString() на сервере
 * с TZ != UTC сдвигает дату на день.
 */
const RECORD_COLUMNS = `
  a.id,
  a.user_id,
  to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
  a.status,
  to_char(a.check_in, 'HH24:MI') AS check_in,
  to_char(a.check_out, 'HH24:MI') AS check_out,
  a.note,
  a.marked_by,
  u.full_name AS marked_by_name,
  a.updated_at
`;

export class PostgresAttendanceRepository implements IAttendanceRepository {
  async listByDate(workDate: string): Promise<AttendanceRecord[]> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AttendanceRow>(
      `
        SELECT ${RECORD_COLUMNS}
        FROM staff_attendance a
        LEFT JOIN users u ON u.id = a.marked_by
        WHERE a.clinic_id = $1 AND a.work_date = $2::date
        ORDER BY a.user_id
      `,
      [clinicId, workDate]
    );
    return result.rows.map(mapRecord);
  }

  async upsert(input: AttendanceUpsertInput): Promise<AttendanceRecord> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<Omit<AttendanceRow, "marked_by_name">>(
      `
        INSERT INTO staff_attendance
          (clinic_id, user_id, work_date, status, check_in, check_out, note, marked_by)
        VALUES ($1, $2, $3::date, $4, $5::time, $6::time, $7, $8)
        ON CONFLICT (clinic_id, user_id, work_date) DO UPDATE SET
          status = EXCLUDED.status,
          check_in = EXCLUDED.check_in,
          check_out = EXCLUDED.check_out,
          note = EXCLUDED.note,
          marked_by = EXCLUDED.marked_by,
          updated_at = now()
        RETURNING
          id,
          user_id,
          to_char(work_date, 'YYYY-MM-DD') AS work_date,
          status,
          to_char(check_in, 'HH24:MI') AS check_in,
          to_char(check_out, 'HH24:MI') AS check_out,
          note,
          marked_by,
          updated_at
      `,
      [
        clinicId,
        input.userId,
        input.workDate,
        input.status,
        input.checkIn,
        input.checkOut,
        input.note,
        input.markedBy,
      ]
    );
    const markedByName = await this.findUserName(input.markedBy);
    return mapRecord({ ...result.rows[0], marked_by_name: markedByName });
  }

  async remove(userId: number, workDate: string): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: string | number }>(
      `
        DELETE FROM staff_attendance
        WHERE clinic_id = $1 AND user_id = $2 AND work_date = $3::date
        RETURNING id
      `,
      [clinicId, userId, workDate]
    );
    return result.rows.length > 0;
  }

  async summary(dateFrom: string, dateTo: string): Promise<AttendanceSummaryRow[]> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{
      user_id: string | number;
      status: AttendanceStatus;
      cnt: string | number;
    }>(
      `
        SELECT user_id, status, COUNT(*)::int AS cnt
        FROM staff_attendance
        WHERE clinic_id = $1 AND work_date >= $2::date AND work_date < $3::date
        GROUP BY user_id, status
      `,
      [clinicId, dateFrom, dateTo]
    );

    const byUser = new Map<number, AttendanceSummaryRow>();
    for (const row of result.rows) {
      const userId = Number(row.user_id);
      let entry = byUser.get(userId);
      if (!entry) {
        entry = {
          userId,
          counts: Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<
            AttendanceStatus,
            number
          >,
        };
        byUser.set(userId, entry);
      }
      entry.counts[row.status] = Number(row.cnt);
    }
    return [...byUser.values()];
  }

  private async findUserName(userId: number): Promise<string | null> {
    const result = await dbPool.query<{ full_name: string | null }>(
      `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return result.rows[0]?.full_name ?? null;
  }
}
