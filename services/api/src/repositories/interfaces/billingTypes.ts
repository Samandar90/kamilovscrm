import type { AppointmentBillingStatus } from "./coreTypes";

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
  "refunded",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceItemInput = {
  serviceId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoiceItem = {
  id: number;
  invoiceId: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type Invoice = {
  id: number;
  number: string;
  patientId: number;
  appointmentId: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
};

export type InvoiceSummary = Omit<Invoice, "items">;

export type InvoiceFilters = {
  patientId?: number;
  appointmentId?: number;
  status?: InvoiceStatus;
};

export type InvoiceCreateInput = {
  number: string;
  patientId: number;
  appointmentId?: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
};

export type InvoiceUpdateInput = Partial<InvoiceCreateInput>;

export const PAYMENT_METHODS = ["cash", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Для ответов API: всё кроме cash считается «Терминал» (в т.ч. бывший bank_transfer / безнал). */
export function normalizePaymentMethod(raw: string): PaymentMethod {
  return raw === "cash" ? "cash" : "card";
}

export type Payment = {
  id: number;
  invoiceId: number;
  amount: number;
  /** Накоплено возвращено по этому платежу (до полного void). */
  refundedAmount: number;
  method: PaymentMethod;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  voidReason: string | null;
};

export type PaymentFilters = {
  invoiceId?: number;
  method?: PaymentMethod;
};

export type PaymentCreateInput = {
  /** Клиника из JWT / req.clinicId — обязательна для INSERT (payments.clinic_id NOT NULL). */
  clinicId: number;
  invoiceId: number;
  amount: number;
  method: PaymentMethod;
  /**
   * Всегда задаётся: клиентский ключ или серверный UUID v4 (не отдаётся клиенту отдельно).
   * Replay только если idempotencyKeyClientSupplied === true и совпал createdByUserId.
   */
  idempotencyKey: string;
  idempotencyKeyClientSupplied: boolean;
  /** Автор операции (JWT userId); вместе с ключом задаёт область идемпотентности. */
  createdByUserId: number;
};

/**
 * Запись кассы и billing_status приёма — в той же транзакции, что платёж + счёт (Postgres).
 * Если не передано — поведение как раньше (только платёж + статус счёта).
 */
export type PaymentCreateAtomicExtras = {
  shiftId: number;
  cashAmount: number;
  cashMethod: PaymentMethod;
  cashNote: string;
  appointmentId: number | null;
  appointmentBillingStatus: AppointmentBillingStatus | null;
};

/** Атомарное применение возврата (Postgres: включая кассу в одной транзакции). */
export type PaymentRefundApplyInput = {
  clinicId: number;
  paymentId: number;
  refundAmount: number;
  reason: string;
  invoiceId: number;
  newInvoiceStatus: InvoiceStatus;
  shiftId: number;
  method: PaymentMethod;
  cashNote: string;
};

/** Soft-delete платежа + обновление статуса счёта (одна транзакция в Postgres). Касса — в сервисе. */
export type PaymentDeleteWithInvoiceAndCashInput = {
  paymentId: number;
  voidReason: string | null;
  invoiceId: number;
  nextInvoiceStatus: InvoiceStatus;
  /** Для mock-репозитория (колонка paid); Postgres при чтении счёта пересчитывает из payments. */
  invoicePaidAmountAfterDelete: number;
};

export type InvoiceForPayment = {
  id: number;
  appointmentId: number | null;
  status: InvoiceStatus;
  total: number;
  paidAmount: number;
};

export const CASH_ENTRY_TYPES = [
  "payment",
  "refund",
  "manual_in",
  "manual_out",
  /** Сторно аннулирования платежа (отрицательная сумма уменьшает чистый приход смены). */
  "void",
] as const;
export const CASH_ENTRY_METHODS = ["cash", "card"] as const;

export type CashEntryType = (typeof CASH_ENTRY_TYPES)[number];
export type CashEntryMethod = (typeof CASH_ENTRY_METHODS)[number];

export type CashRegisterShift = {
  id: number;
  openedBy: number | null;
  closedBy: number | null;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CashRegisterEntry = {
  id: number;
  shiftId: number;
  paymentId: number | null;
  type: CashEntryType;
  amount: number;
  method: CashEntryMethod;
  note: string | null;
  createdAt: string;
};

/** Кассовая строка с контекстом счёта/пациента (из JOIN по payment → invoice). */
export type CashRegisterEntryListItem = CashRegisterEntry & {
  invoiceId: number | null;
  patientId: number | null;
  /** Для строки типа payment: исходный платёж аннулирован (оформлен возврат). */
  isPaymentRefunded?: boolean;
  /** Для строки типа payment: сколько ещё можно вернуть по исходному платежу. */
  paymentRemainingRefundable?: number;
};

/** Сводка по активной смене для экрана кассы. */
export type CashRegisterShiftSummary = {
  shiftId: number;
  openingBalance: number;
  totalIncome: number;
  totalCash: number;
  /** Терминал (карта; бывший безнал учитывается здесь же). */
  totalCard: number;
  operationsCount: number;
  closingBalancePreview: number;
};

export type OpenShiftInput = {
  openedBy?: number | null;
  openingBalance: number;
  notes?: string | null;
};

export type CloseShiftInput = {
  closedBy?: number | null;
  closingBalance: number;
  notes?: string | null;
};

export type FindEntriesFilters = {
  shiftId?: number;
  method?: CashEntryMethod;
  type?: CashEntryType;
  /** YYYY-MM-DD inclusive, interpreted in clinic report timezone (see env.reportsTimezone). */
  dateFrom?: string;
  /** YYYY-MM-DD inclusive. */
  dateTo?: string;
};

export type CreateCashRegisterEntryInput = {
  clinicId: number;
  shiftId: number;
  paymentId?: number | null;
  type: CashEntryType;
  amount: number;
  method: CashEntryMethod;
  note?: string | null;
};

export type ReportsGranularity = "day" | "week" | "month";
export type ReportsDateRange = { dateFrom?: string; dateTo?: string };
export type RevenuePoint = { periodStart: string; totalRevenue: number };
export type RevenueByDoctorRow = {
  doctorId: number | null;
  doctorName: string | null;
  totalRevenue: number;
};
export type RevenueByServiceRow = {
  serviceId: number | null;
  serviceName: string | null;
  totalRevenue: number;
};
export type ReportMetrics = {
  totalPaymentsAmount: number;
  paymentsCount: number;
  appointmentsCount: number;
};
export type PaymentsByMethodRow = {
  method: PaymentMethod;
  totalAmount: number;
};
export type InvoiceStatusSummaryRow = {
  status: string;
  count: number;
  totalAmount: number;
};

/** GET /api/reports/summary — дневные точки и разрезы за скользящее окно (см. репозиторий). */
export type ReportsSummaryRevenueDayRow = { date: string; amount: number };
export type ReportsSummaryRevenueByDoctorRow = { doctorName: string; amount: number };
/** count — число позиций счёта (строк invoice_items) за период по счетам с оплатой в окне */
export type ReportsSummaryRevenueByServiceRow = { serviceName: string; amount: number; count: number };
export type ReportsSummaryData = {
  revenueToday: number;
  revenueYesterday: number;
  revenueWeek: number;
  /** Та же длина интервала, что у `revenueWeek` (от начала недели до сегодня), сдвинута на 7 дней назад. */
  revenuePreviousWeek: number;
  revenueMonth: number;
  revenueByDay: ReportsSummaryRevenueDayRow[];
  revenueByDoctor: ReportsSummaryRevenueByDoctorRow[];
  revenueByService: ReportsSummaryRevenueByServiceRow[];
};
