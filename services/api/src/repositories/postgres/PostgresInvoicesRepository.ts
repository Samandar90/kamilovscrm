import type { IInvoicesRepository } from "../interfaces/IInvoicesRepository";
import type {
  Invoice,
  InvoiceCreateInput,
  InvoiceFilters,
  InvoiceItem,
  InvoiceItemInput,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceUpdateInput,
} from "../interfaces/billingTypes";
import { env } from "../../config/env";
import { dbPool } from "../../config/database";
import { parseMoneyColumn, parseRequiredNumber } from "../../utils/numbers";
import { requireClinicId } from "../../tenancy/clinicContext";

type InvoiceRow = {
  id: string | number;
  number: string;
  patient_id: string | number;
  appointment_id: string | number | null;
  subtotal: string | number;
  discount: string | number;
  total: string | number;
  status: InvoiceStatus;
  created_at: Date | string;
  updated_at: Date | string;
  paid_amount?: string | number;
};

type InvoiceItemRow = {
  id: string | number;
  invoice_id: string | number;
  service_id: string | number | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
};

/**
 * Ответ PostgreSQL для `timestamptz` — `Date` или строка; ISO в JSON.
 * Невалидные значения → не бросаем RangeError из `toISOString()` на битой строке/Date.
 */
const toIso = (value: Date | string): string => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return new Date(0).toISOString();
  }
  return d.toISOString();
};

/** Параметры INSERT — только конечные числа (иначе 22P02). */
function bindInvoiceNumeric(field: string, value: unknown): number {
  return parseRequiredNumber(value, field);
}

const num = (v: string | number): number => parseMoneyColumn(v, 0);

const paidSubquery = `
  COALESCE(
    (
      SELECT SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0)))
      FROM payments p
      WHERE p.invoice_id = invoices.id AND p.deleted_at IS NULL
    ),
    0
  )::numeric AS paid_amount
`;

const mapItemRow = (row: InvoiceItemRow): InvoiceItem => ({
  id: Number(row.id),
  invoiceId: Number(row.invoice_id),
  serviceId: row.service_id != null ? Number(row.service_id) : null,
  description: row.description,
  quantity: num(row.quantity),
  unitPrice: num(row.unit_price),
  lineTotal: num(row.line_total),
});

