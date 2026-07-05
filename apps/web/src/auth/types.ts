export type { UserRole } from "./permissions";

export type PublicUser = {
  id: number;
  username: string;
  fullName?: string;
  role: import("./permissions").UserRole;
  isActive: boolean;
  /** Matches users.doctor_id column (JWT: doctorId). */
  doctorId?: number | null;
  /** Nurse's binding to doctor (`nurses.doctor_id`, JWT: nurseDoctorId). */
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
