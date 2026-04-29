import type { IUsersRepository } from "../interfaces/IUsersRepository";
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UserRole,
  UsersFilters,
} from "../interfaces/userTypes";
import { dbPool } from "../../config/database";
import { requireClinicId } from "../../tenancy/clinicContext";

type UserRow = {
  id: string | number;
  clinic_id: string | number;
  username: string;
  password_hash: string;
  full_name: string;
  role: string;
  is_active: boolean;
  doctor_id?: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  last_login_at?: Date | string | null;
  failed_login_attempts?: string | number | null;
  locked_until?: Date | string | null;
};

const toIso = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const normalizeUsername = (username: string): string => username.trim().toLowerCase();

const mapRow = (row: UserRow): User => ({
  id: Number(row.id),
  clinicId: Number(row.clinic_id),
  username: row.username,
  password: row.password_hash,
  fullName: row.full_name,
  role: row.role as UserRole,
  isActive: row.is_active,
  doctorId:
    row.doctor_id === undefined || row.doctor_id === null
      ? null
      : Number(row.doctor_id),
  lastLoginAt: row.last_login_at ? toIso(row.last_login_at) : null,
  failedLoginAttempts:
    row.failed_login_attempts == null ? 0 : Number(row.failed_login_attempts),
  lockedUntil: row.locked_until ? toIso(row.locked_until) : null,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  deletedAt: row.deleted_at ? toIso(row.deleted_at) : null,
});

const SELECT_FIELDS = `
  u.id,
  u.clinic_id,
  u.username,
  u.password_hash,
  COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS full_name,
  u.role,
  COALESCE(u.is_active, true) AS is_active,
  u.last_login_at,
  COALESCE(u.failed_login_attempts, 0) AS failed_login_attempts,
  u.locked_until,
  u.created_at,
  COALESCE(u.updated_at, u.created_at) AS updated_at,
  u.deleted_at,
  u.doctor_id
`;

const RETURNING_FIELDS = `
  id,
  clinic_id,
  username,
  password_hash,
  COALESCE(NULLIF(TRIM(full_name), ''), username) AS full_name,
  role,
  COALESCE(is_active, true) AS is_active,
  last_login_at,
  COALESCE(failed_login_attempts, 0) AS failed_login_attempts,
  locked_until,
  created_at,
  COALESCE(updated_at, created_at, NOW()) AS updated_at,
  deleted_at,
  doctor_id
`;

export class PostgresUsersRepository implements IUsersRepository {
  async findAll(filters: UsersFilters = {}): Promise<User[]> {
    const clinicId = requireClinicId();
    const clauses: string[] = ["u.deleted_at IS NULL", "u.clinic_id = $1"];
    const values: unknown[] = [clinicId];
    if (filters.role !== undefined) {
      values.push(filters.role);
      clauses.push(`u.role = $${values.length}`);
    }
    if (filters.isActive !== undefined) {
      values.push(filters.isActive);
      clauses.push(`COALESCE(u.is_active, true) = $${values.length}`);
    }
    if (filters.search !== undefined && filters.search.trim() !== "") {
      values.push(`%${filters.search.trim()}%`);
      const p = `$${values.length}`;
      clauses.push(
        `(u.username ILIKE ${p} OR COALESCE(u.full_name, '') ILIKE ${p})`
      );
    }
    const result = await dbPool.query<UserRow>(
      `
        SELECT ${SELECT_FIELDS}
        FROM users u
        WHERE ${clauses.join(" AND ")}
        ORDER BY u.created_at DESC
      `,
      values
    );
    return result.rows.map(mapRow);
  }

