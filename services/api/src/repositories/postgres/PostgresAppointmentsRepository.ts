import type { IAppointmentsRepository } from "../interfaces/IAppointmentsRepository";
import type {
  Appointment,
  AppointmentServiceAssignedSummary,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentInvoiceLine,
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
import { parseNumericFromPg, parseNumericInput, roundMoney2 } from "../../utils/numbers";
import { requireClinicId } from "../../tenancy/clinicContext";

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
  price: string | number;
  quantity: string | number;
  created_by: number | null;
  created_at: string | Date;
};

type AppointmentAssignedServiceWithDetailsRow = {
  appointment_id: number;
  service_id: number;
  service_name: string;
  line_price: string | number;
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

const parseAppointmentServiceQuantity = (value: unknown): number => {
  const n = parseNumericFromPg(value as string | number | null | undefined);
  const q = n == null ? 1 : roundMoney2(n);
  return q > 0 ? q : 1;
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

const attachAssignedServices = async (
  appointments: Appointment[]
): Promise<Appointment[]> => {
  const clinicId = requireClinicId();
  if (appointments.length === 0) {
    return appointments;
  }
  const appointmentIds = appointments.map((row) => row.id);
  const result = await dbPool.query<AppointmentAssignedServiceWithDetailsRow>(
    `
      SELECT
        aps.appointment_id,
        s.id AS service_id,
        s.name AS service_name,
        aps.price AS line_price
      FROM appointment_services aps
      INNER JOIN services s ON s.id = aps.service_id
      WHERE aps.appointment_id = ANY($1::bigint[])
        AND s.clinic_id = $2
      ORDER BY aps.id ASC
    `,
    [appointmentIds, clinicId]
  );

  const grouped = new Map<number, AppointmentServiceAssignedSummary[]>();
  for (const row of result.rows) {
    const key = Number(row.appointment_id);
    const list = grouped.get(key) ?? [];
    list.push({
      serviceId: Number(row.service_id),
      name: String(row.service_name),
      price: roundMoney2(parseNumericFromPg(row.line_price) ?? 0),
    });
    grouped.set(key, list);
  }

  return appointments.map((appointment) => ({
    ...appointment,
    services: grouped.get(appointment.id) ?? [],
  }));
};

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
  /**
   * Первая строка (MIN(id)) — снимок основной услуги записи, всегда соответствует appointments.service_id и price.
   */
  private async syncPrimaryAppointmentServiceRow(appointmentId: number): Promise<void> {
    const clinicId = requireClinicId();
    const updated = await dbPool.query(
      `
        UPDATE appointment_services AS aps
        SET
          service_id = ap.service_id,
          price = COALESCE(ap.price::numeric, 0),
          quantity = 1
        FROM appointments AS ap
        WHERE ap.id = $1
          AND ap.clinic_id = $2
          AND ap.deleted_at IS NULL
          AND aps.appointment_id = ap.id
          AND aps.id = (
            SELECT MIN(s2.id)
            FROM appointment_services s2
            WHERE s2.appointment_id = ap.id
          )
      `,
      [appointmentId, clinicId]
    );
    if (updated.rowCount === 0) {
      await dbPool.query(
        `
          INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
          SELECT a.id, a.service_id, COALESCE(a.price::numeric, 0), 1, NULL
          FROM appointments a
          WHERE a.id = $1
            AND a.clinic_id = $2
            AND a.deleted_at IS NULL
        `,
        [appointmentId, clinicId]
      );
    }
  }

  private mapAssignmentRow(row: AppointmentServiceRow): AppointmentServiceAssignment {
    return {
      id: Number(row.id),
      appointmentId: Number(row.appointment_id),
      serviceId: Number(row.service_id),
      price: roundMoney2(parseNumericFromPg(row.price) ?? 0),
      quantity: parseAppointmentServiceQuantity(row.quantity),
      createdBy: row.created_by == null ? null : Number(row.created_by),
      createdAt: normalizeToLocalDateTime(row.created_at),
    };
  }

  async findAll(filters: AppointmentFilters = {}): Promise<Appointment[]> {
    const clinicId = requireClinicId();
    const whereClauses: string[] = ["deleted_at IS NULL", "clinic_id = $1"];
    const values: Array<number | string> = [clinicId];

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
    return attachAssignedServices(result.rows.map(mapAppointmentRow));
  }

  async findById(id: number): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AppointmentRow>(
      `
        SELECT ${SELECT_LIST}
        FROM appointments
        WHERE id = $1 AND clinic_id = $2
        LIMIT 1
      `,
      [id, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const [withServices] = await attachAssignedServices([mapAppointmentRow(result.rows[0])]);
    return withServices ?? null;
  }

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
      throw new ApiError(409, "Doctor already has an appointment in this time slot");
    }

    const result = await dbPool.query<AppointmentRow>(
      `
        INSERT INTO appointments (
          clinic_id,
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
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING ${SELECT_LIST}
      `,
      [
        clinicId,
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
    const mapped = mapAppointmentRow(result.rows[0]);
    const primaryPrice = mapped.price == null ? 0 : roundMoney2(mapped.price);
    await dbPool.query(
      `
        INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
        VALUES ($1, $2, $3, 1, NULL)
      `,
      [mapped.id, mapped.serviceId, primaryPrice]
    );
    return mapped;
  }

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
    return mapAppointmentRow(result.rows[0]);
  }

  async updatePrice(id: number, price: number): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET
          price = $2,
          updated_at = NOW()
        WHERE id = $1 AND clinic_id = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [id, coerceAppointmentPriceForDb(price), clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    await this.syncPrimaryAppointmentServiceRow(id);
    return mapAppointmentRow(result.rows[0]);
  }

  async cancel(
    id: number,
    cancelReason: string | null,
    cancelledBy: number
  ): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET
          status = 'cancelled',
          cancel_reason = $2,
          cancelled_at = NOW(),
          cancelled_by = $3,
          updated_at = NOW()
        WHERE id = $1 AND clinic_id = $4 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [id, cancelReason, cancelledBy, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }

  async delete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      const appointmentResult = await client.query<{ id: number }>(
        `
          SELECT id
          FROM appointments
          WHERE id = $1 AND clinic_id = $2
          FOR UPDATE
        `,
        [id, clinicId]
      );
      if (appointmentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `
          DELETE FROM appointment_services
          WHERE appointment_id = $1
        `,
        [id]
      );

      const invoiceIdsResult = await client.query<{ id: number }>(
        `
          SELECT id
          FROM invoices
          WHERE appointment_id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        `,
        [id, clinicId]
      );
      const invoiceIds = invoiceIdsResult.rows.map((row) => Number(row.id));

      if (invoiceIds.length > 0) {
        await client.query(
          `
            UPDATE cash_register_entries
            SET payment_id = NULL
            WHERE payment_id IN (
              SELECT p.id FROM payments p WHERE p.invoice_id = ANY($1::bigint[])
            )
          `,
          [invoiceIds]
        );
        await client.query(
          `
            DELETE FROM payments
            WHERE invoice_id = ANY($1::bigint[])
          `,
          [invoiceIds]
        );
        await client.query(
          `
            DELETE FROM invoice_items
            WHERE invoice_id = ANY($1::bigint[])
          `,
          [invoiceIds]
        );
        await client.query(
          `
            DELETE FROM invoices
            WHERE id = ANY($1::bigint[])
          `,
          [invoiceIds]
        );
      }

      const deletedAppointment = await client.query<{ id: number }>(
        `
          DELETE FROM appointments
          WHERE id = $1 AND clinic_id = $2
          RETURNING id
        `,
        [id, clinicId]
      );

      await client.query("COMMIT");
      return deletedAppointment.rows.length > 0;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async softDelete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: number }>(
      `
        UPDATE appointments
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        RETURNING id
      `,
      [id, clinicId]
    );
    return result.rows.length > 0;
  }

  async findConflicting(
    doctorId: number,
    startAt: string,
    endAt: string,
    excludeId?: number
  ): Promise<boolean> {
    const clinicId = requireClinicId();
    const s = assertAppointmentTimestampForDb(startAt, "startAt");
    const e = assertAppointmentTimestampForDb(endAt, "endAt");
    const values: Array<number | string> = [doctorId, e, s, clinicId];
    let query = `
      SELECT 1
      FROM appointments
      WHERE doctor_id = $1
        AND clinic_id = $4
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
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL) AS exists",
      [id, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async doctorExists(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM doctors WHERE id = $1 AND clinic_id = $2) AS exists",
      [id, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async serviceExists(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM services WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL) AS exists",
      [id, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async isServiceActive(serviceId: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM services
          WHERE id = $1
            AND clinic_id = $2
            AND active = true
            AND deleted_at IS NULL
        ) AS exists
      `,
      [serviceId, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async getServiceDuration(serviceId: number): Promise<number | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ duration: number }>(
      `
        SELECT duration
        FROM services
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [serviceId, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const d = parseNumericInput(result.rows[0].duration);
    return d != null && d > 0 ? Math.round(d) : null;
  }

  async getServicePrice(serviceId: number): Promise<number | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ price: string | number }>(
      `
        SELECT price
        FROM services
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [serviceId, clinicId]
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
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM doctor_services
          WHERE service_id = $1
            AND doctor_id = $2
            AND EXISTS (SELECT 1 FROM services s WHERE s.id = $1 AND s.clinic_id = $3 AND s.deleted_at IS NULL)
        ) AS exists
      `,
      [serviceId, doctorId, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async createServiceAssignment(
    appointmentId: number,
    serviceId: number,
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment> {
    const clinicId = requireClinicId();
    const catalog = await this.getServicePrice(serviceId);
    const unitPrice = roundMoney2(catalog ?? 0);
    const result = await dbPool.query<AppointmentServiceRow>(
      `
        INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
        SELECT $1, $2, $3, 1, $4
        WHERE EXISTS (
          SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $5
        )
        RETURNING id, appointment_id, service_id, price, quantity, created_by, created_at
      `,
      [appointmentId, serviceId, unitPrice, createdBy, clinicId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "Appointment not found");
    }
    return this.mapAssignmentRow(row);
  }

  async deleteServiceAssignment(appointmentId: number, serviceId: number): Promise<boolean> {
    const result = await dbPool.query<{ id: number }>(
      `
        DELETE FROM appointment_services
        WHERE id = (
          SELECT id
          FROM appointment_services
          WHERE appointment_id = $1 AND service_id = $2
          ORDER BY id DESC
          LIMIT 1
        )
        RETURNING id
      `,
      [appointmentId, serviceId]
    );
    return result.rows.length > 0;
  }

  async replaceServiceAssignments(
    appointmentId: number,
    serviceIds: number[],
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment[]> {
    const clinicId = requireClinicId();
    const apResult = await dbPool.query<{ service_id: number; price: string | number | null }>(
      `
        SELECT service_id, price
        FROM appointments
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [appointmentId, clinicId]
    );
    if (apResult.rows.length === 0) {
      throw new ApiError(404, "Appointment not found");
    }
    const primaryServiceId = Number(apResult.rows[0].service_id);
    const appointmentPriceSnapshot = parseNumericFromPg(apResult.rows[0].price);
    const primaryUnitPrice =
      appointmentPriceSnapshot != null
        ? roundMoney2(appointmentPriceSnapshot)
        : roundMoney2((await this.getServicePrice(primaryServiceId)) ?? 0);

    const uniqueServiceIds = Array.from(
      new Set(serviceIds.filter((id) => Number.isInteger(id) && id > 0))
    );

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM appointment_services
          WHERE appointment_id = $1
            AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $2)
        `,
        [appointmentId, clinicId]
      );

      const insertedPrimary = await client.query(
        `
          INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
          SELECT $1, $2, $3, 1, $4
          WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $5)
        `,
        [appointmentId, primaryServiceId, primaryUnitPrice, createdBy, clinicId]
      );
      if (insertedPrimary.rowCount === 0) {
        throw new ApiError(404, "Appointment not found");
      }

      for (const serviceId of uniqueServiceIds) {
        if (serviceId === primaryServiceId) continue;
        const catalog = await this.getServicePrice(serviceId);
        if (catalog == null) {
          throw new ApiError(404, `Service ${serviceId} not found`);
        }
        await client.query(
          `
            INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
            SELECT $1, $2, $3, 1, $4
            WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $5)
          `,
          [appointmentId, serviceId, roundMoney2(catalog), createdBy, clinicId]
        );
      }

      const result = await client.query<AppointmentServiceRow>(
        `
          SELECT id, appointment_id, service_id, price, quantity, created_by, created_at
          FROM appointment_services
          WHERE appointment_id = $1
            AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $2)
          ORDER BY id ASC
        `,
        [appointmentId, clinicId]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => this.mapAssignmentRow(row));
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AppointmentServiceRow>(
      `
        SELECT id, appointment_id, service_id, price, quantity, created_by, created_at
        FROM appointment_services
        WHERE appointment_id = $1
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = $1 AND a.clinic_id = $2)
        ORDER BY id ASC
      `,
      [appointmentId, clinicId]
    );
    return result.rows.map((row) => this.mapAssignmentRow(row));
  }

  async listAppointmentInvoiceLines(appointmentId: number): Promise<AppointmentInvoiceLine[]> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{
      service_id: number;
      service_name: string;
      price: string | number;
      quantity: string | number;
    }>(
      `
        SELECT aps.service_id, s.name AS service_name, aps.price, aps.quantity
        FROM appointment_services aps
        INNER JOIN services s ON s.id = aps.service_id AND s.clinic_id = $2
        WHERE aps.appointment_id = $1
          AND EXISTS (
            SELECT 1
            FROM appointments a
            WHERE a.id = $1
              AND a.clinic_id = $2
              AND a.deleted_at IS NULL
          )
        ORDER BY aps.id ASC
      `,
      [appointmentId, clinicId]
    );
    return result.rows.map((row) => ({
      serviceId: Number(row.service_id),
      serviceName: String(row.service_name),
      unitPrice: roundMoney2(parseNumericFromPg(row.price) ?? 0),
      quantity: parseAppointmentServiceQuantity(row.quantity),
    }));
  }

  async updateBillingStatus(
    appointmentId: number,
    billingStatus: AppointmentBillingStatus
  ): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<AppointmentRow>(
      `
        UPDATE appointments
        SET billing_status = $2, updated_at = NOW()
        WHERE id = $1 AND clinic_id = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [appointmentId, billingStatus, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapAppointmentRow(result.rows[0]);
  }
}
