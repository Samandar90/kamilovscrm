import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { dbPool } from "../config/database";
import { ApiError } from "../middleware/errorHandler";

/** Смена собственного пароля пользователя (требует текущий пароль). */
export const changePasswordController = async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) {
    throw new ApiError(401, "not authenticated");
  }

  const body = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "currentPassword and newPassword are required");
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, "newPassword must be at least 6 characters");
  }

  if (currentPassword === newPassword) {
    throw new ApiError(400, "newPassword must be different from currentPassword");
  }

  // Получаем текущий хэш пароля
  const userRow = await dbPool.query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const user = userRow.rows[0];
  if (!user) {
    throw new ApiError(404, "user not found");
  }

  // Проверяем текущий пароль
  const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isCurrentValid) {
    throw new ApiError(401, "current password is incorrect");
  }

  // Хешируем новый пароль и обновляем
  const newHash = await bcrypt.hash(newPassword, 10);
  await dbPool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

  return res.json({ ok: true, message: "password changed successfully" });
};
