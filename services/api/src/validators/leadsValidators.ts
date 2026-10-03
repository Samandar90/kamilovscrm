import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import { LEAD_STAGES, type LeadStage, type LeadsListFilters, type MyLeadsFilters } from "../repositories/interfaces/leadTypes";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** A positive safe integer from a query or path string, or from a JSON number. The message never repeats the value. */
const positiveInt = (value: unknown, field: string): number => {
  const parsed = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `Поле '${field}' должно быть положительным целым числом`);
  }
  return parsed;
};

const queryOf = (query: unknown): Record<string, unknown> =>
  query && typeof query === "object" ? (query as Record<string, unknown>) : {};

const optionalId = (value: unknown, field: string): number | null =>
  value === undefined || value === "" ? null : positiveInt(value, field);

/** `?limit=`: absent → 50; above 200 → 200 (clamped, not refused). */
const pageSize = (value: unknown): number =>
  value === undefined || value === ""
    ? DEFAULT_PAGE_SIZE
    : Math.min(positiveInt(value, "limit"), MAX_PAGE_SIZE);

const optionalStage = (value: unknown): LeadStage | null => {
  if (value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !(LEAD_STAGES as readonly string[]).includes(value)) {
    throw new ApiError(400, "Неизвестный статус лида в фильтре");
  }
  return value as LeadStage;
};

/** Query of GET /api/leads: `stage?`, `sourceId?`, `beforeId?`, `limit?`. */
export const parseLeadsListQuery = (query: unknown): LeadsListFilters => {
  const q = queryOf(query);
  return {
    stage: optionalStage(q.stage),
    sourceId: optionalId(q.sourceId, "sourceId"),
    beforeId: optionalId(q.beforeId, "beforeId"),
    limit: pageSize(q.limit),
  };
};

/** Query of GET /api/leads/mine: `beforeId?`, `limit?`. A source or a clinic cannot be asked for. */
export const parseMyLeadsQuery = (query: unknown): MyLeadsFilters => {
  const q = queryOf(query);
  return { beforeId: optionalId(q.beforeId, "beforeId"), limit: pageSize(q.limit) };
};

/** `:id` route param of /api/leads/:id/* (lead id) and /api/leads/sources/:id/* (source id). */
export const validateLeadIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  positiveInt(req.params.id, "id");
  next();
};
