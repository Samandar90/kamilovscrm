import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";

const EXPIRES_IN = "8h";

export const signAccessToken = (payload: AuthTokenPayload): string => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: EXPIRES_IN });
};

export const verifyAccessToken = (token: string): AuthTokenPayload => {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }
  const payload = decoded as Partial<AuthTokenPayload>;
  if (
    typeof payload.userId !== "number" ||
    typeof payload.clinicId !== "number" ||
    typeof payload.username !== "string" ||
    typeof payload.role !== "string"
  ) {
    throw new Error("Token payload shape is invalid");
  }
  if (
    payload.doctorId !== undefined &&
    payload.doctorId !== null &&
    typeof payload.doctorId !== "number"
  ) {
    throw new Error("Invalid token payload");
  }
  if (
    payload.nurseDoctorId !== undefined &&
    payload.nurseDoctorId !== null &&
    typeof payload.nurseDoctorId !== "number"
  ) {
    throw new Error("Invalid token payload");
  }
  const doctorId = payload.doctorId as number | null | undefined;
  const nurseDoctorId = payload.nurseDoctorId as number | null | undefined;

  return {
    userId: payload.userId,
    clinicId: payload.clinicId,
    username: payload.username,
    role: payload.role as AuthTokenPayload["role"],
    ...(doctorId !== undefined ? { doctorId } : {}),
    ...(nurseDoctorId !== undefined ? { nurseDoctorId } : {}),
  };
};
