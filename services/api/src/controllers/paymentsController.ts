import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import {
  PAYMENT_METHODS,
  PaymentMethod,
} from "../repositories/paymentsRepository";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

const PAYMENT_METHOD_SET = new Set<string>(PAYMENT_METHODS);

const parsePositiveQueryId = (
  value: unknown,
  fieldName: string
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, `Query param '${fieldName}' must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `Query param '${fieldName}' must be a positive integer`);
  }

  return parsed;
};

export const listPaymentsController = async (req: Request, res: Response) => {
  const invoiceId = parsePositiveQueryId(req.query.invoiceId, "invoiceId");
  const rawMethod = typeof req.query.method === "string" ? req.query.method : undefined;
  if (rawMethod !== undefined && !PAYMENT_METHOD_SET.has(rawMethod)) {
    throw new ApiError(
      400,
      `Query param 'method' must be one of: ${PAYMENT_METHODS.join(", ")}`
    );
  }
  const method = rawMethod as PaymentMethod | undefined;

  const auth = getAuthPayload(req);
  const payments = await services.payments.list(auth, {
    invoiceId,
    method,
  });
  return res.status(200).json(payments);
};

export const getPaymentByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const payment = await services.payments.getById(auth, id);

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  return res.status(200).json(payment);
};

export const createPaymentController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const rawClinicId = req.clinicId;
  if (rawClinicId === undefined || !Number.isInteger(rawClinicId) || rawClinicId <= 0) {
    throw new ApiError(401, "Clinic context is missing");
  }
  const clinicId: number = rawClinicId;
  const created = await services.payments.create(auth, req.body, clinicId);
  return res.status(201).json(created);
};

export const deletePaymentController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const voidReason =
    typeof req.body?.voidReason === "string" ? req.body.voidReason : undefined;
  const deleted = await services.payments.delete(auth, id, voidReason);

  if (!deleted) {
    throw new ApiError(404, "Платёж не найден");
  }

  return res.status(200).json({
    success: true,
    deleted: true,
    id,
  });
};

export const refundPaymentController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason : "";
  const rawAmount = req.body?.amount;
  const parsedAmount =
    rawAmount !== undefined && rawAmount !== null && rawAmount !== ""
      ? Number(rawAmount)
      : undefined;
  await services.payments.refund(auth, id, {
    reason,
    amount: parsedAmount !== undefined && Number.isFinite(parsedAmount) ? parsedAmount : undefined,
  });
  return res.status(200).json({ success: true, id });
};

