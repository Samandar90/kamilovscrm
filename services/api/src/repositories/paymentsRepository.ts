import type { IPaymentsRepository } from "./interfaces/IPaymentsRepository";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  type InvoiceForPayment,
  type InvoiceStatus,
  type Payment,
  type PaymentCreateAtomicExtras,
  type PaymentCreateInput,
  type PaymentDeleteWithInvoiceAndCashInput,
  type PaymentFilters,
  type PaymentMethod,
  type PaymentRefundApplyInput,
} from "./interfaces/billingTypes";
import { ApiError } from "../middleware/errorHandler";
import { getMockDb, nextId, type PaymentRecord } from "./mockDatabase";

export {
  PAYMENT_METHODS,
  type InvoiceForPayment,
  type InvoiceStatus,
  type Payment,
  type PaymentCreateInput,
  type PaymentDeleteWithInvoiceAndCashInput,
  type PaymentFilters,
  type PaymentMethod,
  type PaymentRefundApplyInput,
};

export class MockPaymentsRepository implements IPaymentsRepository {
  async findAll(filters: PaymentFilters = {}): Promise<Payment[]> {
    return getMockDb()
      .payments.filter((row) => {
        if (row.deletedAt) return false;
        if (filters.invoiceId !== undefined && row.invoiceId !== filters.invoiceId) return false;
        if (
          filters.method !== undefined &&
          normalizePaymentMethod(String(row.method)) !== filters.method
        ) {
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

  async findById(id: number): Promise<Payment | null> {
    const found = getMockDb().payments.find((row) => row.id === id && !row.deletedAt);
    return found
      ? { ...found, method: normalizePaymentMethod(String(found.method)) }
      : null;
  }

  async findByIdIncludingVoided(id: number): Promise<Payment | null> {
    const found = getMockDb().payments.find((row) => row.id === id);
    return found
      ? { ...found, method: normalizePaymentMethod(String(found.method)) }
      : null;
  }

  async findActivePaymentByIdempotencyKey(
    userId: number,
    key: string
  ): Promise<Payment | null> {
    const row = getMockDb().payments.find(
      (p) =>
        p.createdBy === userId &&
        p.idempotencyKey === key &&
        p.idempotencyKeyClientSupplied &&
        !p.deletedAt
    );
    return row
      ? { ...row, method: normalizePaymentMethod(String(row.method)) }
      : null;
  }

  async create(input: PaymentCreateInput): Promise<Payment> {
    const now = new Date().toISOString();
    const created: PaymentRecord = {
      id: nextId(),
      clinicId: input.clinicId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      refundedAmount: 0,
      method: input.method,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      voidReason: null,
      idempotencyKey: input.idempotencyKey,
      idempotencyKeyClientSupplied: input.idempotencyKeyClientSupplied,
      createdBy: input.createdByUserId,
    };
    getMockDb().payments.push(created);
    return { ...created };
  }

  async createPaymentAndUpdateInvoice(
    input: PaymentCreateInput,
    nextInvoiceStatus: InvoiceStatus,
    atomicExtras?: PaymentCreateAtomicExtras
  ): Promise<Payment> {
    const roundMoney = (value: number): number =>
      Math.round((value + Number.EPSILON) * 100) / 100;

    if (input.idempotencyKeyClientSupplied) {
      const existing = await this.findActivePaymentByIdempotencyKey(
        input.createdByUserId,
        input.idempotencyKey
      );
      if (existing) {
        if (
          existing.invoiceId !== input.invoiceId ||
          Math.abs(existing.amount - input.amount) > 1e-9 ||
          existing.method !== input.method
        ) {
          throw new ApiError(
            409,
            "Ключ идемпотентности уже использован с другими параметрами"
          );
        }
        return existing;
      }
    }

    const inv = await this.findInvoiceByIdForPayment(input.invoiceId);
    if (!inv) {
      throw new ApiError(404, "Счёт не найден");
    }
    const paidSoFar = inv.paidAmount;
    const remaining = roundMoney(inv.total - paidSoFar);
    if (input.amount <= 0) {
      throw new ApiError(400, "Сумма оплаты должна быть больше нуля");
    }
    if (input.amount > remaining + 1e-6) {
      throw new ApiError(400, "Сумма оплаты больше остатка");
    }

    const payment = await this.create(input);

    if (!atomicExtras) {
      throw new ApiError(
        500,
        "Внутренняя ошибка: оплата счёта требует параметров кассовой операции"
      );
    }

    getMockDb().cashRegisterEntries.push({
      id: nextId(),
      clinicId: input.clinicId,
      shiftId: atomicExtras.shiftId,
      paymentId: payment.id,
      type: "payment",
      amount: atomicExtras.cashAmount,
      method: atomicExtras.cashMethod,
      note: atomicExtras.cashNote ?? null,
      createdAt: new Date().toISOString(),
    });
    if (
      atomicExtras.appointmentId != null &&
      atomicExtras.appointmentBillingStatus != null
    ) {
      const db = getMockDb();
      const aptIdx = db.appointments.findIndex((a) => a.id === atomicExtras.appointmentId);
      if (aptIdx < 0) {
        throw new ApiError(404, "Приём не найден");
      }
      db.appointments[aptIdx] = {
        ...db.appointments[aptIdx],
        billingStatus: atomicExtras.appointmentBillingStatus,
        updatedAt: new Date().toISOString(),
      };
    }

    const newPaid = roundMoney(paidSoFar + input.amount);
    await this.updateInvoicePaymentState(input.invoiceId, newPaid, nextInvoiceStatus);

    return payment;
  }

  async delete(id: number, voidReason: string | null): Promise<boolean> {
    const db = getMockDb();
    const idx = db.payments.findIndex((row) => row.id === id && !row.deletedAt);
    if (idx < 0) return false;
    db.payments[idx] = {
      ...db.payments[idx],
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      voidReason,
    };
    return true;
  }

  async deletePaymentUpdateInvoiceWithOptionalCash(
    input: PaymentDeleteWithInvoiceAndCashInput
  ): Promise<{ deleted: boolean }> {
    const deleted = await this.delete(input.paymentId, input.voidReason);
    if (!deleted) {
      return { deleted: false };
    }
    const updated = await this.updateInvoicePaymentState(
      input.invoiceId,
      input.invoicePaidAmountAfterDelete,
      input.nextInvoiceStatus
    );
    if (!updated) {
      throw new ApiError(404, "Счёт не найден");
    }
    return { deleted: true };
  }

  async findInvoiceByIdForPayment(id: number): Promise<InvoiceForPayment | null> {
    const found = getMockDb().invoices.find((row) => row.id === id && !row.deletedAt);
    if (!found) return null;
    return {
      id: found.id,
      appointmentId: found.appointmentId,
      status: found.status,
      total: found.total,
      paidAmount: found.paidAmount,
    };
  }

  async updateInvoicePaymentState(
    invoiceId: number,
    paidAmount: number,
    status: InvoiceStatus
  ): Promise<boolean> {
    const db = getMockDb();
    const idx = db.invoices.findIndex((row) => row.id === invoiceId && !row.deletedAt);
    if (idx < 0) return false;
    db.invoices[idx] = {
      ...db.invoices[idx],
      paidAmount,
      status,
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  async applyRefund(input: PaymentRefundApplyInput): Promise<{ cashWrittenInRepo: boolean }> {
    const roundMoney = (value: number): number =>
      Math.round((value + Number.EPSILON) * 100) / 100;

    const db = getMockDb();
    const payment = db.payments.find((p) => p.id === input.paymentId && !p.deletedAt);
    if (!payment) {
      throw new ApiError(404, "Платёж не найден");
    }

    const refunded = payment.refundedAmount ?? 0;
    const remaining = roundMoney(payment.amount - refunded);
    if (remaining <= 0) {
      throw new ApiError(409, "Платёж уже возвращён");
    }
    if (input.refundAmount > remaining + 1e-9) {
      throw new ApiError(400, "Некорректная сумма возврата");
    }

    const invoice = db.invoices.find((i) => i.id === input.invoiceId && !i.deletedAt);
    if (!invoice) {
      throw new ApiError(404, "Счёт не найден");
    }

    payment.refundedAmount = roundMoney(refunded + input.refundAmount);
    payment.updatedAt = new Date().toISOString();

    if (payment.refundedAmount + 1e-6 >= payment.amount) {
      payment.deletedAt = new Date().toISOString();
      payment.voidReason = input.reason;
    }

    const newPaid = roundMoney(invoice.paidAmount - input.refundAmount);
    invoice.paidAmount = newPaid;
    invoice.status = input.newInvoiceStatus;
    invoice.updatedAt = new Date().toISOString();

    return { cashWrittenInRepo: false };
  }
}

