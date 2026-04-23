import type { ICashRegisterRepository } from "./interfaces/ICashRegisterRepository";
import {
  CASH_ENTRY_METHODS,
  CASH_ENTRY_TYPES,
  normalizePaymentMethod,
  type CashEntryMethod,
  type CashEntryType,
  type CashRegisterEntry,
  type CashRegisterEntryListItem,
  type CashRegisterShift,
  type CloseShiftInput,
  type CreateCashRegisterEntryInput,
  type FindEntriesFilters,
  type OpenShiftInput,
} from "./interfaces/billingTypes";
import { getMockDb, nextId } from "./mockDatabase";

export {
  CASH_ENTRY_METHODS,
  CASH_ENTRY_TYPES,
  type CashEntryMethod,
  type CashEntryType,
  type CashRegisterEntry,
  type CashRegisterEntryListItem,
  type CashRegisterShift,
  type CloseShiftInput,
  type CreateCashRegisterEntryInput,
  type FindEntriesFilters,
  type OpenShiftInput,
};

export class MockCashRegisterRepository implements ICashRegisterRepository {
  async findActiveShift(): Promise<CashRegisterShift | null> {
    const found = [...getMockDb().cashRegisterShifts]
      .filter((row) => row.closedAt === null)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
    return found ? { ...found } : null;
  }

  async openShift(input: OpenShiftInput): Promise<CashRegisterShift> {
    const now = new Date().toISOString();
    const created = {
      id: nextId(),
      openedBy: input.openedBy ?? null,
      closedBy: null,
      openedAt: now,
      closedAt: null,
      openingBalance: input.openingBalance,
      closingBalance: null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    getMockDb().cashRegisterShifts.push(created);
    return { ...created };
  }

  async findShiftById(id: number): Promise<CashRegisterShift | null> {
    const found = getMockDb().cashRegisterShifts.find((row) => row.id === id);
    return found ? { ...found } : null;
  }

  async closeShift(id: number, input: CloseShiftInput): Promise<CashRegisterShift | null> {
    const db = getMockDb();
    const idx = db.cashRegisterShifts.findIndex((row) => row.id === id && row.closedAt === null);
    if (idx < 0) return null;
    db.cashRegisterShifts[idx] = {
      ...db.cashRegisterShifts[idx],
      closedAt: new Date().toISOString(),
      closingBalance: input.closingBalance,
      closedBy: input.closedBy ?? db.cashRegisterShifts[idx].closedBy,
      notes: input.notes ?? db.cashRegisterShifts[idx].notes,
      updatedAt: new Date().toISOString(),
    };
    return { ...db.cashRegisterShifts[idx] };
  }

  async findShiftHistory(): Promise<CashRegisterShift[]> {
    return [...getMockDb().cashRegisterShifts]
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((row) => ({ ...row }));
  }

  async findEntries(filters: FindEntriesFilters = {}): Promise<CashRegisterEntry[]> {
    const dayKey = (iso: string): string => iso.slice(0, 10);
    return getMockDb()
      .cashRegisterEntries.filter((row) => {
        if (filters.shiftId !== undefined && row.shiftId !== filters.shiftId) return false;
        if (
          filters.method !== undefined &&
          normalizePaymentMethod(String(row.method)) !== filters.method
        ) {
          return false;
        }
        if (filters.type !== undefined && row.type !== filters.type) return false;
        if (filters.dateFrom !== undefined && dayKey(row.createdAt) < filters.dateFrom) {
          return false;
        }
        if (filters.dateTo !== undefined && dayKey(row.createdAt) > filters.dateTo) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        ...row,
        method: normalizePaymentMethod(String(row.method)),
      }));
  }

  async findEntriesWithContext(
    filters: FindEntriesFilters = {}
  ): Promise<CashRegisterEntryListItem[]> {
    const base = await this.findEntries(filters);
    const db = getMockDb();
    return base.map((e) => {
      let invoiceId: number | null = null;
      let patientId: number | null = null;
      let payRow: (typeof db.payments)[0] | undefined;
      if (e.paymentId != null) {
        payRow = db.payments.find((p) => p.id === e.paymentId);
        if (payRow) {
          const invId = payRow.invoiceId;
          invoiceId = invId;
          const inv = db.invoices.find((i) => i.id === invId);
          patientId = inv?.patientId ?? null;
        }
      }
      const refAmt = payRow?.refundedAmount ?? 0;
      const payAmt = payRow?.amount ?? 0;
      const remaining =
        e.type === "payment" && payRow != null
          ? Math.round((Math.max(0, payAmt - refAmt) + Number.EPSILON) * 100) / 100
          : undefined;
      const isPaymentRefunded =
        e.type === "payment" &&
        payRow != null &&
        (payRow.deletedAt != null || refAmt + 1e-6 >= payAmt);
      return { ...e, invoiceId, patientId, isPaymentRefunded, paymentRemainingRefundable: remaining };
    });
  }

  async createCashRegisterEntry(
    input: CreateCashRegisterEntryInput
  ): Promise<CashRegisterEntry> {
    const created = {
      id: nextId(),
      shiftId: input.shiftId,
      paymentId: input.paymentId ?? null,
      type: input.type,
      amount: input.amount,
      method: input.method,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    };
    getMockDb().cashRegisterEntries.push(created);
    return { ...created };
  }

  async clearFinancialData(): Promise<void> {
    const db = getMockDb();
    db.cashRegisterEntries = [];
    db.payments = [];
    db.invoiceItems = [];
    db.invoices = [];
  }
}

