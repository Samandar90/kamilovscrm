import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import { dbPool } from "../config/database";

/**
 * Гейт платформенного администратора (владельца SaaS).
 * Действует поверх всех клиник — НЕ привязан к clinic-контексту.
 * Проверяет users.is_platform_admin для текущего пользователя.
 */
export const requirePlatformAdmin = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.auth?.userId;
  if (!userId) {
    throw new ApiError(401, "Authorization required");
  }
  const result = await dbPool.query<{ is_platform_admin: boolean }>(
    `SELECT is_platform_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!result.rows[0]?.is_platform_admin) {
    throw new ApiError(403, "Доступ только для платформенного администратора");
  }
  next();
};
