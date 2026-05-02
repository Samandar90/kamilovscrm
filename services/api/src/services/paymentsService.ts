import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import {
  type ICashRegisterRepository,
} from "../repositories/interfaces/ICashRegisterRepository";
import { type IAppointmentsRepository } from "../repositories/interfaces/IAppointmentsRepository";
import {
  type IPaymentsRepository,
} from "../repositories/interfaces/IPaymentsRepository";
import type {
  InvoiceStatus,
  Payment,
  PaymentCreateInput,
  PaymentFilters,
  PaymentMethod,
} from "../repositories/interfaces/billingTypes";
import { randomUUID } from "node:crypto";
import { invalidateClinicFactsCache } from "../ai/aiCacheService";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { parseNumericInput, roundMoney2 } from "../utils/numbers";

type CreatePaymentPayload = {
  invoiceId: number;
  amount: number;
  method: PaymentMethod;
  idempotencyKey?: string;
};

const roundMoney = (value: unknown): number => {
  const n = parseNumericInput(value);
  if (n === null) {
    throw new ApiError(400, "Некорректная денежная сумма");
  }
  return roundMoney2(n);
};

const deriveInvoiceStatusFromPayment = (
  currentStatus: InvoiceStatus,
  total: number,
  paidAmount: number
): InvoiceStatus => {
  if (currentStatus === "cancelled" || currentStatus === "refunded") {
    return currentStatus;
  }

  if (paidAmount === total) {
    return "paid";
  }

  if (paidAmount > 0 && paidAmount < total) {
    return "partially_paid";
  }

  if (paidAmount === 0) {
    if (currentStatus === "paid" || currentStatus === "partially_paid") {
      return "issued";
    }

    return currentStatus;
  }

  return currentStatus;
};

export class PaymentsService {
  constructor(
    private readonly paymentsRepository: IPaymentsRepository,
    private readonly cashRegisterRepository: ICashRegisterRepository,
    private readonly appointmentsRepository: IAppointmentsRepository
  ) {}

  async list(
    _auth: AuthTokenPayload,
    filters: PaymentFilters = {}
  ): Promise<Payment[]> {
    return this.paymentsRepository.findAll(filters);
  }

  async getById(_auth: AuthTokenPayload, id: number): Promise<Payment | null> {
    return this.paymentsRepository.findById(id);
  }

