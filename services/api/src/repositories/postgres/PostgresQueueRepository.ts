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
