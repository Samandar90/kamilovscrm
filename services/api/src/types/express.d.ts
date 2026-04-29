import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";

type AuthUserPayload = AuthTokenPayload & {
  /** Дублирует `nurseDoctorId` в snake_case (как в ТЗ). */
  nurse_doctor_id?: number | null;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
      user?: AuthUserPayload;
      clinicId?: number;
    }
  }
}

export {};
