import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { USER_MANAGEMENT_ROLES, type UserRole } from "../repositories/interfaces/userTypes";

const parseRole = (value: unknown): UserRole | undefined => {
  if (typeof value !== "string") return undefined;
  return (USER_MANAGEMENT_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : undefined;
};

const parseDoctorIdBody = (body: Record<string, unknown>): number | undefined => {
  const raw = body.doctorId ?? body.doctor_id;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return id;
};

const parseClinicIdBody = (body: Record<string, unknown>): number | undefined => {
  const raw = body.clinicId ?? body.clinic_id;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return id;
};

export const listUsersController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const users = await services.users.getAllUsers(auth, {
    role: parseRole(req.query.role),
    isActive:
      typeof req.query.isActive === "string"
        ? req.query.isActive === "true"
        : undefined,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
  });
  return res.status(200).json(users);
};

export const getUserByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const user = await services.users.getUserById(auth, Number(req.params.id));
  if (!user) throw new ApiError(404, "User not found");
  return res.status(200).json(user);
};

export const createUserController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const body = req.body ?? {};
  const doctorId = parseDoctorIdBody(body as Record<string, unknown>);
  const clinicId = parseClinicIdBody(body as Record<string, unknown>);
  const created = await services.users.createUser(auth, {
    username: body.username,
    password: body.password,
    fullName: body.fullName ?? body.full_name,
    role: body.role,
    isActive: body.isActive ?? body.is_active,
    clinicId,
    ...(doctorId !== undefined ? { doctorId } : {}),
  });
  return res.status(201).json(created);
};

export const updateUserController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const body = req.body ?? {};
  const doctorId = parseDoctorIdBody(body as Record<string, unknown>);
  const updated = await services.users.updateUser(auth, Number(req.params.id), {
    fullName: body.fullName ?? body.full_name,
    role: body.role,
    isActive: body.isActive ?? body.is_active,
    ...(doctorId !== undefined ? { doctorId } : {}),
  });
  if (!updated) throw new ApiError(404, "User not found");
  return res.status(200).json(updated);
};

export const deleteUserController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const deleted = await services.users.deleteUser(auth, Number(req.params.id));
  if (!deleted) throw new ApiError(404, "User not found");
  return res.status(200).json({ success: true, id: Number(req.params.id) });
};

export const toggleUserActiveController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const updated = await services.users.toggleUserActive(auth, Number(req.params.id));
  if (!updated) throw new ApiError(404, "User not found");
  return res.status(200).json(updated);
};

export const changeUserPasswordController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const body = req.body ?? {};
  const updated = await services.users.changeUserPassword(
    auth,
    Number(req.params.id),
    String(body.password ?? "")
  );
  if (!updated) throw new ApiError(404, "User not found");
  return res.status(200).json(updated);
};


/** «Войти как»: выдаёт токен целевого пользователя. Права проверяет services.auth.impersonate. */
export const impersonateUserController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const result = await services.auth.impersonate(auth, Number(req.params.id), {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  return res.status(200).json(result);
};
