import type { UserRole } from "../../auth/permissions";
import { USER_ROLES } from "../../auth/permissions";

export type { UserRole };
export { USER_ROLES };

/** Допустимые роли при создании пользователя (все, кроме дубликатов не бывает). */
export const USER_MANAGEMENT_ROLES = USER_ROLES;

export type User = {
  id: number;
  clinicId: number;
  username: string;
  /** bcrypt hash from `password_hash` */
  password: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string | null;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Ссылка на профиль врача; для role === "doctor" обязательна и уникальна среди врачебных аккаунтов. */
  doctorId?: number | null;
};

export type PublicUser = Omit<User, "password"> & {
  /** Для role nurse: `nurses.doctor_id` (врач, к которому привязана медсестра). */
  nurseDoctorId?: number | null;
};

export type CreateUserInput = {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  isActive?: boolean;
  /** Обязателен при role === "doctor". */
  doctorId?: number | null;
};

export type UpdateUserInput = Partial<{
  fullName: string;
  role: UserRole;
  isActive: boolean;
  doctorId: number | null;
}>;

export type UsersFilters = Partial<{
  role: UserRole;
  isActive: boolean;
  search: string;
}>;

export type LoginInput = {
  username: string;
  password: string;
};

export type AuthTokenPayload = {
  userId: number;
  clinicId: number;
  username: string;
  role: UserRole;
  /** Колонка `users.doctor_id`. После `requireAuth` доступно как `req.auth.doctorId`. */
  doctorId?: number | null;
  /** Таблица `nurses`: врач, к которому привязана медсестра. `req.auth.nurseDoctorId` / `req.user?.nurse_doctor_id`. */
  nurseDoctorId?: number | null;
};

export type AuthResponse = {
  accessToken?: string;
  user?: PublicUser;
};
