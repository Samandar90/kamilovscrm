import type {
  CashRegisterEntry,
  CashRegisterEntryListItem,
  CashRegisterShift,
  CloseShiftInput,
  CreateCashRegisterEntryInput,
  FindEntriesFilters,
  OpenShiftInput,
} from "./billingTypes";

export interface ICashRegisterRepository {
  findActiveShift(): Promise<CashRegisterShift | null>;
  openShift(input: OpenShiftInput): Promise<CashRegisterShift>;
  findShiftById(id: number): Promise<CashRegisterShift | null>;
  closeShift(id: number, input: CloseShiftInput): Promise<CashRegisterShift | null>;
  findShiftHistory(): Promise<CashRegisterShift[]>;
  findEntries(filters?: FindEntriesFilters): Promise<CashRegisterEntry[]>;
  findEntriesWithContext(filters?: FindEntriesFilters): Promise<CashRegisterEntryListItem[]>;
  createCashRegisterEntry(input: CreateCashRegisterEntryInput): Promise<CashRegisterEntry>;
  clearFinancialData(): Promise<void>;
}