  async create(
    _auth: AuthTokenPayload,
    payload: CreatePaymentPayload,
    clinicId: number
  ): Promise<Payment> {
    if (!Number.isInteger(clinicId) || clinicId <= 0) {
      throw new ApiError(401, "Clinic context is missing");
    }
    if (clinicId !== _auth.clinicId) {
      throw new ApiError(403, "Clinic mismatch");
    }

    const amount = roundMoney(payload.amount);
    if (amount <= 0) {
      throw new ApiError(400, "Сумма оплаты должна быть больше нуля");
    }

    const clientSupplied =
      typeof payload.idempotencyKey === "string" &&
      payload.idempotencyKey.trim().length > 0;
    const resolvedIdempotencyKey = clientSupplied
      ? payload.idempotencyKey!.trim()
      : randomUUID();

    if (clientSupplied) {
      const existing =
        await this.paymentsRepository.findActivePaymentByIdempotencyKey(
          _auth.userId,
          resolvedIdempotencyKey
        );
      if (existing) {
        if (
          existing.invoiceId !== payload.invoiceId ||
          roundMoney(existing.amount) !== amount ||
          existing.method !== payload.method
        ) {
          throw new ApiError(
            409,
            "Ключ идемпотентности уже использован с другими параметрами"
          );
        }
        return existing;
      }
    }

    let activeShift = await this.cashRegisterRepository.findActiveShift();
    if (!activeShift && env.cashRegisterAutoOpenDev) {
      try {
        activeShift = await this.cashRegisterRepository.openShift({
          openedBy: null,
          openingBalance: 0,
          notes: "Auto-opened (CASH_REGISTER_AUTO_OPEN_DEV=true)",
        });
      } catch {
        activeShift = await this.cashRegisterRepository.findActiveShift();
      }
    }
    if (!activeShift) {
      throw new ApiError(
        409,
        "Сначала откройте кассовую смену"
      );
    }

    const invoice = await this.paymentsRepository.findInvoiceByIdForPayment(payload.invoiceId);
    if (!invoice) {
      throw new ApiError(404, "Счёт не найден");
    }

    if (invoice.status === "cancelled" || invoice.status === "refunded") {
      throw new ApiError(409, "Нельзя принять оплату по отменённому или возвращённому счёту");
    }

    if (invoice.status === "draft") {
      throw new ApiError(409, "Нельзя оплатить черновик — сначала выставьте счёт");
    }

    if (invoice.status === "paid") {
      throw new ApiError(409, "Счет уже оплачен");
    }

    const remaining = roundMoney(invoice.total - invoice.paidAmount);
    if (remaining <= 0) {
      throw new ApiError(409, "Счет уже оплачен");
    }

    if (amount > remaining) {
      throw new ApiError(409, "Сумма оплаты превышает остаток");
    }

    const paymentInput: PaymentCreateInput = {
      clinicId,
      invoiceId: payload.invoiceId,
      amount,
      method: payload.method,
      idempotencyKey: resolvedIdempotencyKey,
      idempotencyKeyClientSupplied: clientSupplied,
      createdByUserId: _auth.userId,
    };
    const newPaidAmount = roundMoney(invoice.paidAmount + amount);
    const nextStatus = deriveInvoiceStatusFromPayment(
      invoice.status,
      invoice.total,
      newPaidAmount
    );

    const createdPayment = await this.paymentsRepository.createPaymentAndUpdateInvoice(
      paymentInput,
      nextStatus
    );
    if (invoice.appointmentId) {
      const targetBilling = nextStatus === "paid" ? "paid" : "ready_for_payment";
      await this.appointmentsRepository.updateBillingStatus(
        invoice.appointmentId,
        targetBilling
      );
    }

    await this.cashRegisterRepository.createCashRegisterEntry({
      shiftId: activeShift.id,
      paymentId: createdPayment.id,
      type: "payment",
      amount,
      method: payload.method,
      note: `Оплата по счёту #${invoice.id}`,
    });

    invalidateClinicFactsCache();
    return createdPayment;
  }

  /**
   * Возврат оплаты (полный или частичный): учёт refunded_amount, пересчёт счёта, запись refund в кассе.
   */
  async refund(
    _auth: AuthTokenPayload,
    paymentId: number,
    payload: { reason: string; amount?: number }
  ): Promise<void> {
    const reason = payload.reason.trim();
    if (reason.length < 3) {
      throw new ApiError(400, "Укажите причину возврата (не менее 3 символов)");
    }

    const payment = await this.paymentsRepository.findById(paymentId);
    if (!payment) {
      throw new ApiError(404, "Платёж не найден");
    }

    const remainingRefundable = roundMoney(payment.amount - (payment.refundedAmount ?? 0));
    if (remainingRefundable <= 0) {
      throw new ApiError(409, "Платёж уже возвращён");
    }

    let refundAmount: number;
    if (payload.amount !== undefined && payload.amount !== null) {
      refundAmount = roundMoney(payload.amount);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new ApiError(400, "Некорректная сумма возврата");
      }
      if (refundAmount > remainingRefundable + 1e-9) {
        throw new ApiError(400, "Некорректная сумма возврата");
      }
    } else {
      refundAmount = remainingRefundable;
    }

    let activeShift = await this.cashRegisterRepository.findActiveShift();
    if (!activeShift && env.cashRegisterAutoOpenDev) {
      try {
        activeShift = await this.cashRegisterRepository.openShift({
          openedBy: null,
          openingBalance: 0,
          notes: "Auto-opened (CASH_REGISTER_AUTO_OPEN_DEV=true)",
        });
      } catch {
        activeShift = await this.cashRegisterRepository.findActiveShift();
      }
    }
    if (!activeShift) {
      throw new ApiError(409, "Сначала откройте кассовую смену");
    }

