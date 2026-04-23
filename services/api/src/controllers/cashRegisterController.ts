import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import {
  CASH_ENTRY_METHODS,
  CASH_ENTRY_TYPES,
  type CashEntryMethod,
  type CashEntryType,
} from "../repositories/cashRegisterRepository";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

const parseAllowedQueryValue = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined => {
  if (typeof value !== "string") return undefined;
  return allowed.includes(value as T) ? (value as T) : undefined;
};

const parsePositiveQueryShiftId = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "Параметр shiftId должен быть положительным целым числом");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "Параметр shiftId должен быть положительным целым числом");
  }
  return parsed;
};

export const listCashEntriesController = async (
  req: Request,
  res: Response
) => {
  const shiftId = parsePositiveQueryShiftId(req.query.shiftId);
  const type = parseAllowedQueryValue<CashEntryType>(
    req.query.type,
    CASH_ENTRY_TYPES
  );
  const method = parseAllowedQueryValue<CashEntryMethod>(
    req.query.method,
    CASH_ENTRY_METHODS
  );

  const dateFrom =
    typeof req.query.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom.trim())
      ? req.query.dateFrom.trim()
      : undefined;
  const dateTo =
    typeof req.query.dateTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo.trim())
      ? req.query.dateTo.trim()
      : undefined;

  const auth = getAuthPayload(req);
  const entries = await services.cashRegister.listEntries(auth, {
    shiftId,
    type,
    method,
    dateFrom,
    dateTo,
  });

  return res.status(200).json(entries);
};

export const openShiftController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const opened = await services.cashRegister.openShift(auth, req.body);
  return res.status(201).json(opened);
};

export const getActiveShiftController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const activeShift = await services.cashRegister.getActiveShift(auth);
  return res.status(200).json(activeShift);
};

export const closeShiftController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const shiftId = Number(req.params.id);
  const closed = await services.cashRegister.closeShift(auth, shiftId, req.body);
  return res.status(200).json(closed);
};

/** POST /shift/close — закрыть активную смену (без id в URL). */
export const closeCurrentShiftController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const active = await services.cashRegister.getActiveShift(auth);
  if (!active) {
    throw new ApiError(409, "Нет активной смены");
  }
  const closed = await services.cashRegister.closeShift(auth, active.id, req.body);
  return res.status(200).json(closed);
};

export const shiftHistoryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const history = await services.cashRegister.getShiftHistory(auth);
  return res.status(200).json(history);
};

export const getShiftByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const shiftId = Number(req.params.id);
  const shift = await services.cashRegister.getShiftById(auth, shiftId);
  return res.status(200).json(shift);
};

export const getCurrentShiftSummaryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const summary = await services.cashRegister.getCurrentShiftSummary(auth);
  return res.status(200).json(summary);
};

export const clearFinancialDataController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  await services.cashRegister.clearFinancialData(auth);
  return res.status(200).json({ success: true });
};

