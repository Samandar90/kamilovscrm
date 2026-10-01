import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";
import { dbPool } from "../config/database";
import { env } from "../config/env";
import { requireClinicId } from "../tenancy/clinicContext";

export type SubscriptionFields = {
  subscription_status: string | null;
  subscription_ends_at: Date | string | null;
};

/**
 * Почему клиника заблокирована: "suspended" | "expired", null — подписка активна.
 * Единое правило для гейта дата-роутов и публичного ТВ-экрана очереди:
 * suspended важнее всего; expired — явный статус или дата окончания в прошлом.
 * Нераспознаваемая дата окончания игнорируется (как раньше).
 */
export function getSubscriptionBlock(row: SubscriptionFields, nowMs: number): "suspended" | "expired" | null {
  if (row.subscription_status === "suspended") {
    return "suspended";
  }
  const endsAtMs = row.subscription_ends_at
    ? new Date(row.subscription_ends_at).getTime()
    : null;
  const expiredByDate = endsAtMs != null && Number.isFinite(endsAtMs) && nowMs > endsAtMs;
  if (row.subscription_status === "expired" || expiredByDate) {
    return "expired";
  }
  return null;
}

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

  let row: SubscriptionFields | undefined;
  try {
    const result = await dbPool.query<SubscriptionFields>(
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

  const block = getSubscriptionBlock(row, Date.now());
  if (block === "suspended") {
    throw new ApiError(402, "Подписка приостановлена. Обратитесь к администратору.");
  }
  if (block === "expired") {
    throw new ApiError(402, "Срок подписки истёк. Продлите подписку, чтобы продолжить работу.");
  }

  next();
};
