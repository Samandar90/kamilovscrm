import type { IAppointmentsRepository } from "../interfaces/IAppointmentsRepository";
import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentServiceAssignment,
  AppointmentStatus,
  AppointmentUpdateInput,
} from "../interfaces/coreTypes";
import { ApiError } from "../../middleware/errorHandler";
import { dbPool } from "../../config/database";
import {
  assertAppointmentTimestampForDb,
  assertOptionalAppointmentTimestampForDb,
} from "../../utils/appointmentTimestamps";
import { normalizeToLocalDateTime } from "../../utils/localDateTime";
import { parseNumericFromPg, parseNumericInput } from "../../utils/numbers";

type AppointmentRow = {
  id: number;
  patient_id: number;
  doctor_id: number;
  service_id: number;
  price: string | number | null;
  start_at: string | Date;
  end_at: string | Date;
  status: AppointmentStatus;
  billing_status: AppointmentBillingStatus;
  cancel_reason: string | null;
  cancelled_at: string | Date | null;
  cancelled_by: number | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type AppointmentServiceRow = {
  id: number;
  appointment_id: number;
  service_id: number;
  created_by: number | null;
  created_at: string | Date;
};

/** Любой ввод цены (JSON-строка с пробелами) → число для NUMERIC в PostgreSQL. */
const coerceAppointmentPriceForDb = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const n = parseNumericInput(value);
  if (n === null) {
    throw new ApiError(400, "Некорректная цена записи");
  }
  if (n < 0) {
    throw new ApiError(400, "Цена не может быть отрицательной");
  }
  return Math.round(n);
};

const mapAppointmentRow = (row: AppointmentRow): Appointment => ({
  id: Number(row.id),
  patientId: Number(row.patient_id),
  doctorId: Number(row.doctor_id),
  serviceId: Number(row.service_id),
  price: row.price == null ? null : parseNumericFromPg(row.price),
  startAt: normalizeToLocalDateTime(row.start_at),
  endAt: normalizeToLocalDateTime(row.end_at),
  status: row.status,
  billingStatus: row.billing_status,
  cancelReason: row.cancel_reason,
  cancelledAt: row.cancelled_at ? normalizeToLocalDateTime(row.cancelled_at) : null,
  cancelledBy: row.cancelled_by != null ? Number(row.cancelled_by) : null,
  diagnosis: row.diagnosis,
  treatment: row.treatment,
  notes: row.notes,
  createdAt: normalizeToLocalDateTime(row.created_at),
  updatedAt: normalizeToLocalDateTime(row.updated_at),
});

const SELECT_LIST = `
  id,
  patient_id,
  doctor_id,
  service_id,
  price,
  start_at,
  end_at,
  status,
  billing_status,
  cancel_reason,
  cancelled_at,
  cancelled_by,
  diagnosis,
  treatment,
  notes,
  created_at,
  updated_at
`;

export class PostgresAppointmentsRepository implements IAppointmentsRepository {
  async findAll(filters: AppointmentFilters = {}): Promise<Appointment[]> {
    const whereClauses: string[] = ["deleted_at IS NULL"];
    const values: Array<number | string> = [];

    if (filters.patientId !== undefined) {
      values.push(filters.patientId);
      whereClauses.push(`patient_id = $${values.length}`);
    }
    if (filters.doctorId !== undefined) {
      values.push(filters.doctorId);
      whereClauses.push(`doctor_id = $${values.length}`);
    }
    if (filters.serviceId !== undefined) {
      values.push(filters.serviceId);
      whereClauses.push(`service_id = $${values.length}`);
    }
    if (filters.status !== undefined) {
      values.push(filters.status);
      whereClauses.push(`status = $${values.length}`);
    }
    if (filters.billingStatus !== undefined) {
      values.push(filters.billingStatus);
      whereClauses.push(`billing_status = $${values.length}`);
    }
    if (filters.startFrom != null) {
      const v = assertOptionalAppointmentTimestampForDb(
        filters.startFrom,
        "startFrom"
      );
      if (v != null) {
        values.push(v);
        whereClauses.push(`start_at >= $${values.length}::timestamptz`);
      }
    }
    const upperBound = filters.startTo ?? filters.endTo;
    if (upperBound != null) {
      const v = assertOptionalAppointmentTimestampForDb(upperBound, "startTo");
      if (v != null) {
        values.push(v);
        whereClauses.push(`start_at <= $${values.length}::timestamptz`);
      }
    }

    const query = `
      SELECT ${SELECT_LIST}
      FROM appointments
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY start_at DESC
    `;
    const result = await dbPool.query<AppointmentRow>(query, values);
    return result.rows.map(mapAppointmentRow);
  }

