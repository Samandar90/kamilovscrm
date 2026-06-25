import type { Request, Response } from "express";
import { dbPool } from "../config/database";
import { ApiError } from "../middleware/errorHandler";

const toIso = (value: Date | string | null): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

type ClinicSubRow = {
  id: number | string;
  name: string;
  slug: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_ends_at: Date | string | null;
  created_at: Date | string | null;
  user_count: number | string;
};

const mapClinic = (row: ClinicSubRow) => ({
  id: Number(row.id),
  name: row.name,
  slug: row.slug,
  plan: row.subscription_plan,
  status: row.subscription_status,
  endsAt: toIso(row.subscription_ends_at),
  createdAt: toIso(row.created_at),
  userCount: Number(row.user_count),
});

const SELECT_CLINIC = `
  SELECT
    c.id, c.name, c.slug,
    c.subscription_plan, c.subscription_status, c.subscription_ends_at, c.created_at,
    (SELECT COUNT(*) FROM users u WHERE u.clinic_id = c.id AND u.deleted_at IS NULL) AS user_count
  FROM clinics c
`;

/** Лёгкий чек для фронта: показывать ли раздел «Платформа». Доступен любому авторизованному. */
export const platformAccessController = async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  let isPlatformAdmin = false;
  if (userId) {
    const r = await dbPool.query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    isPlatformAdmin = Boolean(r.rows[0]?.is_platform_admin);
  }
  return res.json({ isPlatformAdmin });
};

/** Список всех клиник со статусом подписки (только платформенный админ). */
export const listClinicsController = async (_req: Request, res: Response) => {
  const result = await dbPool.query<ClinicSubRow>(`${SELECT_CLINIC} ORDER BY c.id`);
  return res.json(result.rows.map(mapClinic));
};

type SubBody = { action?: string; months?: number };

/** Ручное управление подпиской клиники (продлить / приостановить / активировать / безлимит). */
export const updateClinicSubscriptionController = async (req: Request, res: Response) => {
  const clinicId = Number(req.params.id);
  if (!Number.isInteger(clinicId) || clinicId <= 0) {
    throw new ApiError(400, "invalid clinic id");
  }
  const body = (req.body ?? {}) as SubBody;
  const action = typeof body.action === "string" ? body.action : "";

  let setSql: string;
  const params: unknown[] = [clinicId];

  if (action === "extend") {
    const months = Number(body.months ?? 1);
    if (!Number.isFinite(months) || months <= 0 || months > 60) {
      throw new ApiError(400, "months must be between 1 and 60");
    }
    // Продлеваем от большего из (сейчас, текущая дата окончания), чтобы не терять остаток.
    params.push(Math.trunc(months));
    setSql = `
      subscription_status = 'active',
      subscription_ends_at = GREATEST(now(), COALESCE(subscription_ends_at, now())) + make_interval(months => $2::int)
    `;
  } else if (action === "suspend") {
    setSql = `subscription_status = 'suspended'`;
  } else if (action === "activate") {
    setSql = `subscription_status = 'active'`;
  } else if (action === "unlimited") {
    setSql = `subscription_status = 'active', subscription_ends_at = NULL`;
  } else {
    throw new ApiError(400, "unknown action (extend | suspend | activate | unlimited)");
  }

  const result = await dbPool.query<ClinicSubRow>(
    `
      WITH upd AS (
        UPDATE clinics SET ${setSql} WHERE id = $1 RETURNING id
      )
      ${SELECT_CLINIC}
      WHERE c.id = (SELECT id FROM upd)
    `,
    params
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "clinic not found");
  }
  return res.json(mapClinic(row));
};
