import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../middleware/errorHandler";
import { getAuthPayload } from "../utils/requestAuth";

const allowedGenders = new Set(["male", "female"]);
const PATIENT_SOURCES = new Set([
  "instagram",
  "telegram",
  "advertising",
  "referral",
  "other",
  "doctor",
  "reception",
]);
const MAX_FULL_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 32;
const MAX_NOTES_LENGTH = 2000;
const PHONE_ALLOWED_CHARS_RE = /^[+()\-\s\d]+$/;

const isValidPhone = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_PHONE_LENGTH) return false;
  if (!PHONE_ALLOWED_CHARS_RE.test(trimmed)) return false;
  if ((trimmed.match(/\+/g) ?? []).length > 1) return false;
  if (trimmed.includes("+") && !trimmed.startsWith("+")) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
};

const isOptionalPhoneValid = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  return isValidPhone(value);
};

const validateDateString = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Strict calendar validation (e.g. 2026-02-30 is invalid)
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
};

export const validateCreatePatient = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.birthDate === "") {
    body.birthDate = null;
  }
  try {
    const auth = getAuthPayload(req);
    if (auth.role === "doctor") {
      delete body.clinicId;
      delete body.clinic_id;
      delete body.doctorId;
      delete body.createdByDoctorId;
      delete body.created_by_doctor_id;
      delete body.createdByUserId;
      delete body.created_by_user_id;
      delete body.source;
    }
    if (auth.role === "nurse") {
      delete body.clinicId;
      delete body.clinic_id;
      delete body.doctorId;
      delete body.createdByDoctorId;
      delete body.created_by_doctor_id;
      delete body.createdByUserId;
      delete body.created_by_user_id;
      delete body.source;
    }
  } catch {
    /* requireAuth runs before validator — если нет auth, следующий слой вернёт 401 */
  }
  req.body = body;
  const { fullName, phone, birthDate, gender, source, notes } = body;

  if (!fullName || typeof fullName !== "string" || fullName.trim() === "") {
    throw new ApiError(400, "Field 'fullName' is required and must be a non-empty string");
  }

  if (fullName.trim().length > MAX_FULL_NAME_LENGTH) {
    throw new ApiError(
      400,
      `Field 'fullName' must be at most ${MAX_FULL_NAME_LENGTH} characters`
    );
  }

  if (!isOptionalPhoneValid(phone)) {
    throw new ApiError(
      400,
      "Field 'phone' must be a valid phone number (10-15 digits, optional leading +), null, or undefined"
    );
  }

  if (!(birthDate === undefined || birthDate === null || validateDateString(birthDate))) {
    throw new ApiError(400, "Field 'birthDate' must be YYYY-MM-DD, null, or undefined");
  }

  if (
    !(
      gender === undefined ||
      gender === null ||
      (typeof gender === "string" && allowedGenders.has(gender))
    )
  ) {
    throw new ApiError(
      400,
      "Field 'gender' must be one of: male, female, null, or undefined"
    );
  }

  if (
    !(
      source === undefined ||
      source === null ||
      (typeof source === "string" && PATIENT_SOURCES.has(source))
    )
  ) {
    throw new ApiError(
      400,
      "Field 'source' must be one of: instagram, telegram, advertising, referral, other, doctor, reception, null, or undefined"
    );
  }

  if (!(notes === undefined || notes === null || (typeof notes === "string" && notes.length <= MAX_NOTES_LENGTH))) {
    throw new ApiError(400, `Field 'notes' must be a string of at most ${MAX_NOTES_LENGTH} characters or null`);
  }

  next();
};

export const validateUpdatePatient = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.birthDate === "") {
    body.birthDate = null;
  }
  req.body = body;
  const { fullName, phone, birthDate, gender, source, notes } = body;

  if (
    fullName !== undefined &&
    (typeof fullName !== "string" || fullName.trim() === "")
  ) {
    throw new ApiError(400, "Field 'fullName' must be a non-empty string");
  }

  if (typeof fullName === "string" && fullName.trim().length > MAX_FULL_NAME_LENGTH) {
    throw new ApiError(
      400,
      `Field 'fullName' must be at most ${MAX_FULL_NAME_LENGTH} characters`
    );
  }

  if (!isOptionalPhoneValid(phone)) {
    throw new ApiError(
      400,
      "Field 'phone' must be a valid phone number (10-15 digits, optional leading +), null, or undefined"
    );
  }

  if (!(birthDate === undefined || birthDate === null || validateDateString(birthDate))) {
    throw new ApiError(400, "Field 'birthDate' must be YYYY-MM-DD, null, or undefined");
  }

  if (
    !(
      gender === undefined ||
      gender === null ||
      (typeof gender === "string" && allowedGenders.has(gender))
    )
  ) {
    throw new ApiError(
      400,
      "Field 'gender' must be one of: male, female, null, or undefined"
    );
  }

  if (
    !(
      source === undefined ||
      source === null ||
      (typeof source === "string" && PATIENT_SOURCES.has(source))
    )
  ) {
    throw new ApiError(
      400,
      "Field 'source' must be one of: instagram, telegram, advertising, referral, other, doctor, reception, null, or undefined"
    );
  }

  if (!(notes === undefined || notes === null || (typeof notes === "string" && notes.length <= MAX_NOTES_LENGTH))) {
    throw new ApiError(400, `Field 'notes' must be a string of at most ${MAX_NOTES_LENGTH} characters or null`);
  }

  if (
    fullName === undefined &&
    phone === undefined &&
    birthDate === undefined &&
    gender === undefined &&
    source === undefined &&
    notes === undefined
  ) {
    throw new ApiError(400, "At least one field must be provided for update");
  }

  next();
};

export const validatePatientIdParam = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const { id } = req.params;

  if (!id || typeof id !== "string") {
    throw new ApiError(400, "Path param 'id' is required");
  }

  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new ApiError(400, "Path param 'id' must be a positive integer");
  }

  next();
};

