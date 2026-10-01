import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parsePercent = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const validateServiceIds = (value: unknown): void => {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "Field 'serviceIds' must be an array of positive integers");
  }
  const unique = new Set<number>();
  for (const item of value) {
    const parsed = parsePositiveInteger(item);
    if (!parsed) {
      throw new ApiError(400, "Field 'serviceIds' must be an array of positive integers");
    }
    unique.add(parsed);
  }
  if (unique.size !== value.length) {
    throw new ApiError(400, "Field 'serviceIds' must not contain duplicates");
  }
};

/** Maps API aliases to canonical fields (mutates body). */
const normalizeDoctorPayload = (body: Record<string, unknown>): void => {
  if (body.fullName != null && body.name == null) {
    body.name = body.fullName;
  }
  if (body.specialty != null && body.speciality == null) {
    body.speciality = body.specialty;
  }
  if (body.percent !== undefined) {
    const p = parsePercent(body.percent);
    if (p !== null) {
      body.percent = p;
    }
  }
  if (body.birthDate != null && body.birth_date == null) {
    body.birth_date = body.birthDate;
  }
  // `!== undefined` (not `!= null`) so that `queue_prefix: null` can clear the letter too.
  if (body.queue_prefix !== undefined && body.queuePrefix === undefined) {
    body.queuePrefix = body.queue_prefix;
  }
};

const ROOM_ERROR = "Field 'room' must be a string up to 20 characters";
const QUEUE_PREFIX_ERROR = "Field 'queuePrefix' must be a single letter";

/** undefined → not sent; null / blank → null; otherwise the trimmed room, at most 20 characters (code points, like char_length). */
const parseOptionalRoom = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, ROOM_ERROR);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if ([...trimmed].length > 20) throw new ApiError(400, ROOM_ERROR);
  return trimmed;
};

/** undefined → not sent; null / blank → null; otherwise exactly one letter, upper-cased. */
const parseOptionalQueuePrefix = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, QUEUE_PREFIX_ERROR);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\p{L}$/u.test(trimmed)) throw new ApiError(400, QUEUE_PREFIX_ERROR);
  const upper = trimmed.toUpperCase();
  // A few letters upper-case to two ("ß" → "SS"); keep the original so the DB CHECK (one character) holds.
  return [...upper].length === 1 ? upper : trimmed;
};

const parseOptionalPhone = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const parseOptionalBirthDate = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
};

export const validateDoctorIdParam = (req: Request, _res: Response, next: NextFunction) => {
  if (!parsePositiveInteger(req.params.id)) {
    throw new ApiError(400, "Path param 'id' must be a positive integer");
  }
  next();
};

export const validateCreateDoctor = (req: Request, _res: Response, next: NextFunction) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  normalizeDoctorPayload(body);
  req.body = body;

  const { name, speciality, percent, active, serviceIds, phone, birth_date } = body;

  if (typeof name !== "string" || name.trim() === "") {
    throw new ApiError(
      400,
      "Field 'name' (or 'fullName') is required and must be a non-empty string"
    );
  }

  if (typeof speciality !== "string" || speciality.trim() === "") {
    throw new ApiError(
      400,
      "Field 'speciality' (or 'specialty') is required and must be a non-empty string"
    );
  }

  const pct = parsePercent(percent);
  if (pct === null || pct < 0 || pct > 100) {
    throw new ApiError(400, "Field 'percent' must be a number from 0 to 100");
  }
  body.percent = pct;

  if (typeof active !== "boolean") {
    throw new ApiError(400, "Field 'active' must be a boolean");
  }

  const normalizedPhone = parseOptionalPhone(phone);
  if (normalizedPhone === undefined) {
    throw new ApiError(400, "Field 'phone' must be a string, null or empty");
  }
  body.phone = normalizedPhone;

  const normalizedBirthDate = parseOptionalBirthDate(birth_date);
  if (normalizedBirthDate === undefined) {
    throw new ApiError(400, "Field 'birth_date' must be YYYY-MM-DD, null or empty");
  }
  body.birth_date = normalizedBirthDate;

  const normalizedRoom = parseOptionalRoom(body.room);
  if (normalizedRoom !== undefined) body.room = normalizedRoom;
  const normalizedQueuePrefix = parseOptionalQueuePrefix(body.queuePrefix);
  if (normalizedQueuePrefix !== undefined) body.queuePrefix = normalizedQueuePrefix;

  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  next();
};

export const validateUpdateDoctor = (req: Request, _res: Response, next: NextFunction) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  normalizeDoctorPayload(body);
  req.body = body;

  const { name, fullName, speciality, specialty, percent, active, serviceIds, phone, birth_date, room, queuePrefix } =
    body;

  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    throw new ApiError(400, "Field 'name' must be a non-empty string");
  }
  if (fullName !== undefined && (typeof fullName !== "string" || fullName.trim() === "")) {
    throw new ApiError(400, "Field 'fullName' must be a non-empty string");
  }

  if (speciality !== undefined && (typeof speciality !== "string" || speciality.trim() === "")) {
    throw new ApiError(400, "Field 'speciality' must be a non-empty string");
  }
  if (specialty !== undefined && (typeof specialty !== "string" || specialty.trim() === "")) {
    throw new ApiError(400, "Field 'specialty' must be a non-empty string");
  }

  if (percent !== undefined) {
    const pct = parsePercent(percent);
    if (pct === null || pct < 0 || pct > 100) {
      throw new ApiError(400, "Field 'percent' must be a number from 0 to 100");
    }
    body.percent = pct;
  }

  if (active !== undefined && typeof active !== "boolean") {
    throw new ApiError(400, "Field 'active' must be a boolean");
  }

  if (phone !== undefined) {
    const normalizedPhone = parseOptionalPhone(phone);
    if (normalizedPhone === undefined) {
      throw new ApiError(400, "Field 'phone' must be a string, null or empty");
    }
    body.phone = normalizedPhone;
  }

  if (birth_date !== undefined) {
    const normalizedBirthDate = parseOptionalBirthDate(birth_date);
    if (normalizedBirthDate === undefined) {
      throw new ApiError(400, "Field 'birth_date' must be YYYY-MM-DD, null or empty");
    }
    body.birth_date = normalizedBirthDate;
  }

  if (room !== undefined) {
    body.room = parseOptionalRoom(room);
  }

  if (queuePrefix !== undefined) {
    body.queuePrefix = parseOptionalQueuePrefix(queuePrefix);
  }

  if (serviceIds !== undefined) {
    validateServiceIds(serviceIds);
  }

  const hasAnyField =
    name !== undefined ||
    fullName !== undefined ||
    speciality !== undefined ||
    specialty !== undefined ||
    percent !== undefined ||
    active !== undefined ||
    serviceIds !== undefined ||
    phone !== undefined ||
    birth_date !== undefined ||
    room !== undefined ||
    queuePrefix !== undefined;

  if (!hasAnyField) {
    throw new ApiError(400, "At least one field must be provided for update");
  }

  next();
};
