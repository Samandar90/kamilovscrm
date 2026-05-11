import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

// Basic error shape for future domain errors
export class ApiError extends Error {
  public status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

type PostgresLikeError = {
  code?: string;
  detail?: string;
  column?: string;
  constraint?: string;
  where?: string;
};

const mapPostgresError = (err: PostgresLikeError): ApiError | null => {
  const detail = err.detail ? `: ${err.detail}` : "";
  const target = err.column ?? err.constraint ?? "field";

  if (err.constraint === "appointments_doctor_active_no_overlap") {
    return new ApiError(409, "У врача уже есть запись на это время");
  }
  if (err.constraint === "uq_cash_register_single_active_shift") {
    return new ApiError(409, "Смена уже открыта");
  }
  if (err.constraint === "uq_invoices_active_appointment") {
    return new ApiError(409, "An active invoice for this appointment already exists");
  }

  switch (err.code) {
    case "22P02":
      return new ApiError(
        400,
        env.isProduction
          ? "Некорректное числовое значение. Проверьте сумму или цену."
          : `Некорректный формат числа в базе данных${detail ? ` (${detail.trim()})` : ""}`
      );
    case "23505":
      return new ApiError(409, `Duplicate value violates unique constraint${detail}`);
    case "23503":
      return new ApiError(409, `Related record not found or blocked by foreign key${detail}`);
    case "23502":
      return new ApiError(400, `Required value is missing for '${target}'${detail}`);
    case "23P01":
      return new ApiError(409, `Conflicting record violates exclusion constraint${detail}`);
    default:
      return null;
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err && typeof err === "object") {
    const pg = err as PostgresLikeError & { message?: string; stack?: string };
    if (typeof pg.code === "string" && pg.code.length === 5) {
      // eslint-disable-next-line no-console
      console.error("RAW BACKEND ERROR:", {
        message: pg.message ?? (err instanceof Error ? err.message : undefined),
        code: pg.code,
        detail: pg.detail,
        where: pg.where,
        constraint: pg.constraint,
        stack: err instanceof Error ? err.stack : pg.stack,
      });
    }
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
    });
  }

  if (err && typeof err === "object") {
    const pgMappedError = mapPostgresError(err as PostgresLikeError);
    if (pgMappedError) {
      return res.status(pgMappedError.status).json({
        error: pgMappedError.message,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.error(env.isProduction ? "[500]" : err);

  return res.status(500).json({
    error: env.isProduction
      ? "Внутренняя ошибка сервера"
      : err instanceof Error
        ? err.message
        : "Internal server error",
  });
};

