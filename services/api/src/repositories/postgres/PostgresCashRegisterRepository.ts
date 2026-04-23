import type { ICashRegisterRepository } from "../interfaces/ICashRegisterRepository";
import type {
  CashRegisterEntry,
  CashRegisterEntryListItem,
  CashRegisterShift,
  CashEntryMethod,
  CashEntryType,
  CloseShiftInput,
  CreateCashRegisterEntryInput,
  FindEntriesFilters,
  OpenShiftInput,
} from "../interfaces/billingTypes";
import { normalizePaymentMethod } from "../interfaces/billingTypes";
import { dbPool } from "../../config/database";
import { env } from "../../config/env";
import { parseMoneyColumn } from "../../utils/numbers";

type ShiftRow = {
  id: string | number;
  opened_by: string | number | null;
  closed_by: string | number | null;
  opened_at: Date | string;
  closed_at: Date | string | null;
  opening_balance: string | number;
  closing_balance: string | number | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type EntryRow = {
  id: string | number;
  shift_id: string | number;
  payment_id: string | number | null;
  type: string;
  amount: string | number;
  method: string;
  note: string | null;
  created_at: Date | string;
};

type EntryRowWithContext = EntryRow & {
  invoice_id: string | number | null;
  patient_id: string | number | null;
  payment_deleted_at: Date | string | null;
  payment_amount: string | number | null;
  payment_refunded_amount: string | number | null;
};

const toIso = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const num = (v: string | number): number => parseMoneyColumn(v, 0);

const mapShift = (row: ShiftRow): CashRegisterShift => ({
  id: Number(row.id),
  openedBy: row.opened_by != null ? Number(row.opened_by) : null,
  closedBy: row.closed_by != null ? Number(row.closed_by) : null,
  openedAt: toIso(row.opened_at),
  closedAt: row.closed_at ? toIso(row.closed_at) : null,
  openingBalance: num(row.opening_balance),
  closingBalance: row.closing_balance != null ? num(row.closing_balance) : null,
  notes: row.notes,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mapEntry = (row: EntryRow): CashRegisterEntry => ({
  id: Number(row.id),
  shiftId: Number(row.shift_id),
  paymentId: row.payment_id != null ? Number(row.payment_id) : null,
  type: row.type as CashEntryType,
  amount: num(row.amount),
  method: normalizePaymentMethod(String(row.method)),
  note: row.note,
  createdAt: toIso(row.created_at),
});

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const mapEntryWithContext = (row: EntryRowWithContext): CashRegisterEntryListItem => {
  const payAmt =
    row.payment_amount != null && row.type === "payment" ? num(row.payment_amount) : 0;
  const refAmt =
    row.payment_refunded_amount != null && row.type === "payment"
      ? num(row.payment_refunded_amount)
      : 0;
  const remaining =
    row.type === "payment" && row.payment_id != null ? roundMoney(Math.max(0, payAmt - refAmt)) : undefined;
  const fullyRefunded =
    row.type === "payment" && row.payment_id != null
      ? row.payment_deleted_at != null || refAmt + 1e-6 >= payAmt
      : false;

  return {
    ...mapEntry(row),
    invoiceId: row.invoice_id != null ? Number(row.invoice_id) : null,
    patientId: row.patient_id != null ? Number(row.patient_id) : null,
    isPaymentRefunded: fullyRefunded,
    paymentRemainingRefundable: remaining,
  };
};

export class PostgresCashRegisterRepository implements ICashRegisterRepository {
  async findActiveShift(): Promise<CashRegisterShift | null> {
    const result = await dbPool.query<ShiftRow>(
      `
        SELECT
          id,
          opened_by,
          closed_by,
          opened_at,
          closed_at,
          opening_balance,
          closing_balance,
          notes,
          created_at,
          updated_at
        FROM cash_register_shifts
        WHERE closed_at IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
      `
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapShift(result.rows[0]);
  }

  async openShift(input: OpenShiftInput): Promise<CashRegisterShift> {
    const result = await dbPool.query<ShiftRow>(
      `
        INSERT INTO cash_register_shifts (
          opened_by,
          opening_balance,
          notes,
          updated_at
        )
        VALUES ($1, $2, $3, NOW())
        RETURNING
          id,
          opened_by,
          closed_by,
          opened_at,
          closed_at,
          opening_balance,
          closing_balance,
          notes,
          created_at,
          updated_at
      `,
      [input.openedBy ?? null, input.openingBalance, input.notes ?? null]
    );
    return mapShift(result.rows[0]);
  }

  async findShiftById(id: number): Promise<CashRegisterShift | null> {
    const result = await dbPool.query<ShiftRow>(
      `
        SELECT
          id,
          opened_by,
          closed_by,
          opened_at,
          closed_at,
          opening_balance,
          closing_balance,
          notes,
          created_at,
          updated_at
        FROM cash_register_shifts
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapShift(result.rows[0]);
  }

  async closeShift(id: number, input: CloseShiftInput): Promise<CashRegisterShift | null> {
    const setParts: string[] = [
      "closed_at = NOW()",
      "closing_balance = $2",
      "closed_by = $3",
      "updated_at = NOW()",
    ];
    const values: Array<number | string | null> = [id, input.closingBalance, input.closedBy ?? null];
    if (input.notes !== undefined) {
      values.push(input.notes);
      setParts.push(`notes = $${values.length}`);
    }

    const result = await dbPool.query<ShiftRow>(
      `
        UPDATE cash_register_shifts
        SET ${setParts.join(", ")}
        WHERE id = $1
          AND closed_at IS NULL
        RETURNING
          id,
          opened_by,
          closed_by,
          opened_at,
          closed_at,
          opening_balance,
          closing_balance,
          notes,
          created_at,
          updated_at
      `,
      values
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapShift(result.rows[0]);
  }

  async findShiftHistory(): Promise<CashRegisterShift[]> {
    const result = await dbPool.query<ShiftRow>(
      `
        SELECT
          id,
          opened_by,
          closed_by,
          opened_at,
          closed_at,
          opening_balance,
          closing_balance,
          notes,
          created_at,
          updated_at
        FROM cash_register_shifts
        ORDER BY opened_at DESC
      `
    );
    return result.rows.map(mapShift);
  }

  async findEntries(filters: FindEntriesFilters = {}): Promise<CashRegisterEntry[]> {
    const clauses: string[] = [];
    const values: Array<number | string> = [];

    if (filters.shiftId !== undefined) {
      values.push(filters.shiftId);
      clauses.push(`shift_id = $${values.length}`);
    }
    if (filters.method !== undefined) {
      values.push(filters.method);
      clauses.push(
        `(CASE WHEN method = 'cash' THEN 'cash' ELSE 'card' END) = $${values.length}`
      );
    }
    if (filters.type !== undefined) {
      values.push(filters.type);
      clauses.push(`type = $${values.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await dbPool.query<EntryRow>(
      `
        SELECT
          id,
          shift_id,
          payment_id,
          type,
          amount,
          method,
          note,
          created_at
        FROM cash_register_entries
        ${where}
        ORDER BY created_at DESC
      `,
      values
    );
    return result.rows.map(mapEntry);
  }

  async findEntriesWithContext(
    filters: FindEntriesFilters = {}
  ): Promise<CashRegisterEntryListItem[]> {
    const clauses: string[] = [];
    const values: Array<number | string> = [];
    const tz = env.reportsTimezone.replace(/'/g, "''");

    if (filters.shiftId !== undefined) {
      values.push(filters.shiftId);
      clauses.push(`e.shift_id = $${values.length}`);
    }
    if (filters.method !== undefined) {
      values.push(filters.method);
      clauses.push(
        `(CASE WHEN e.method = 'cash' THEN 'cash' ELSE 'card' END) = $${values.length}`
      );
    }
    if (filters.type !== undefined) {
      values.push(filters.type);
      clauses.push(`e.type = $${values.length}`);
    }
    if (filters.dateFrom !== undefined) {
      values.push(filters.dateFrom);
      clauses.push(
        `(e.created_at AT TIME ZONE '${tz}')::date >= $${values.length}::date`
      );
    }
    if (filters.dateTo !== undefined) {
      values.push(filters.dateTo);
      clauses.push(
        `(e.created_at AT TIME ZONE '${tz}')::date <= $${values.length}::date`
      );
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await dbPool.query<EntryRowWithContext>(
      `
        SELECT
          e.id,
          e.shift_id,
          e.payment_id,
          e.type,
          e.amount,
          e.method,
          e.note,
          e.created_at,
          i.id AS invoice_id,
          i.patient_id AS patient_id,
          p.deleted_at AS payment_deleted_at,
          p.amount AS payment_amount,
          COALESCE(p.refunded_amount, 0) AS payment_refunded_amount
        FROM cash_register_entries e
        LEFT JOIN payments p ON p.id = e.payment_id
        LEFT JOIN invoices i ON i.id = p.invoice_id
        ${where}
        ORDER BY e.created_at DESC
      `,
      values
    );
    return result.rows.map(mapEntryWithContext);
  }

  async createCashRegisterEntry(input: CreateCashRegisterEntryInput): Promise<CashRegisterEntry> {
    const result = await dbPool.query<EntryRow>(
      `
        INSERT INTO cash_register_entries (
          shift_id,
          payment_id,
          type,
          amount,
          method,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          shift_id,
          payment_id,
          type,
          amount,
          method,
          note,
          created_at
      `,
      [
        input.shiftId,
        input.paymentId ?? null,
        input.type,
        input.amount,
        input.method,
        input.note ?? null,
      ]
    );
    return mapEntry(result.rows[0]);
  }

  async clearFinancialData(): Promise<void> {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM cash_register_entries`);
      await client.query(`DELETE FROM payments`);
      await client.query(`DELETE FROM invoice_items`);
      await client.query(`DELETE FROM invoices`);
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
  }
}