  async findById(id: number): Promise<User | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<UserRow>(
      `
        SELECT ${SELECT_FIELDS}
        FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL AND u.clinic_id = $2
        LIMIT 1
      `,
      [id, clinicId]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async findByUsername(username: string): Promise<User | null> {
    const normalized = normalizeUsername(username);
    const result = await dbPool.query<UserRow>(
      `
        SELECT ${SELECT_FIELDS}
        FROM users u
        WHERE lower(trim(u.username)) = $1
          AND COALESCE(u.is_active, true) = true
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [normalized]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async findByUsernameIncludingInactive(username: string): Promise<User | null> {
    const normalized = normalizeUsername(username);
    const result = await dbPool.query<UserRow>(
      `
        SELECT ${SELECT_FIELDS}
        FROM users u
        WHERE lower(trim(u.username)) = $1
        LIMIT 1
      `,
      [normalized]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async findActiveDoctorUserIdByDoctorProfile(
    doctorId: number,
    excludeUserId?: number
  ): Promise<number | null> {
    const result = await dbPool.query<{ id: string | number }>(
      `
        SELECT u.id
        FROM users u
        WHERE u.doctor_id = $1
          AND u.role = 'doctor'
          AND u.deleted_at IS NULL
          AND ($2::bigint IS NULL OR u.id <> $2::bigint)
        LIMIT 1
      `,
      [doctorId, excludeUserId ?? null]
    );
    if (result.rows.length === 0) return null;
    return Number(result.rows[0].id);
  }

  async create(data: CreateUserInput): Promise<User> {
    const clinicId = requireClinicId();
    const username = normalizeUsername(data.username);
    const doctorId = data.role === "doctor" ? data.doctorId ?? null : null;
    const result = await dbPool.query<UserRow>(
      `
        INSERT INTO users (clinic_id, username, password_hash, full_name, role, is_active, doctor_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${RETURNING_FIELDS}
      `,
      [clinicId, username, data.password, data.fullName, data.role, data.isActive ?? true, doctorId]
    );
    return mapRow(result.rows[0]);
  }

  async update(id: number, data: UpdateUserInput): Promise<User | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.fullName !== undefined) {
      sets.push(`full_name = $${i++}`);
      values.push(data.fullName);
    }
    if (data.role !== undefined) {
      sets.push(`role = $${i++}`);
      values.push(data.role);
    }
    if (data.isActive !== undefined) {
      sets.push(`is_active = $${i++}`);
      values.push(data.isActive);
    }
    if (data.doctorId !== undefined) {
      sets.push(`doctor_id = $${i++}`);
      values.push(data.doctorId);
    }
    sets.push(`updated_at = NOW()`);
    if (sets.length === 0) {
      return this.findById(id);
    }
    values.push(id);
    const result = await dbPool.query<UserRow>(
      `
        UPDATE users
        SET ${sets.join(", ")}
        WHERE id = $${i} AND deleted_at IS NULL
        RETURNING ${RETURNING_FIELDS}
      `,
      values
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async delete(id: number): Promise<boolean> {
    const result = await dbPool.query<{ id: string }>(
      `
        UPDATE users
        SET deleted_at = NOW(),
            is_active = false,
            updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `,
      [id]
    );
    return result.rows.length > 0;
  }

  async toggleActive(id: number): Promise<User | null> {
    const result = await dbPool.query<UserRow>(
      `
        UPDATE users
        SET is_active = NOT is_active,
            updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${RETURNING_FIELDS}
      `,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async updatePassword(id: number, passwordHash: string): Promise<User | null> {
    const result = await dbPool.query<UserRow>(
      `
        UPDATE users
        SET password_hash = $2,
            updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${RETURNING_FIELDS}
      `,
      [id, passwordHash]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  async updateSecurityState(
    id: number,
    patch: Partial<{
      lastLoginAt: string | null;
      failedLoginAttempts: number;
      lockedUntil: string | null;
    }>
  ): Promise<User | null> {
    const sets: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let i = 1;
    if (patch.lastLoginAt !== undefined) {
      sets.push(`last_login_at = $${i++}`);
      values.push(patch.lastLoginAt);
    }
    if (patch.failedLoginAttempts !== undefined) {
      sets.push(`failed_login_attempts = $${i++}`);
      values.push(patch.failedLoginAttempts);
    }
    if (patch.lockedUntil !== undefined) {
      sets.push(`locked_until = $${i++}`);
      values.push(patch.lockedUntil);
    }
    values.push(id);
    const result = await dbPool.query<UserRow>(
      `
        UPDATE users u
        SET ${sets.join(", ")}
        WHERE u.id = $${i} AND u.deleted_at IS NULL
        RETURNING ${RETURNING_FIELDS}
      `,
      values
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

}
