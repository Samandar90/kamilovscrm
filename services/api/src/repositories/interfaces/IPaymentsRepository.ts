import type {
  InvoiceForPayment,
  InvoiceStatus,
  Payment,
  PaymentCreateAtomicExtras,
  PaymentCreateInput,
  PaymentDeleteWithInvoiceAndCashInput,
  PaymentFilters,
  PaymentRefundApplyInput,
} from "./billingTypes";

export interface IPaymentsRepository {
  findAll(filters?: PaymentFilters): Promise<Payment[]>;
  findById(id: number): Promise<Payment | null>;
  /**
   * Активный платёж с тем же клиентским ключом и тем же пользователем
   * (idempotency_key_client_supplied = true).
   */
  findActivePaymentByIdempotencyKey(
    userId: number,
    key: string
  ): Promise<Payment | null>;
  /** Включая аннулированные (soft-delete) — для проверки возврата. */
  findByIdIncludingVoided(id: number): Promise<Payment | null>;
  create(input: PaymentCreateInput): Promise<Payment>;
  /**
   * Одна транзакция: блокировка счёта (FOR UPDATE), проверка остатка по сумме платежей,
   * INSERT платежа, UPDATE статуса счёта. Защита от двойной оплаты при параллельных запросах.
   */
  createPaymentAndUpdateInvoice(
    input: PaymentCreateInput,
    nextInvoiceStatus: InvoiceStatus,
    atomicExtras?: PaymentCreateAtomicExtras
  ): Promise<Payment>;
  delete(id: number, voidReason: string | null): Promise<boolean>;
  /**
   * Postgres: BEGIN → soft-delete платежа → UPDATE счёта → COMMIT.
   * Mock: delete + update счёта.
   */
  deletePaymentUpdateInvoiceWithOptionalCash(
    input: PaymentDeleteWithInvoiceAndCashInput
  ): Promise<{ deleted: boolean }>;
  findInvoiceByIdForPayment(id: number): Promise<InvoiceForPayment | null>;
  updateInvoicePaymentState(
    invoiceId: number,
    paidAmount: number,
    status: InvoiceStatus
  ): Promise<boolean>;

  /**
   * Применить возврат по платежу.
   * Postgres: одна транзакция (платёж + счёт + касса), возвращает cashWrittenInRepo: true.
   * Mock: только платёж + счёт, кассу пишет сервис (cashWrittenInRepo: false).
   */
  applyRefund(input: PaymentRefundApplyInput): Promise<{ cashWrittenInRepo: boolean }>;
}
