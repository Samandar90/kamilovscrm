import { dbPool } from "../../config/database";
import { parseMoneyColumn } from "../../utils/numbers";
import { requireClinicId } from "../../tenancy/clinicContext";
import type { IExpensesRepository } from "../interfaces/IExpensesRepository";
import type {
  Expense,
  ExpenseCreateInput,
  ExpenseFilters,
  ExpenseUpdateInput,
} from "../interfaces/expensesTypes";

type ExpenseRow = {
  id: string | number;
  amount: string | number;
  category: string;
  description: string | null;
  paid_at: Date | string;
  created_at: Date | string;
  deleted_at: Date | string | null;
};

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const num = (value: string | number): number => parseMoneyColumn(value, 0);

const mapExpense = (row: ExpenseRow): Expense => ({
  id: Number(row.id),
  amount: num(row.amount),
  category: row.category,
  description: row.description,
  paidAt: toIso(row.paid_at),
  createdAt: toIso(row.created_at),
  deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
});

export class PostgresExpensesRepository implements IExpensesRepository {
  async findAll(filters: ExpenseFilters = {}): Promise<Expense[]> {
    const clinicId = requireClinicId();
    const values: Array<string | number> = [clinicId];
    const clauses: string[] = ["deleted_at IS NULL", `clinic_id = $${values.length}`];

    if (filters.category) {
      values.push(filters.category);
      clauses.push(`category = $${values.length}`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      clauses.push(`paid_at >= $${values.length}::timestamptz`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      clauses.push(`paid_at <= $${values.length}::timestamptz`);
    }

    const result = await dbPool.query<ExpenseRow>(
      `
        SELECT
          id,
          amount,
          category,
          description,
          paid_at,
          created_at,
          deleted_at
        FROM expenses
        WHERE ${clauses.join(" AND ")}
        ORDER BY paid_at DESC, id DESC
      `,
      values
    );
    return result.rows.map(mapExpense);
  }

  async create(input: ExpenseCreateInput): Promise<Expense> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<ExpenseRow>(
      `
        INSERT INTO expenses (clinic_id, amount, category, description, paid_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        RETURNING id, amount, category, description, paid_at, created_at, deleted_at
      `,
      [clinicId, input.amount, input.category, input.description ?? null, input.paidAt]
    );
    return mapExpense(result.rows[0]);
  }

  async update(id: number, input: ExpenseUpdateInput): Promise<Expense | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<ExpenseRow>(
      `
        UPDATE expenses
        SET
          amount = COALESCE($2::numeric, amount),
          category = COALESCE($3::text, category),
          description = COALESCE($4::text, description),
          paid_at = COALESCE($5::timestamptz, paid_at)
        WHERE id = $1
          AND clinic_id = $6
          AND deleted_at IS NULL
        RETURNING id, amount, category, description, paid_at, created_at, deleted_at
      `,
      [id, input.amount ?? null, input.category ?? null, input.description ?? null, input.paidAt ?? null, clinicId]
    );
    return result.rows[0] ? mapExpense(result.rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: string | number }>(
      `
        UPDATE expenses
        SET deleted_at = NOW()
        WHERE id = $1
          AND clinic_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [id, clinicId]
    );
    return result.rows.length > 0;
  }
}

