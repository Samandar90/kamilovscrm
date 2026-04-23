import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import {
  INVOICE_STATUSES,
  InvoiceStatus,
} from "../repositories/invoicesRepository";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

const INVOICE_STATUS_SET = new Set<string>(INVOICE_STATUSES);

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

export const listInvoicesController = async (req: Request, res: Response) => {
  const patientId = parsePositiveQueryId(req.query.patientId, "patientId");
  const appointmentId = parsePositiveQueryId(req.query.appointmentId, "appointmentId");
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  if (rawStatus !== undefined && !INVOICE_STATUS_SET.has(rawStatus)) {
    throw new ApiError(
      400,
      `Query param 'status' must be one of: ${INVOICE_STATUSES.join(", ")}`
    );
  }
  const status = rawStatus as InvoiceStatus | undefined;

  const auth = getAuthPayload(req);
  const invoices = await services.invoices.list(auth, {
    patientId,
    appointmentId,
    status,
  });
  return res.status(200).json(invoices);
};

export const getInvoiceByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const invoice = await services.invoices.getById(auth, id);

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  return res.status(200).json(invoice);
};

export const createInvoiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const created = await services.invoices.create(auth, req.body);
  return res.status(201).json(created);
};

export const createInvoiceFromAppointmentController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const appointmentId = Number(req.body?.appointment_id ?? req.body?.appointmentId);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    throw new ApiError(400, "Field 'appointment_id' must be a positive integer");
  }
  const created = await services.invoices.createFromAppointment(auth, appointmentId);
  return res.status(201).json(created);
};

export const updateInvoiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const updated = await services.invoices.update(auth, id, req.body);

  if (!updated) {
    throw new ApiError(404, "Invoice not found");
  }

  return res.status(200).json(updated);
};

export const deleteInvoiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const deleted = await services.invoices.delete(auth, id);

  if (!deleted) {
    throw new ApiError(404, "Invoice not found");
  }

  return res.status(200).json({
    success: true,
    deleted: true,
    id,
  });
};

