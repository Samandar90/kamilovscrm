import type {
  AppointmentWriteOptions,
  IAppointmentsRepository,
} from "../interfaces/IAppointmentsRepository";
import type { QueueDirective } from "../interfaces/queueTypes";
import type {
  Appointment,
  AppointmentServiceAssignedSummary,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentInvoiceLine,
  AppointmentServiceAssignment,
  AppointmentServiceLineReplacement,
  AppointmentStatus,
  AppointmentUpdateInput,
  PatientLastVisit,
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
import { formatQueueCode } from "../../services/queue/queueRules";
import type { QueryClient } from "./queryPool";
import { allocateQueueNumber } from "./queueAllocation";

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
  cancelled_by_role: string | null;
  created_by_doctor_id: number | null;
  created_by_user_id: number | null;
  diagnosis: string | null;
  treatment: string | null;
  recommended_return_date: string | null;
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

/**
 * Аудит-времена (created/updated/cancelled) — реальные моменты (now() в БД, UTC):
 * отдаём честный ISO с зоной, фронт конвертирует в зону браузера.
 * start_at/end_at — «настенное» время записи, для них остаётся normalizeToLocalDateTime.
 */
const toIsoUtc = (value: string | Date): string => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unparseable timestamp value: ${String(value)}`);
  }
  return d.toISOString();
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
  cancelledAt: row.cancelled_at ? toIsoUtc(row.cancelled_at) : null,
  cancelledBy: row.cancelled_by != null ? Number(row.cancelled_by) : null,
  cancelledByRole: row.cancelled_by_role ?? null,
  createdByDoctorId:
    row.created_by_doctor_id != null ? Number(row.created_by_doctor_id) : null,
  createdByUserId:
    row.created_by_user_id != null ? Number(row.created_by_user_id) : null,
  diagnosis: row.diagnosis,
  treatment: row.treatment,
  recommendedReturnDate: row.recommended_return_date ?? null,
  notes: row.notes,
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

const attachAssignedServices = async (
  appointments: Appointment[]
): Promise<Appointment[]> => {
  const clinicId = requireClinicId();
  if (appointments.length === 0) {
    return appointments;
  }
  const appointmentIds = appointments.map((row) => row.id);
  try {
    const result = await dbPool.query<AppointmentAssignedServiceWithDetailsRow>(
      `
      SELECT
        aps.appointment_id,
        s.id AS service_id,
        s.name AS service_name,
        COALESCE(aps.price, s.price::numeric, 0::numeric) AS line_price
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
      const rawPrice = parseNumericFromPg(row.line_price);
      const unit = (rawPrice ?? 0) || 0;
      list.push({
        serviceId: Number(row.service_id),
        name: String(row.service_name),
        price: roundMoney2(unit),
      });
      grouped.set(key, list);
    }

    return appointments.map((appointment) => ({
      ...appointment,
      services: grouped.get(appointment.id) ?? [],
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[attachAssignedServices] failed; returning appointments without assigned services", err);
    return appointments.map((appointment) => ({
      ...appointment,
      services: [],
    }));
  }
};

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
  cancelled_by_role,
  created_by_doctor_id,
  created_by_user_id,
  diagnosis,
  treatment,
  to_char(recommended_return_date, 'YYYY-MM-DD') AS recommended_return_date,
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

export class PostgresAppointmentsRepository implements IAppointmentsRepository {
  /**
   * Первая строка (MIN(id)) — снимок основной услуги записи, всегда соответствует appointments.service_id и price.
   */
  private async syncPrimaryAppointmentServiceRow(appointmentId: number): Promise<void> {
    const clinicId = requireClinicId();
    try {
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
      if ((updated.rowCount ?? 0) === 0) {
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[syncPrimaryAppointmentServiceRow] skipped", { appointmentId }, err);
    }
  }

  private mapAssignmentRow(row: AppointmentServiceRow): AppointmentServiceAssignment {
    const unit = (parseNumericFromPg(row.price) ?? 0) || 0;
    const qty = parseAppointmentServiceQuantity(row.quantity ?? 1);
    return {
      id: Number(row.id),
      appointmentId: Number(row.appointment_id),
      serviceId: Number(row.service_id),
      price: roundMoney2(unit),
      quantity: qty,
      createdBy: row.created_by == null ? null : Number(row.created_by),
      createdAt: toIsoUtc(row.created_at),
    };
  }

  /**
   * Строки appointment_services при создании записи: всегда хотя бы одна (основная услуга).
   * Цена из payload или каталога services.price.
   */
  private async resolveInitialAppointmentServiceLines(
    data: AppointmentCreateInput,
    mapped: Appointment
  ): Promise<Array<{ serviceId: number; price: number; quantity: number }>> {
    const parseQty = (q: unknown, fallback: number): number => {
      if (q === undefined || q === null) return fallback;
      const n = parseNumericInput(q);
      if (n === null || n <= 0) {
        throw new ApiError(400, "quantity must be greater than 0");
      }
      return roundMoney2(n);
    };

    const primaryQty = parseQty(data.quantity, 1);

    const resolveUnitPrice = async (
      serviceId: number,
      explicit: number | null | undefined
    ): Promise<number> => {
      if (explicit !== undefined && explicit !== null) {
        const n = parseNumericInput(explicit);
        if (n === null || n < 0) {
          throw new ApiError(400, "Некорректная цена услуги");
        }
        return roundMoney2(n);
      }
      const cat = await this.getServicePrice(serviceId);
      if (cat == null || cat < 0) {
        throw new ApiError(400, "Service price is invalid");
      }
      return roundMoney2(cat);
    };

    if (data.serviceLines?.length) {
      const rows: Array<{ serviceId: number; price: number; quantity: number }> = [];
      const seen = new Set<number>();

      for (const line of data.serviceLines) {
        const sid = line.serviceId;
        if (seen.has(sid)) continue;
        seen.add(sid);
        const defaultQty = sid === data.serviceId ? primaryQty : 1;
        const qty = parseQty(line.quantity, defaultQty);
        let explicit: number | null | undefined;
        if (line.price !== undefined && line.price !== null) {
          explicit = line.price;
        } else if (sid === data.serviceId) {
          explicit = data.price ?? mapped.price ?? undefined;
        } else {
          explicit = undefined;
        }
        const pr = await resolveUnitPrice(sid, explicit);
        rows.push({ serviceId: sid, price: pr, quantity: qty });
      }

      if (!seen.has(data.serviceId)) {
        const pr = await resolveUnitPrice(data.serviceId, data.price ?? mapped.price ?? undefined);
        rows.unshift({
          serviceId: data.serviceId,
          price: pr,
          quantity: primaryQty,
        });
      }

      const primarySid = data.serviceId;
      return [
        ...rows.filter((r) => r.serviceId === primarySid),
        ...rows.filter((r) => r.serviceId !== primarySid),
      ];
    }

    const pr = await resolveUnitPrice(data.serviceId, data.price ?? mapped.price ?? undefined);
    return [{ serviceId: data.serviceId, price: pr, quantity: primaryQty }];
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

    let limitClause = "";
    if (filters.limit !== undefined) {
      values.push(filters.limit);
      limitClause = `LIMIT $${values.length}`;
    }

    const query = `
      SELECT ${SELECT_LIST}
      FROM appointments
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY start_at DESC
      ${limitClause}
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

  async findLastVisits(
    filters: Pick<AppointmentFilters, "doctorId"> = {}
  ): Promise<PatientLastVisit[]> {
    const clinicId = requireClinicId();
    const whereClauses: string[] = ["deleted_at IS NULL", "clinic_id = $1"];
    const values: number[] = [clinicId];

    if (filters.doctorId !== undefined) {
      values.push(filters.doctorId);
      whereClauses.push(`doctor_id = $${values.length}`);
    }

    const result = await dbPool.query<{ patient_id: number | string; last_start_at: string | Date }>(
      `
        SELECT patient_id, MAX(start_at) AS last_start_at
        FROM appointments
        WHERE ${whereClauses.join(" AND ")}
        GROUP BY patient_id
        ORDER BY patient_id
      `,
      values
    );
    return result.rows.map((row) => ({
      patientId: Number(row.patient_id),
      lastVisitAt: normalizeToLocalDateTime(row.last_start_at),
    }));
  }

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

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query<AppointmentRow>(
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
          notes,
          created_by_doctor_id,
          created_by_user_id,
          recommended_return_date
        )
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::date)
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
          data.createdByDoctorId ?? null,
          data.createdByUserId ?? null,
          data.recommendedReturnDate ?? null,
        ]
      );

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

      for (const line of lines) {
        await client.query(
          `
          INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
          VALUES ($1, $2, $3, $4, NULL)
        `,
          [mapped.id, line.serviceId, line.price, line.quantity]
        );
      }

      await client.query("COMMIT");
      return mapped;
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
    if (data.recommendedReturnDate !== undefined) {
      values.push(data.recommendedReturnDate);
      setClauses.push(`recommended_return_date = $${values.length}::date`);
    }
    if (data.notes !== undefined) {
      values.push(data.notes);
      setClauses.push(`notes = $${values.length}`);
    }

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
    return withServices(result.rows[0]);
  }

  async cancel(
    id: number,
    cancelReason: string | null,
    cancelledByUserId: number,
    cancelledByRole?: string | null
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
          cancelled_by_role = $5,
          updated_at = NOW()
        WHERE id = $1 AND clinic_id = $4 AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      [id, cancelReason, cancelledByUserId, clinicId, cancelledByRole ?? null]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return withServices(result.rows[0]);
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

  async isPatientEligibleForDoctorBooking(
    patientId: number,
    doctorId: number
  ): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ ok: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM patients p
          WHERE p.id = $1
            AND p.clinic_id = $2
            AND p.deleted_at IS NULL
            AND (
              p.created_by_doctor_id = $3
              OR EXISTS (
                SELECT 1
                FROM appointments a
                WHERE a.patient_id = p.id
                  AND a.doctor_id = $3
                  AND a.clinic_id = $2
                  AND a.deleted_at IS NULL
              )
            )
        ) AS ok
      `,
      [patientId, clinicId, doctorId]
    );
    return result.rows[0]?.ok === true;
  }

  async replaceServiceLines(
    appointmentId: number,
    lines: AppointmentServiceLineReplacement[],
    options: { endAt?: string; updatedBy: number | null; expectedUpdatedAt: string }
  ): Promise<Appointment | null> {
    const clinicId = requireClinicId();
    const [primary] = lines;
    if (!primary) {
      throw new ApiError(400, "At least one service is required");
    }
    const endAt =
      options.endAt === undefined ? null : assertAppointmentTimestampForDb(options.endAt, "endAt");

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      // Row lock serializes concurrent edits and invoice creation for this appointment; the
      // version check rejects decisions made on data that changed in the meantime.
      const locked = await client.query<{ fresh: boolean }>(
        `
          SELECT date_trunc('milliseconds', updated_at) = $3::timestamptz AS fresh
          FROM appointments
          WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
          FOR UPDATE
        `,
        [appointmentId, clinicId, options.expectedUpdatedAt]
      );
      if (locked.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      if (locked.rows[0].fresh !== true) {
        throw new ApiError(409, "Запись изменилась — обновите страницу и повторите");
      }

      const invoiced = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM invoices
            WHERE appointment_id = $1
              AND clinic_id = $2
              AND deleted_at IS NULL
              AND status IN ('draft', 'issued', 'partially_paid', 'paid')
          ) AS exists
        `,
        [appointmentId, clinicId]
      );
      if (invoiced.rows[0]?.exists === true) {
        throw new ApiError(409, "По записи уже выставлен счёт — услуги больше менять нельзя");
      }

      // Keep the original author of lines that stay on the appointment.
      const previous = await client.query<{ service_id: number; created_by: number | null }>(
        `SELECT service_id, created_by FROM appointment_services WHERE appointment_id = $1`,
        [appointmentId]
      );
      const previousAuthors = new Map(
        previous.rows.map((row) => [
          Number(row.service_id),
          row.created_by == null ? null : Number(row.created_by),
        ])
      );

      await client.query(`DELETE FROM appointment_services WHERE appointment_id = $1`, [
        appointmentId,
      ]);
      for (const line of lines) {
        await client.query(
          `
            INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            appointmentId,
            line.serviceId,
            roundMoney2(line.price),
            roundMoney2(line.quantity),
            previousAuthors.has(line.serviceId)
              ? previousAuthors.get(line.serviceId) ?? null
              : options.updatedBy,
          ]
        );
      }

      await client.query(
        `
          UPDATE appointments
          SET
            service_id = $3,
            price = $4,
            end_at = COALESCE($5::timestamptz, end_at),
            updated_at = NOW()
          WHERE id = $1 AND clinic_id = $2
        `,
        [appointmentId, clinicId, primary.serviceId, coerceAppointmentPriceForDb(primary.price), endAt]
      );
      await client.query("COMMIT");
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
    return this.findById(appointmentId);
  }

  async listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]> {
    const clinicId = requireClinicId();
    try {
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[listServiceAssignments] failed", { appointmentId }, err);
      return [];
    }
  }

  async listAppointmentInvoiceLines(appointmentId: number): Promise<AppointmentInvoiceLine[]> {
    const clinicId = requireClinicId();
    try {
      const result = await dbPool.query<{
        service_id: number;
        service_name: string;
        line_price: string | number | null;
        line_qty: string | number | null;
      }>(
        `
        SELECT
          aps.service_id,
          s.name AS service_name,
          COALESCE(aps.price, s.price::numeric, 0::numeric) AS line_price,
          COALESCE(aps.quantity, 1::numeric) AS line_qty
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
      return result.rows.map((row) => {
        const unitRaw = parseNumericFromPg(row.line_price);
        const unitPrice = roundMoney2((unitRaw ?? 0) || 0);
        const quantity = parseAppointmentServiceQuantity(row.line_qty ?? 1);
        return {
          serviceId: Number(row.service_id),
          serviceName: String(row.service_name),
          unitPrice,
          quantity,
        };
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[listAppointmentInvoiceLines] failed", { appointmentId }, err);
      return [];
    }
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
    return withServices(result.rows[0]);
  }
}