  async findById(id: number): Promise<Appointment | null> {
    const result = await dbPool.query<AppointmentRow>(
      `
        SELECT ${SELECT_LIST}
        FROM appointments
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }

  async create(data: AppointmentCreateInput): Promise<Appointment> {
    const startAt = assertAppointmentTimestampForDb(data.startAt, "startAt");
    const endAt = assertAppointmentTimestampForDb(data.endAt, "endAt");

    const hasConflict = await this.findConflicting(
      data.doctorId,
      startAt,
      endAt
    );
    if (hasConflict) {
      throw new ApiError(409, "Doctor already has an appointment in this time slot");
    }

    const result = await dbPool.query<AppointmentRow>(
      `
        INSERT INTO appointments (
          patient_id,
          doctor_id,
          service_id,
          price,
          start_at,
          end_at,
          status,
          billing_status,
          cancel_reason,
          cancelled_at,
          cancelled_by,
          diagnosis,
          treatment,
          notes
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING ${SELECT_LIST}
      `,
      [
        data.patientId,
        data.doctorId,
        data.serviceId,
        data.price == null ? null : coerceAppointmentPriceForDb(data.price),
        startAt,
        endAt,
        data.status,
        data.billingStatus ?? "draft",
        data.cancelReason ?? null,
        null,
        null,
        data.diagnosis ?? null,
        data.treatment ?? null,
        data.notes ?? null,
      ]
    );
    return mapAppointmentRow(result.rows[0]);
  }

  async update(id: number, data: AppointmentUpdateInput): Promise<Appointment | null> {
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
      throw new ApiError(409, "Doctor already has an appointment in this time slot");
    }

    const setClauses: string[] = [];
    const values: Array<number | string | null> = [];

    if (data.patientId !== undefined) {
      values.push(data.patientId);
      setClauses.push(`patient_id = $${values.length}`);
    }
    if (data.doctorId !== undefined) {
      values.push(data.doctorId);
      setClauses.push(`doctor_id = $${values.length}`);
    }
    if (data.serviceId !== undefined) {
      values.push(data.serviceId);
      setClauses.push(`service_id = $${values.length}`);
    }
    if (data.price !== undefined) {
      values.push(
        data.price === null ? null : coerceAppointmentPriceForDb(data.price)
      );
      setClauses.push(`price = $${values.length}`);
    }
    if (data.startAt !== undefined) {
      values.push(assertAppointmentTimestampForDb(data.startAt, "startAt"));
      setClauses.push(`start_at = $${values.length}::timestamptz`);
    }
    if (data.endAt !== undefined) {
      values.push(assertAppointmentTimestampForDb(data.endAt, "endAt"));
      setClauses.push(`end_at = $${values.length}::timestamptz`);
    }
    if (data.status !== undefined) {
      values.push(data.status);
      setClauses.push(`status = $${values.length}`);
    }
    if (data.billingStatus !== undefined) {
      values.push(data.billingStatus);
      setClauses.push(`billing_status = $${values.length}`);
    }
    if (data.cancelReason !== undefined) {
      values.push(data.cancelReason);
      setClauses.push(`cancel_reason = $${values.length}`);
    }
    if (data.diagnosis !== undefined) {
      values.push(data.diagnosis);
      setClauses.push(`diagnosis = $${values.length}`);
    }
    if (data.treatment !== undefined) {
      values.push(data.treatment);
      setClauses.push(`treatment = $${values.length}`);
    }
    if (data.notes !== undefined) {
      values.push(data.notes);
      setClauses.push(`notes = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length} AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      values
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }

  async updatePrice(id: number, price: number): Promise<Appointment | null> {
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET
          price = $2,
          updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [id, coerceAppointmentPriceForDb(price)]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }

  async cancel(
    id: number,
    cancelReason: string | null,
    cancelledBy: number
  ): Promise<Appointment | null> {
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET
          status = 'cancelled',
          cancel_reason = $2,
          cancelled_at = NOW(),
          cancelled_by = $3,
          updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [id, cancelReason, cancelledBy]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }

  async delete(id: number): Promise<boolean> {
    return this.softDelete(id);
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await dbPool.query<{ id: number }>(
      `
        UPDATE appointments
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `,
      [id]
    );
    return result.rows.length > 0;
  }

  async findConflicting(
    doctorId: number,
    startAt: string,
    endAt: string,
    excludeId?: number
  ): Promise<boolean> {
    const s = assertAppointmentTimestampForDb(startAt, "startAt");
    const e = assertAppointmentTimestampForDb(endAt, "endAt");
    const values: Array<number | string> = [doctorId, e, s];
    let query = `
      SELECT 1
      FROM appointments
      WHERE doctor_id = $1
        AND deleted_at IS NULL
        AND start_at < $2::timestamptz
        AND end_at > $3::timestamptz
        AND status IN ('scheduled', 'confirmed', 'arrived', 'in_consultation')
    `;
    if (excludeId !== undefined) {
      values.push(excludeId);
      query += ` AND id <> $${values.length}`;
    }
    query += " LIMIT 1";

    const result = await dbPool.query<{ "?column?": number }>(query, values);
    return result.rows.length > 0;
  }

  async patientExists(id: number): Promise<boolean> {
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1 AND deleted_at IS NULL) AS exists",
      [id]
    );
    return result.rows[0]?.exists === true;
  }

  async doctorExists(id: number): Promise<boolean> {
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM doctors WHERE id = $1) AS exists",
      [id]
    );
    return result.rows[0]?.exists === true;
  }

  async serviceExists(id: number): Promise<boolean> {
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM services WHERE id = $1 AND deleted_at IS NULL) AS exists",
      [id]
    );
    return result.rows[0]?.exists === true;
  }

  async isServiceActive(serviceId: number): Promise<boolean> {
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM services
          WHERE id = $1
            AND active = true
            AND deleted_at IS NULL
        ) AS exists
      `,
      [serviceId]
    );
    return result.rows[0]?.exists === true;
  }

  async getServiceDuration(serviceId: number): Promise<number | null> {
    const result = await dbPool.query<{ duration: number }>(
      `
        SELECT duration
        FROM services
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [serviceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const d = parseNumericInput(result.rows[0].duration);
    return d != null && d > 0 ? Math.round(d) : null;
  }

  async getServicePrice(serviceId: number): Promise<number | null> {
    const result = await dbPool.query<{ price: string | number }>(
      `
        SELECT price
        FROM services
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [serviceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return parseNumericFromPg(result.rows[0].price);
  }

  async isServiceAssignedToDoctor(
    serviceId: number,
    doctorId: number
  ): Promise<boolean> {
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM doctor_services
          WHERE service_id = $1
            AND doctor_id = $2
        ) AS exists
      `,
      [serviceId, doctorId]
    );
    return result.rows[0]?.exists === true;
  }

  async createServiceAssignment(
    appointmentId: number,
    serviceId: number,
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment> {
    const result = await dbPool.query<AppointmentServiceRow>(
      `
        INSERT INTO appointment_services (appointment_id, service_id, created_by)
        VALUES ($1, $2, $3)
        RETURNING id, appointment_id, service_id, created_by, created_at
      `,
      [appointmentId, serviceId, createdBy]
    );
    const row = result.rows[0];
    return {
      id: Number(row.id),
      appointmentId: Number(row.appointment_id),
      serviceId: Number(row.service_id),
      createdBy: row.created_by == null ? null : Number(row.created_by),
      createdAt: normalizeToLocalDateTime(row.created_at),
    };
  }

  async listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]> {
    const result = await dbPool.query<AppointmentServiceRow>(
      `
        SELECT id, appointment_id, service_id, created_by, created_at
        FROM appointment_services
        WHERE appointment_id = $1
        ORDER BY id ASC
      `,
      [appointmentId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      appointmentId: Number(row.appointment_id),
      serviceId: Number(row.service_id),
      createdBy: row.created_by == null ? null : Number(row.created_by),
      createdAt: normalizeToLocalDateTime(row.created_at),
    }));
  }

  async updateBillingStatus(
    appointmentId: number,
    billingStatus: AppointmentBillingStatus
  ): Promise<Appointment | null> {
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET billing_status = $2, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [appointmentId, billingStatus]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }
}
