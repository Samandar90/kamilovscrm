export type { UserRole } from "./permissions";

export type PublicUser = {
  id: number;
  username: string;
  fullName?: string;
  role: import("./permissions").UserRole;
  isActive: boolean;
  /** Совпадает с колонкой users.doctor_id (JWT: doctorId). */
  doctorId?: number | null;
  /** Привязка медсестры к врачу (`nurses.doctor_id`, JWT: nurseDoctorId). */
  nurseDoctorId?: number | null;
  createdAt: string;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type OnboardingInput = {
  clinicName: string;
  clinicSlug: string;
  username: string;
  password: string;
  fullName: string;
};

export type AuthResponse = {
  accessToken?: string;
  user?: PublicUser;
};

export type OnboardingResponse = {
  token: string;
  user: PublicUser;
  clinic: {
    id: number;
    name: string;
    slug: string | null;
    logoUrl: string;
    primaryColor: string;
  };
};
