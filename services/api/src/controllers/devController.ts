import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { dbPool } from "../config/database";
import { env } from "../config/env";
import { getMockDb, nextId } from "../repositories/mockDatabase";
import type { UserRole } from "../repositories/interfaces/userTypes";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const ADMIN_FULL_NAME = "Administrator";
const ADMIN_ROLE: UserRole = "superadmin";

export const createAdminDevController = async (_req: Request, res: Response) => {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  if (env.dataProvider === "postgres") {
    const existing = await dbPool.query<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE lower(trim(username)) = lower(trim($1))
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [ADMIN_USERNAME]
    );

    if (existing.rowCount && existing.rows[0]) {
      await dbPool.query(
        `
          UPDATE users
          SET
            password_hash = $2,
            full_name = $3,
            role = $4,
            is_active = TRUE,
            updated_at = now()
          WHERE id = $1
        `,
        [existing.rows[0].id, passwordHash, ADMIN_FULL_NAME, ADMIN_ROLE]
      );
    } else {
      await dbPool.query(
        `
          INSERT INTO users (clinic_id, username, password_hash, full_name, role, is_active, doctor_id)
          VALUES (1, $1, $2, $3, $4, TRUE, NULL)
        `,
        [ADMIN_USERNAME, passwordHash, ADMIN_FULL_NAME, ADMIN_ROLE]
      );
    }
  } else {
    const db = getMockDb();
    const existing = db.users.find(
      (user) => user.deletedAt == null && user.username.trim().toLowerCase() === ADMIN_USERNAME
    );

    if (existing) {
      existing.password = passwordHash;
      existing.fullName = ADMIN_FULL_NAME;
      existing.role = ADMIN_ROLE;
      existing.isActive = true;
      existing.updatedAt = new Date().toISOString();
    } else {
      const now = new Date().toISOString();
      db.users.push({
        id: nextId(),
        clinicId: 1,
        username: ADMIN_USERNAME,
        password: passwordHash,
        fullName: ADMIN_FULL_NAME,
        role: ADMIN_ROLE,
        isActive: true,
        doctorId: null,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
  }

  return res.status(200).json({ success: true });
};