    const invoice = await this.paymentsRepository.findInvoiceByIdForPayment(payment.invoiceId);
    if (!invoice) {
      throw new ApiError(404, "Счёт не найден");
    }

    if (invoice.status === "cancelled" || invoice.status === "refunded") {
      throw new ApiError(409, "Невозможно выполнить возврат");
    }

    if (refundAmount > invoice.paidAmount + 1e-9) {
      throw new ApiError(400, "Некорректная сумма возврата");
    }

    const newPaidAmount = roundMoney(invoice.paidAmount - refundAmount);
    if (newPaidAmount < -1e-9) {
      throw new ApiError(400, "Некорректная сумма возврата");
    }

    const nextStatus = deriveInvoiceStatusFromPayment(
      invoice.status,
      invoice.total,
      newPaidAmount
    );

    const cashNote = `Возврат по оплате #${payment.id}: ${reason}`;

    const { cashWrittenInRepo } = await this.paymentsRepository.applyRefund({
      paymentId: payment.id,
      refundAmount,
      reason,
      invoiceId: invoice.id,
      newInvoiceStatus: nextStatus,
      shiftId: activeShift.id,
      method: payment.method,
      cashNote,
    });

    if (!cashWrittenInRepo) {
      await this.cashRegisterRepository.createCashRegisterEntry({
        shiftId: activeShift.id,
        paymentId: payment.id,
        type: "refund",
        amount: refundAmount,
        method: payment.method,
        note: cashNote,
      });
    }
    if (invoice.appointmentId) {
      await this.appointmentsRepository.updateBillingStatus(
        invoice.appointmentId,
        nextStatus === "paid" ? "paid" : "ready_for_payment"
      );
    }
    invalidateClinicFactsCache();
  }

  async delete(
    _auth: AuthTokenPayload,
    id: number,
    voidReason?: string
  ): Promise<boolean> {
    const normalizedVoidReason =
      typeof voidReason === "string" && voidReason.trim() !== ""
        ? voidReason.trim()
        : null;

    const payment = await this.paymentsRepository.findById(id);
    if (!payment) {
      return false;
    }

    const invoice = await this.paymentsRepository.findInvoiceByIdForPayment(payment.invoiceId);
    if (!invoice) {
      throw new ApiError(404, "Счёт не найден");
    }

    const effectivePaid = roundMoney(payment.amount - (payment.refundedAmount ?? 0));
    const newPaidAmount = roundMoney(invoice.paidAmount - effectivePaid);
    if (newPaidAmount < 0) {
      throw new ApiError(409, "Нельзя аннулировать платёж: итоговая сумма оплат станет недопустимой");
    }

    const nextStatus = deriveInvoiceStatusFromPayment(
      invoice.status,
      invoice.total,
      newPaidAmount
    );

    const result = await this.paymentsRepository.deletePaymentUpdateInvoiceWithOptionalCash({
      paymentId: id,
      voidReason: normalizedVoidReason,
      invoiceId: invoice.id,
      nextInvoiceStatus: nextStatus,
      invoicePaidAmountAfterDelete: newPaidAmount,
    });

    if (!result.deleted) {
      return false;
    }
    if (invoice.appointmentId) {
      await this.appointmentsRepository.updateBillingStatus(
        invoice.appointmentId,
        nextStatus === "paid" ? "paid" : "ready_for_payment"
      );
    }

    if (effectivePaid > 1e-9) {
      const activeShift = await this.cashRegisterRepository.findActiveShift();
      if (activeShift) {
        await this.cashRegisterRepository.createCashRegisterEntry({
          shiftId: activeShift.id,
          paymentId: id,
          type: "void",
          amount: roundMoney(-effectivePaid),
          method: payment.method,
          note: `Аннулирование платежа #${payment.id}`,
        });
      } else {
        console.warn(
          `[payments] Аннулирование платежа #${id}: активная смена не открыта, кассовая сторно-запись не создана`
        );
      }
    }

    invalidateClinicFactsCache();
    return true;
  }
}

