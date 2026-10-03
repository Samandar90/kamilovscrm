import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import { verifyAccessToken } from "../utils/jwt";
import { runWithClinicContext } from "../tenancy/clinicContext";
import { EXTERNAL_ROLES } from "../auth/permissions";
import { dbPool } from "../config/database";
import { env } from "../config/env";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";

const isExternalRole = (role: string): boolean => (EXTERNAL_ROLES as readonly string[]).includes(role);

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new ApiError(401, "Authorization token is required");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "Authorization token is required");
  }

  try {
    const payload = verifyAccessToken(token);
    if (!Number.isInteger(payload.clinicId) || payload.clinicId <= 0) {
      throw new ApiError(401, "Invalid clinic context");
    }
    req.auth = payload;
    req.clinicId = payload.clinicId;
    req.user = {
      ...payload,
      nurse_doctor_id: payload.nurseDoctorId ?? null,
    };
  } catch (_error) {
    throw new ApiError(401, "Invalid or expired token");
  }

  // Внешний аккаунт (подрядчик) сверяется с базой при каждом запросе: отключение, удаление, смена роли
  // или клиники закрывают доступ сразу, а не через 8 часов жизни токена. Ошибка базы запрос не пропускает.
  // Токены сотрудников с базой не сверяются. res.locals — чтобы второй requireAuth на том же запросе
  // (в index.ts и внутри роутера) не читал базу повторно.
  const auth = req.auth as AuthTokenPayload;
  if (isExternalRole(auth.role) && env.dataProvider === "postgres" && res.locals.accountChecked !== true) {
    dbPool
      .query<{ role: string }>(
        `SELECT role FROM users
         WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, true) = true
         LIMIT 1`,
        [auth.userId, auth.clinicId]
      )
      .then((result) => {
        if (result.rows[0]?.role !== auth.role) {
          next(new ApiError(401, "Invalid or expired token"));
          return;
        }
        res.locals.accountChecked = true;
        runWithClinicContext(auth.clinicId, () => next());
      })
      .catch(next);
    return;
  }

  runWithClinicContext(req.clinicId as number, () => next());
};
