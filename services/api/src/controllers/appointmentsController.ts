import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import {
  APPOINTMENT_BILLING_STATUSES,
  APPOINTMENT_STATUSES,
  AppointmentBillingStatus,
  AppointmentStatus,
} from "../repositories/appointmentsRepository";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { parseRequiredMoney } from "../utils/numbers";
const APPOINTMENT_STATUS_SET = new Set<string>(APPOINTMENT_STATUSES);
const APPOINTMENT_BILLING_STATUS_SET = new Set<string>(APPOINTMENT_BILLING_STATUSES);

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

const MAX_AVAILABILITY_SERVICES = 30;

/** `serviceIds=3,5` (all services of the visit) or the legacy single `serviceId=3`. */
const parseAvailabilityServiceIds = (req: Request): number[] => {
  const raw = req.query.serviceIds;
  if (raw === undefined) {
    const serviceId = parsePositiveQueryId(req.query.serviceId, "serviceId");
    if (serviceId === undefined) {
      throw new ApiError(400, "Query param 'serviceIds' is required");
    }
    return [serviceId];
  }
  const ids = typeof raw === "string" && raw.trim() !== "" ? raw.split(",").map((part) => Number(part.trim())) : [];
  if (
    ids.length === 0 ||
    ids.length > MAX_AVAILABILITY_SERVICES ||
    ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    throw new ApiError(400, "Query param 'serviceIds' must be a comma-separated list of positive integers");
  }
  return ids;
};

export const checkAvailabilityController = async (
  req: Request,
  res: Response
) => {
  const doctorId = parsePositiveQueryId(req.query.doctorId, "doctorId");
  const serviceIds = parseAvailabilityServiceIds(req);
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  const timeRaw = typeof req.query.time === "string" ? req.query.time.trim() : "";

  if (doctorId === undefined) {
    throw new ApiError(400, "Query param 'doctorId' is required");
  }
  if (!date || !timeRaw) {
    throw new ApiError(400, "Query params 'date' and 'time' are required");
  }

  const auth = getAuthPayload(req);
  const result = await services.appointments.checkAvailability(auth, {
    doctorId,
    serviceIds,
    date,
    time: timeRaw,
  });

  return res.status(200).json(result);
};

export const listAppointmentsController = async (
  req: Request,
  res: Response
) => {
  const patientId = parsePositiveQueryId(req.query.patientId, "patientId");
  const doctorId = parsePositiveQueryId(req.query.doctorId, "doctorId");
  const serviceId = parsePositiveQueryId(req.query.serviceId, "serviceId");
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  if (rawStatus !== undefined && !APPOINTMENT_STATUS_SET.has(rawStatus)) {
    throw new ApiError(
      400,
      `Query param 'status' must be one of: ${APPOINTMENT_STATUSES.join(", ")}`
    );
  }
  const status = rawStatus as AppointmentStatus | undefined;
  const rawBillingStatus =
    typeof req.query.billing_status === "string" ? req.query.billing_status : undefined;
  if (
    rawBillingStatus !== undefined &&
    !APPOINTMENT_BILLING_STATUS_SET.has(rawBillingStatus)
  ) {
    throw new ApiError(
      400,
      `Query param 'billing_status' must be one of: ${APPOINTMENT_BILLING_STATUSES.join(", ")}`
    );
  }
  const billingStatus = rawBillingStatus as AppointmentBillingStatus | undefined;
  const startFromRaw =
    typeof req.query.startFrom === "string" ? req.query.startFrom.trim() : undefined;
  const startToRaw =
    typeof req.query.startTo === "string" ? req.query.startTo.trim() : undefined;
  const endToRaw =
    typeof req.query.endTo === "string" ? req.query.endTo.trim() : undefined;
  const startFrom = startFromRaw === "" ? undefined : startFromRaw;
  const startTo = startToRaw === "" ? undefined : startToRaw;
  const endTo = endToRaw === "" ? undefined : endToRaw;
  const limit = parsePositiveQueryId(req.query.limit, "limit");

  const auth = getAuthPayload(req);
  const appointments = await services.appointments.list(auth, {
    patientId,
    doctorId,
    serviceId,
    status,
    billingStatus,
    startFrom,
    startTo,
    endTo,
    limit,
  });

  return res.status(200).json(appointments);
};

export const getAppointmentByIdController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const appointment = await services.appointments.getById(auth, id);

  if (!appointment) {
    throw new ApiError(404, "Appointment not found");
  }

  return res.status(200).json(appointment);
};

export const createAppointmentController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const created = await services.appointments.create(auth, req.body);
  return res.status(201).json(created);
};

export const updateAppointmentController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const updated = await services.appointments.update(auth, id, req.body);

  if (!updated) {
    throw new ApiError(404, "Appointment not found");
  }

  return res.status(200).json(updated);
};

export const cancelAppointmentController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const reason =
    typeof req.body?.reason === "string"
      ? req.body.reason
      : typeof req.body?.cancelReason === "string"
        ? req.body.cancelReason
        : undefined;
  const updated = await services.appointments.cancel(auth, id, reason);

  if (!updated) {
    throw new ApiError(404, "Appointment not found");
  }

  return res.status(200).json(updated);
};

export const updateAppointmentPriceController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const price = Math.round(parseRequiredMoney(req.body?.price, "price"));
  const updated = await services.appointments.updatePrice(auth, id, price);

  if (!updated) {
    throw new ApiError(404, "Appointment not found");
  }

  return res.status(200).json(updated);
};

export const listAppointmentServicesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const assignments = await services.appointments.listAssignedServices(auth, id);
  return res.status(200).json(
    assignments.map((row) => ({
      id: row.id,
      appointmentId: row.appointmentId,
      serviceId: row.serviceId,
      price: row.price,
      quantity: row.quantity,
      createdAt: row.createdAt,
    }))
  );
};

export const replaceAppointmentServicesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const updated = await services.appointments.replaceServices(
    auth,
    Number(req.params.id),
    req.body.services
  );
  return res.status(200).json(updated);
};

export const completeAppointmentController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  const updated = await services.appointments.update(auth, id, {
    status: "completed",
    diagnosis: req.body?.diagnosis,
    treatment: req.body?.treatment,
    recommendedReturnDate: req.body?.recommendedReturnDate,
    notes: req.body?.notes,
  });
  if (!updated) {
    throw new ApiError(404, "Appointment not found");
  }
  return res.status(200).json(updated);
};

export const deleteAppointmentController = async (
  req: Request,
  res: Response
) => {
  const auth = getAuthPayload(req);
  if (auth.role !== "superadmin") {
    throw new ApiError(403, "Только superadmin может полностью удалять записи");
  }
  const id = Number(req.params.id);
  const deleted = await services.appointments.delete(auth, id);

  if (!deleted) {
    throw new ApiError(404, "Appointment not found");
  }

  // Project API style returns JSON bodies for delete actions.
  return res.status(200).json({
    success: true,
    deleted: true,
    id,
  });
};