const mapSummaryRow = (row: InvoiceRow): InvoiceSummary => ({
  id: Number(row.id),
  number: String(row.number),
  patientId: Number(row.patient_id),
  appointmentId: row.appointment_id != null ? Number(row.appointment_id) : null,
  status: row.status,
  subtotal: num(row.subtotal),
  discount: num(row.discount),
  total: num(row.total),
  paidAmount: num(row.paid_amount ?? 0),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const syntheticItems = (invoiceId: number, total: number): InvoiceItem[] => [
  {
    id: 0,
    invoiceId,
    serviceId: null,
    description: "Invoice total",
    quantity: 1,
    unitPrice: total,
    lineTotal: total,
  },
];

async function loadItems(invoiceId: number): Promise<InvoiceItem[]> {
  const clinicId = requireClinicId();
  const res = await dbPool.query<InvoiceItemRow>(
    `
      SELECT id, invoice_id, service_id, description, quantity, unit_price, line_total
      FROM invoice_items
      WHERE invoice_id = $1 AND clinic_id = $2
      ORDER BY id ASC
    `,
    [invoiceId, clinicId]
  );
  return res.rows.map(mapItemRow);
}

async function insertItems(
  client: { query: typeof dbPool.query },
  invoiceId: number,
  items: InvoiceItemInput[]
): Promise<void> {
  const clinicId = requireClinicId();
  for (const item of items) {
    await client.query(
      `
        INSERT INTO invoice_items (
          invoice_id,
          clinic_id,
          service_id,
          description,
          quantity,
          unit_price,
          line_total
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      (() => {
        const linePrice = bindInvoiceNumeric("invoice_items.unit_price", item.unitPrice);
        const rowValues: (string | number | null)[] = [
          invoiceId,
          clinicId,
          item.serviceId != null ? bindInvoiceNumeric("invoice_items.service_id", item.serviceId) : null,
          String(item.description ?? ""),
          1,
          linePrice,
          linePrice,
        ];
        if (env.debugInvoiceCreate) {
          // eslint-disable-next-line no-console
          console.log("[PostgresInvoicesRepository.insertItems] VALUES", rowValues);
        }
        return rowValues;
      })()
    );
  }
}

export class PostgresInvoicesRepository implements IInvoicesRepository {
  async findAll(filters: InvoiceFilters = {}): Promise<InvoiceSummary[]> {
    const clinicId = requireClinicId();
    const clauses: string[] = ["deleted_at IS NULL", "clinic_id = $1"];
    const values: Array<number | string> = [clinicId];

    if (filters.patientId !== undefined) {
      values.push(filters.patientId);
      clauses.push(`patient_id = $${values.length}`);
    }
    if (filters.appointmentId !== undefined) {
      values.push(filters.appointmentId);
      clauses.push(`appointment_id = $${values.length}`);
    }
    if (filters.status !== undefined) {
      values.push(filters.status);
      clauses.push(`status = $${values.length}`);
    }

    const result = await dbPool.query<InvoiceRow>(
      `
        SELECT
          id,
          number,
          patient_id,
          appointment_id,
          subtotal,
          discount,
          total,
          status,
          created_at,
          updated_at,
          ${paidSubquery}
        FROM invoices
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC
      `,
      values
    );
    return result.rows.map(mapSummaryRow);
  }

  async findByAppointmentId(appointmentId: number): Promise<InvoiceSummary | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<InvoiceRow>(
      `
        SELECT
          id,
          number,
          patient_id,
          appointment_id,
          subtotal,
          discount,
          total,
          status,
          created_at,
          updated_at,
          ${paidSubquery}
        FROM invoices
        WHERE appointment_id = $1 AND clinic_id = $2
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [appointmentId, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapSummaryRow(result.rows[0]);
  }

  async findById(id: number): Promise<Invoice | null> {
    const clinicId = requireClinicId();
    const inv = await dbPool.query<InvoiceRow>(
      `
        SELECT
          id,
          number,
          patient_id,
          appointment_id,
          subtotal,
          discount,
          total,
          status,
          created_at,
          updated_at,
          ${paidSubquery}
        FROM invoices
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [id, clinicId]
    );
    if (inv.rows.length === 0) {
      return null;
    }

    const row = inv.rows[0];
    const summary = mapSummaryRow(row);
    let items = await loadItems(Number(row.id));
    if (items.length === 0) {
      items = syntheticItems(Number(row.id), num(row.total));
    }

    return {
      ...summary,
      items,
    };
  }

  async create(input: InvoiceCreateInput, items: InvoiceItemInput[]): Promise<InvoiceSummary> {
    const clinicId = requireClinicId();
    if (items.length === 0) {
      throw new Error("PostgresInvoicesRepository.create: items must not be empty");
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      const insertHeaderValues: (string | number | null)[] = [
        clinicId,
        String(input.number ?? "").trim() || `INV-${Date.now()}`,
        bindInvoiceNumeric("patient_id", input.patientId),
        input.appointmentId == null ? null : bindInvoiceNumeric("appointment_id", input.appointmentId),
        String(input.status ?? "draft"),
        bindInvoiceNumeric("subtotal", input.subtotal),
        bindInvoiceNumeric("discount", input.discount),
        bindInvoiceNumeric("total", input.total),
        bindInvoiceNumeric("paid_amount", input.paidAmount ?? 0),
      ];
      if (env.debugInvoiceCreate) {
        // eslint-disable-next-line no-console
        console.log("[PostgresInvoicesRepository.create] INSERT invoices VALUES", insertHeaderValues);
      }

      const result = await client.query<Omit<InvoiceRow, "paid_amount">>(
        `
          INSERT INTO invoices (
            clinic_id,
            number,
            patient_id,
            appointment_id,
            status,
            subtotal,
            discount,
            total,
            paid_amount
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING
            id,
            number,
            patient_id,
            appointment_id,
            subtotal,
            discount,
            total,
            status,
            created_at,
            updated_at
        `,
        insertHeaderValues
      );

      const row = result.rows[0];
      const invoiceId = Number(row.id);
      await insertItems(client, invoiceId, items);

      await client.query("COMMIT");

      return mapSummaryRow({ ...row, paid_amount: 0 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async update(
    id: number,
    input: InvoiceUpdateInput,
    replaceLineItems?: InvoiceItemInput[]
  ): Promise<InvoiceSummary | null> {
    const clinicId = requireClinicId();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string | number }>(
        `SELECT id FROM invoices WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [id, clinicId]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const setClauses: string[] = ["updated_at = NOW()"];
      const values: Array<string | number | null> = [];

      if (input.number !== undefined) {
        values.push(input.number);
        setClauses.push(`number = $${values.length}`);
      }
      if (input.patientId !== undefined) {
        values.push(input.patientId);
        setClauses.push(`patient_id = $${values.length}`);
      }
      if (input.appointmentId !== undefined) {
        values.push(input.appointmentId);
        setClauses.push(`appointment_id = $${values.length}`);
      }
      if (input.status !== undefined) {
        values.push(input.status);
        setClauses.push(`status = $${values.length}`);
      }
      if (input.subtotal !== undefined) {
        values.push(input.subtotal);
        setClauses.push(`subtotal = $${values.length}`);
      }
      if (input.discount !== undefined) {
        values.push(input.discount);
        setClauses.push(`discount = $${values.length}`);
      }
      if (input.total !== undefined) {
        values.push(input.total);
        setClauses.push(`total = $${values.length}`);
      }

      const hasHeaderChanges = setClauses.length > 1 || replaceLineItems !== undefined;

      if (replaceLineItems !== undefined) {
        await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1 AND clinic_id = $2`, [id, clinicId]);
        if (replaceLineItems.length > 0) {
          await insertItems(client, id, replaceLineItems);
        }
      }

      if (setClauses.length > 1) {
        values.push(id);
        values.push(clinicId);
        const upd = await client.query<{ id: number }>(
          `
            UPDATE invoices
            SET ${setClauses.join(", ")}
            WHERE id = $${values.length - 1} AND clinic_id = $${values.length} AND deleted_at IS NULL
            RETURNING id
          `,
          values
        );
        if (upd.rows.length === 0) {
          await client.query("ROLLBACK");
          return null;
        }
      } else if (replaceLineItems !== undefined) {
        values.push(id);
        values.push(clinicId);
        await client.query(
          `UPDATE invoices SET updated_at = NOW() WHERE id = $${values.length - 1} AND clinic_id = $${values.length} AND deleted_at IS NULL`,
          values
        );
      } else {
        await client.query("ROLLBACK");
        const full = await this.findById(id);
        if (!full) return null;
        const { items: _i, ...summary } = full;
        return summary;
      }

      await client.query("COMMIT");

      const refreshed = await dbPool.query<InvoiceRow>(
        `
          SELECT
            id,
            number,
            patient_id,
            appointment_id,
            subtotal,
            discount,
            total,
            status,
            created_at,
            updated_at,
            ${paidSubquery}
          FROM invoices
          WHERE id = $1 AND clinic_id = $2
        `,
        [id, clinicId]
      );
      if (refreshed.rows.length === 0) return null;
      return mapSummaryRow(refreshed.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async delete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: number }>(
      `
        UPDATE invoices
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        RETURNING id
      `,
      [id, clinicId]
    );
    return result.rows.length > 0;
  }

  async replaceItems(invoiceId: number, items: InvoiceItemInput[]): Promise<void> {
    const clinicId = requireClinicId();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const ex = await client.query<{ id: number }>(
        `SELECT id FROM invoices WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [invoiceId, clinicId]
      );
      if (ex.rows.length === 0) {
        await client.query("ROLLBACK");
        return;
      }
      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1 AND clinic_id = $2`, [invoiceId, clinicId]);
      if (items.length > 0) {
        await insertItems(client, invoiceId, items);
      }
      await client.query(
        `UPDATE invoices SET updated_at = NOW() WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
        [invoiceId, clinicId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async patientExists(pid: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1 FROM patients WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        ) AS exists
      `,
      [pid, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async appointmentExists(aid: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1 FROM appointments WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        ) AS exists
      `,
      [aid, clinicId]
    );
    return result.rows[0]?.exists === true;
  }

  async getAppointmentPatientId(appointmentId: number): Promise<number | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ patient_id: string | number }>(
      `
        SELECT patient_id
        FROM appointments
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [appointmentId, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return Number(result.rows[0].patient_id);
  }
}
