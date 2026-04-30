import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { ApiError } from "../middleware/errorHandler";
import { hashPassword } from "../utils/password";
import { signAccessToken } from "../utils/jwt";

type OnboardingBody = {
  clinicName?: string;
  clinicSlug?: string;
  username?: string;
  password?: string;
  fullName?: string;
};

type ClinicRow = {
  id: number;
  name: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

type UserRow = {
  id: number;
  clinic_id: number;
  username: string;
  full_name: string;
  role: "superadmin";
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const normalize = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export const onboardingController = async (
  req: Request<unknown, unknown, OnboardingBody>,
  res: Response
) => {
  const clinicName = normalize(req.body?.clinicName);
  const clinicSlug = normalize(req.body?.clinicSlug).toLowerCase();
  const username = normalize(req.body?.username).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const fullName = normalize(req.body?.fullName);

  if (!clinicName) throw new ApiError(400, "clinicName is required");
  if (!clinicSlug) throw new ApiError(400, "clinicSlug is required");
  if (!username) throw new ApiError(400, "username is required");
  if (password.length < 6) throw new ApiError(400, "password must be at least 6 characters");
  if (!fullName) throw new ApiError(400, "fullName is required");

  const passwordHash = await hashPassword(password);
  const client: PoolClient = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const clinicExists = await client.query<{ id: number }>(
      `
        SELECT id
        FROM clinics
        WHERE lower(slug) = lower($1)
        LIMIT 1
      `,
      [clinicSlug]
    );
    if (clinicExists.rowCount && clinicExists.rows[0]) {
      throw new ApiError(409, "clinic slug already exists");
    }

    const userExists = await client.query<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE lower(trim(username)) = lower(trim($1))
        LIMIT 1
      `,
      [username]
    );
    if (userExists.rowCount && userExists.rows[0]) {
      throw new ApiError(409, "username already exists");
    }

    const clinicResult = await client.query<ClinicRow>(
      `
        INSERT INTO clinics (name, slug, logo_url, primary_color)
        VALUES ($1, $2, '/logo.png', '#6D28D9')
        RETURNING id, name, slug, logo_url, primary_color
      `,
      [clinicName, clinicSlug]
    );

    const clinic = clinicResult.rows[0];
    if (!clinic) {
      throw new ApiError(500, "failed to create clinic");
    }

    const userResult = await client.query<UserRow>(
      `
        INSERT INTO users (clinic_id, username, password_hash, full_name, role, is_active, doctor_id)
        VALUES ($1, $2, $3, $4, 'superadmin', TRUE, NULL)
        RETURNING id, clinic_id, username, full_name, role, is_active, created_at, updated_at
      `,
      [clinic.id, username, passwordHash, fullName]
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new ApiError(500, "failed to create user");
    }

    const token = signAccessToken({
      userId: user.id,
      clinicId: user.clinic_id,
      username: user.username,
      role: "superadmin",
      doctorId: null,
    });

    await client.query("COMMIT");

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        clinicId: user.clinic_id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        isActive: user.is_active,
        doctorId: null,
        createdAt: toIso(user.created_at),
        updatedAt: toIso(user.updated_at),
        deletedAt: null,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      clinic: {
        id: clinic.id,
        name: clinic.name,
        slug: clinic.slug,
        logoUrl: clinic.logo_url ?? "/logo.png",
        primaryColor: clinic.primary_color ?? "#6D28D9",
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
