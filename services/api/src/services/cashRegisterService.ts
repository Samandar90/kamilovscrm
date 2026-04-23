import {
  type ICashRegisterRepository,
} from "../repositories/interfaces/ICashRegisterRepository";
import { ApiError } from "../middleware/errorHandler";
import type {
  CashEntryMethod,
  CashEntryType,
  CashRegisterEntry,
  CashRegisterEntryListItem,
  CashRegisterShift,
  CashRegisterShiftSummary,
} from "../repositories/interfaces/billingTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { parseNumericInput, roundMoney2 } from "../utils/numbers";

type OpenShiftPayload = {
  openedBy?: number | null;
  openingBalance?: number;
  notes?: string | null;
};

type CloseShiftPayload = {
  closedBy?: number | null;
  notes?: string | null;
};

type EntriesFilters = {
  shiftId?: number;
  type?: CashEntryType;
  method?: CashEntryMethod;
  dateFrom?: string;
  dateTo?: string;
};

const roundMoney = (value: unknown): number => {
  const n = parseNumericInput(value);
  return roundMoney2(n ?? 0);
};

const normalizeOptionalString = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export class CashRegisterService {
  constructor(private readonly cashRegisterRepository: ICashRegisterRepository) {}

  async openShift(
    _auth: AuthTokenPayload,
    payload: OpenShiftPayload
  ): Promise<CashRegisterShift> {
    const existingActive = await this.cashRegisterRepository.findActiveShift();
    if (existingActive) {
      throw new ApiError(409, "Смена уже открыта");
    }

    const openingBalance = roundMoney(payload.openingBalance);
    if (openingBalance < 0) {
      throw new ApiError(400, "Начальный остаток не может быть отрицательным");
    }

    return this.cashRegisterRepository.openShift({
      openedBy: payload.openedBy ?? null,
      openingBalance,
      notes: normalizeOptionalString(payload.notes) ?? null,
    });
  }

  async getActiveShift(_auth: AuthTokenPayload): Promise<CashRegisterShift | null> {
    return this.cashRegisterRepository.findActiveShift();
  }

  async closeShift(
    _auth: AuthTokenPayload,
    shiftId: number,
    payload: CloseShiftPayload
  ): Promise<CashRegisterShift> {
    const shift = await this.cashRegisterRepository.findShiftById(shiftId);
    if (!shift) {
      throw new ApiError(404, "Смена не найдена");
    }
    if (shift.closedAt) {
      throw new ApiError(409, "Смена уже закрыта");
    }

    const entries = await this.cashRegisterRepository.findEntries({ shiftId });
    const totals = entries.reduce(
      (acc, entry) => {
        if (entry.type === "payment" || entry.type === "manual_in") {
          acc.inflow = roundMoney(acc.inflow + entry.amount);
        } else if (entry.type === "refund" || entry.type === "manual_out") {
          acc.outflow = roundMoney(acc.outflow + entry.amount);
        } else if (entry.type === "void") {
          acc.inflow = roundMoney(acc.inflow + entry.amount);
        }
        return acc;
      },
      { inflow: 0, outflow: 0 }
    );

    const closingBalance = roundMoney(shift.openingBalance + totals.inflow - totals.outflow);
    if (closingBalance < 0) {
      throw new ApiError(409, "Итоговый остаток не может быть отрицательным");
    }

    const closed = await this.cashRegisterRepository.closeShift(shiftId, {
      closedBy: payload.closedBy ?? null,
      closingBalance,
      notes: normalizeOptionalString(payload.notes),
    });
    if (!closed) {
      throw new ApiError(409, "Не удалось закрыть смену");
    }
    return closed;
  }

  async getShiftHistory(_auth: AuthTokenPayload): Promise<CashRegisterShift[]> {
    return this.cashRegisterRepository.findShiftHistory();
  }

  async getShiftById(_auth: AuthTokenPayload, shiftId: number): Promise<CashRegisterShift> {
    const shift = await this.cashRegisterRepository.findShiftById(shiftId);
    if (!shift) {
      throw new ApiError(404, "Смена не найдена");
    }
    return shift;
  }

  async listEntries(
    _auth: AuthTokenPayload,
    filters: EntriesFilters = {}
  ): Promise<CashRegisterEntryListItem[]> {
    if (filters.shiftId !== undefined) {
      return this.cashRegisterRepository.findEntriesWithContext(filters);
    }

    const activeShift = await this.cashRegisterRepository.findActiveShift();
    if (!activeShift) {
      return [];
    }

    return this.cashRegisterRepository.findEntriesWithContext({
      ...filters,
      shiftId: activeShift.id,
    });
  }

  async getCurrentShiftSummary(
    _auth: AuthTokenPayload
  ): Promise<CashRegisterShiftSummary | null> {
    const shift = await this.cashRegisterRepository.findActiveShift();
    if (!shift) {
      return null;
    }

    const entries = await this.cashRegisterRepository.findEntries({ shiftId: shift.id });

    let totalIncome = 0;
    let totalOutflow = 0;
    let totalCash = 0;
    let totalCard = 0;

    for (const entry of entries) {
      if (entry.type === "payment" || entry.type === "manual_in") {
        totalIncome = roundMoney(totalIncome + entry.amount);
        if (entry.method === "cash") totalCash = roundMoney(totalCash + entry.amount);
        else totalCard = roundMoney(totalCard + entry.amount);
      } else if (entry.type === "refund" || entry.type === "manual_out") {
        totalOutflow = roundMoney(totalOutflow + entry.amount);
      } else if (entry.type === "void") {
        totalIncome = roundMoney(totalIncome + entry.amount);
        if (entry.method === "cash") totalCash = roundMoney(totalCash + entry.amount);
        else totalCard = roundMoney(totalCard + entry.amount);
      }
    }

    const closingBalancePreview = roundMoney(
      shift.openingBalance + totalIncome - totalOutflow
    );

    return {
      shiftId: shift.id,
      openingBalance: shift.openingBalance,
      totalIncome,
      totalCash,
      totalCard,
      operationsCount: entries.length,
      closingBalancePreview,
    };
  }

  async clearFinancialData(auth: AuthTokenPayload): Promise<void> {
    if (auth.role !== "superadmin") {
      throw new ApiError(403, "Только superadmin может очищать кассу");
    }
    await this.cashRegisterRepository.clearFinancialData();
  }
}

