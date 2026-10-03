import { ApiError } from "../middleware/errorHandler";
import type {
  Appointment,
  AppointmentFilters,
  AppointmentUpdateInput,
} from "../repositories/interfaces/coreTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import type { UserRole } from "../repositories/interfaces/userTypes";

const SCOPED_BY_DOCTOR_ROLES: readonly UserRole[] = ["doctor", "nurse"];

/** Roles that must not receive diagnosis / treatment / notes in API responses. */
const APPOINTMENT_CLINICAL_HIDDEN_ROLES: readonly UserRole[] = [
  "cashier",
  "accountant",
  "director",
  "operator",
  "marketer",
];

/** Roles allowed to set diagnosis or treatment on appointments. */
const APPOINTMENT_CLINICAL_WRITE_ROLES: readonly UserRole[] = [
  "superadmin",
  "manager",
  "doctor",
  "nurse",
];

export function isDoctorScopedRole(role: UserRole): boolean {
  return SCOPED_BY_DOCTOR_ROLES.includes(role);
}

/**
 * Врач: `users.doctor_id` → JWT `doctorId`.
 * Медсестра: `nurses.doctor_id` → JWT `nurseDoctorId`.
 */
export function getEffectiveDoctorId(auth: AuthTokenPayload): number {
  if (auth.role === "doctor") {
    if (auth.doctorId == null) {
      throw new ApiError(403, "Account is not linked to a doctor profile");
    }
    return auth.doctorId;
  }
  if (auth.role === "nurse") {
    if (auth.nurseDoctorId == null) {
      throw new ApiError(403, "Медсестра не привязана к врачу");
    }
    return auth.nurseDoctorId;
  }
  throw new ApiError(500, "getEffectiveDoctorId called for non-scoped role");
}

/** Merges query filters with mandatory doctor scope for clinical roles. */
export function mergeAppointmentFiltersForUser(
  auth: AuthTokenPayload,
  filters: AppointmentFilters
): AppointmentFilters {
  if (!isDoctorScopedRole(auth.role)) {
    return { ...filters };
  }
  return { ...filters, doctorId: getEffectiveDoctorId(auth) };
}

/** Returns false if the caller must not see this appointment (use 404 at call site). */
export function canReadAppointment(
  auth: AuthTokenPayload,
  appointment: Appointment
): boolean {
  if (!isDoctorScopedRole(auth.role)) {
    return true;
  }
  return appointment.doctorId === getEffectiveDoctorId(auth);
}

export function shouldRedactAppointmentClinicalFields(role: UserRole): boolean {
  return APPOINTMENT_CLINICAL_HIDDEN_ROLES.includes(role);
}

export function redactAppointmentClinicalFields(appointment: Appointment): Appointment {
  return {
    ...appointment,
    diagnosis: null,
    treatment: null,
    notes: null,
  };
}

export function assertAppointmentClinicalWriteAllowed(
  auth: AuthTokenPayload,
  payload: Partial<
    Pick<AppointmentUpdateInput, "diagnosis" | "treatment" | "notes" | "recommendedReturnDate">
  >
): void {
  if (
    payload.diagnosis === undefined &&
    payload.treatment === undefined &&
    payload.recommendedReturnDate === undefined &&
    payload.notes === undefined
  ) {
    return;
  }
  if (!APPOINTMENT_CLINICAL_WRITE_ROLES.includes(auth.role)) {
    throw new ApiError(
      403,
      "Недостаточно прав для изменения клинических полей записи (диагноз, лечение, примечания)"
    );
  }
}
