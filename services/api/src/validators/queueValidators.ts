import type { NextFunction, Request, Response } from "express";
import { parsePositiveId } from "./questionnairesValidators";

/** `?doctorId=` of GET /api/queue/today: absent or empty → null, otherwise a positive integer (400 on garbage). */
export const parseQueueDoctorFilter = (query: unknown): number | null => {
  const raw = query && typeof query === "object" ? (query as Record<string, unknown>).doctorId : undefined;
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  return parsePositiveId(raw, "doctorId");
};

/** `:id` route param of the /appointments/:id/* routes (appointment id). */
export const validateQueueIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  parsePositiveId(req.params.id, "id");
  next();
};

/** `:doctorId` route param of POST /api/queue/doctors/:doctorId/call-next. */
export const validateQueueDoctorIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  parsePositiveId(req.params.doctorId, "doctorId");
  next();
};
