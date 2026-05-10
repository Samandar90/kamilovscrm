import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../middleware/errorHandler";
import { APPOINTMENT_STATUSES } from "../repositories/appointmentsRepository";
import { parseLocalDateTime } from "../utils/localDateTime";
import { tryParseAppointmentTimestampForDb } from "../utils/appointmentTimestamps";
import { parseNumericInput } from "../utils/numbers";
import { getAuthPayload } from "../utils/requestAuth";

const APPOINTMENT_STATUS_SET = new Set<string>(APPOINTMENT_STATUSES);
const MAX_NOTES_LENGTH = 2000;
const MAX_DIAGNOSIS_LENGTH = 1000;
const MAX_TREATMENT_LENGTH = 2000;
const MAX_CANCEL_REASON_LENGTH = 1000;

const parsePositiveInteger = (value: unknown): number | null => {
  const n = parseNumericInput(value);
  if (n === null) return null;
  const t = Math.trunc(n);
  if (t <= 0 || t !== n) return null;
  return t;
};

const isValidDateTime = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  return tryParseAppointmentTimestampForDb(value) !== null;
};

const ensureDateRangeIsValid = (startAt: string, endAt: string): void => {
  const start = parseLocalDateTime(startAt);
  const end = parseLocalDateTime(endAt);
  if (!start || !end) {
    throw new ApiError(400, "Fields 'startAt' and 'endAt' must be in format YYYY-MM-DD HH:mm:ss");
  }

  if (end.getTime() <= start.getTime()) {
    throw new ApiError(400, "Field 'endAt' must be greater than 'startAt'");
  }
};

const validateOptionalNotes = (notes: unknown): void => {
  if (notes === undefined || notes === null) {
    return;
  }

  if (typeof notes !== "string") {
    throw new ApiError(400, "Field 'notes' must be a string or null");
  }

  if (notes.trim().length > MAX_NOTES_LENGTH) {
    throw new ApiError(400, `Field 'notes' must be at most ${MAX_NOTES_LENGTH} characters`);
  }
};

const validateOptionalCancelReason = (cancelReason: unknown): void => {
  if (cancelReason === undefined || cancelReason === null) {
    return;
  }

  if (typeof cancelReason !== "string") {
    throw new ApiError(400, "Field 'cancelReason' must be a string or null");
  }

  if (cancelReason.trim().length > MAX_CANCEL_REASON_LENGTH) {
    throw new ApiError(400, `Field 'cancelReason' must be at most ${MAX_CANCEL_REASON_LENGTH} characters`);
  }
};

const validateOptionalDiagnosis = (diagnosis: unknown): void => {
  if (diagnosis === undefined || diagnosis === null) {
    return;
  }

  if (typeof diagnosis !== "string") {
    throw new ApiError(400, "Field 'diagnosis' must be a string or null");
  }

  if (diagnosis.trim().length > MAX_DIAGNOSIS_LENGTH) {
    throw new ApiError(
      400,
      `Field 'diagnosis' must be at most ${MAX_DIAGNOSIS_LENGTH} characters`
    );
  }
};

const validateOptionalTreatment = (treatment: unknown): void => {
  if (treatment === undefined || treatment === null) {
    return;
  }

  if (typeof treatment !== "string") {
    throw new ApiError(400, "Field 'treatment' must be a string or null");
  }

  if (treatment.trim().length > MAX_TREATMENT_LENGTH) {
    throw new ApiError(
      400,
      `Field 'treatment' must be at most ${MAX_TREATMENT_LENGTH} characters`
    );
  }
};

const validateStatus = (status: unknown): void => {
  if (typeof status !== "string" || !APPOINTMENT_STATUS_SET.has(status)) {
    throw new ApiError(
      400,
      `Field 'status' must be one of: ${APPOINTMENT_STATUSES.join(", ")}`
    );
  }
};

const validateOptionalPrice = (price: unknown): void => {
  if (price === undefined || price === null) {
    return;
  }
  const parsed = parseNumericInput(price);
  if (parsed === null || parsed < 0) {
    throw new ApiError(400, "Поле «цена» должно быть неотрицательным числом");
  }
};

