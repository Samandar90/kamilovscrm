import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import { dbPool } from "../config/database";
import { env } from "../config/env";
import { requireClinicId } from "../tenancy/clinicContext";

type SubRow = {
  subscription_status: string;
  subscription_ends_at: Date | string | null;
};

/**
 * Гейт активной подписки. Вешается на дата-роуты ПОСЛЕ requireAuth
 * (нужен clinic-контекст). Блокирует (402) только при явном
 * suspended / expired / истёкшей дате окончания.
 *
 * Fail-open: при ошибке запроса или отсутствии записи — пропускаем,
 * чтобы баг гейта или транзиентный сбой не отрезали доступ платящим клиникам.
 * Лучше на короткое время пропустить лишнего, чем заблокировать живую клинику.
 */
export const requireActiveSubscription = async (
  _req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  // В mock-режиме (локальная разработка) подписок нет — пропускаем.
  if (env.dataProvider !== "postgres") {
    next();
    return;
  }

  const clinicId = requireClinicId();

  let row: SubRow | undefined;
  try {
    const result = await dbPool.query<SubRow>(
      `SELECT subscription_status, subscription_ends_at FROM clinics WHERE id = $1 LIMIT 1`,
      [clinicId]
    );
    row = result.rows[0];
  } catch {
    // Fail-open: не блокируем из-за сбоя самой проверки.
    next();
    return;
  }

  // Запись не найдена — не дело гейта решать; пропускаем.
  if (!row) {
    next();
    return;
  }

  if (row.subscription_status === "suspended") {
    throw new ApiError(402, "Подписка приостановлена. Обратитесь к администратору.");
  }

  const endsAtMs = row.subscription_ends_at
    ? new Date(row.subscription_ends_at).getTime()
    : null;
  const expiredByDate =
    endsAtMs != null && Number.isFinite(endsAtMs) && Date.now() > endsAtMs;

  if (row.subscription_status === "expired" || expiredByDate) {
    throw new ApiError(402, "Срок подписки истёк. Продлите подписку, чтобы продолжить работу.");
  }

  next();
};