export const validateAppointmentIdParam = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const parsedId = parsePositiveInteger(req.params.id);
  if (!parsedId) {
    throw new ApiError(400, "Path param 'id' must be a positive integer");
  }

  next();
};

export const validateCreateAppointment = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const auth = getAuthPayload(req);
  const {
    patientId,
    doctorId,
    serviceId,
    startAt,
    endAt,
    status,
    diagnosis,
    treatment,
    notes,
    price,
  } = req.body ?? {};

  if (!parsePositiveInteger(patientId)) {
    throw new ApiError(400, "Field 'patientId' must be a positive integer");
  }

  if (auth.role === "doctor") {
    if (doctorId !== undefined && doctorId !== null && String(doctorId).trim() !== "") {
      const parsed = parsePositiveInteger(doctorId);
      if (!parsed || parsed !== auth.doctorId) {
        throw new ApiError(403, "Cannot set doctorId for this account");
      }
    }
    delete (req.body as Record<string, unknown>).doctorId;
    delete (req.body as Record<string, unknown>).clinicId;
    delete (req.body as Record<string, unknown>).clinic_id;
  } else if (!parsePositiveInteger(doctorId)) {
    throw new ApiError(400, "Field 'doctorId' must be a positive integer");
  }

  if (!parsePositiveInteger(serviceId)) {
    throw new ApiError(400, "Field 'serviceId' must be a positive integer");
  }

  if (!isValidDateTime(startAt)) {
    throw new ApiError(400, "Field 'startAt' must be in format YYYY-MM-DD HH:mm:ss");
  }

  if (endAt !== undefined) {
    throw new ApiError(
      400,
      "Field 'endAt' is calculated automatically from service duration"
    );
  }
  validateStatus(status);
  validateOptionalDiagnosis(diagnosis);
  validateOptionalTreatment(treatment);
  validateOptionalNotes(notes);
  validateOptionalPrice(price);

  next();
};

export const validateUpdateAppointment = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const {
    patientId,
    doctorId,
    serviceId,
    startAt,
    endAt,
    status,
    diagnosis,
    treatment,
    notes,
  } = req.body ?? {};

  if (patientId !== undefined && !parsePositiveInteger(patientId)) {
    throw new ApiError(400, "Field 'patientId' must be a positive integer");
  }

  if (doctorId !== undefined && !parsePositiveInteger(doctorId)) {
    throw new ApiError(400, "Field 'doctorId' must be a positive integer");
  }

  if (serviceId !== undefined && !parsePositiveInteger(serviceId)) {
    throw new ApiError(400, "Field 'serviceId' must be a positive integer");
  }

  if (startAt !== undefined && !isValidDateTime(startAt)) {
    throw new ApiError(400, "Field 'startAt' must be in format YYYY-MM-DD HH:mm:ss");
  }

  if (endAt !== undefined) {
    throw new ApiError(
      400,
      "Field 'endAt' is calculated automatically from service duration"
    );
  }

  if (status !== undefined) {
    validateStatus(status);
  }

  validateOptionalDiagnosis(diagnosis);
  validateOptionalTreatment(treatment);
  validateOptionalNotes(notes);

  next();
};

export const validateCancelAppointment = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const { reason, cancelReason, ...rest } = req.body ?? {};

  if (Object.keys(rest).length > 0) {
    throw new ApiError(400, "Only field 'reason' is allowed");
  }

  if (reason !== undefined && cancelReason !== undefined) {
    throw new ApiError(400, "Use only one field: 'reason'");
  }

  validateOptionalCancelReason(reason ?? cancelReason);
  next();
};

export const validateUpdateAppointmentPrice = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const { price, ...rest } = req.body ?? {};
  if (Object.keys(rest).length > 0) {
    throw new ApiError(400, "Only field 'price' is allowed");
  }
  if (price === undefined) {
    throw new ApiError(400, "Field 'price' is required");
  }
  validateOptionalPrice(price);
  next();
};
