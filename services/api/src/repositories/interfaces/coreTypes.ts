export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "in_consultation",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_BILLING_STATUSES = [
  "draft",
  "ready_for_payment",
  "paid",
] as const;
export type AppointmentBillingStatus = (typeof APPOINTMENT_BILLING_STATUSES)[number];
export type PatientGender = "male" | "female" | "other" | "unknown";

/** Источник обращения пациента (хранится в БД латиницей). */
export type PatientSource = "instagram" | "telegram" | "advertising" | "referral" | "other";

export type Patient = {
  id: number;
  fullName: string;
  phone: string | null;
  gender: PatientGender | null;
  birthDate: string | null;
  source: PatientSource | null;
  notes: string | null;
  createdAt: string;
};

export type PatientCreateInput = {
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  gender: PatientGender | null;
  source?: PatientSource | null;
  notes?: string | null;
};

export type PatientUpdateInput = Partial<PatientCreateInput>;

export type Doctor = {
  id: number;
  name: string;
  speciality: string;
  percent: number;
  phone?: string | null;
  birth_date?: string | null;
  active: boolean;
  serviceIds: number[];
  createdAt: string;
};

export type DoctorCreateInput = Omit<Doctor, "id" | "createdAt" | "serviceIds"> & {
  serviceIds?: number[];
};
export type DoctorUpdateInput = Partial<DoctorCreateInput>;

export type Service = {
  id: number;
  name: string;
  category: string;
  price: number;
  duration: number;
  active: boolean;
  /** Doctors linked via doctor_services (sorted ascending). */
  doctorIds: number[];
  createdAt: string;
};

export type ServiceCreateInput = Omit<Service, "id" | "createdAt" | "doctorIds"> & {
  doctorIds?: number[];
};

export type ServiceUpdateInput = Partial<
  Omit<Service, "id" | "createdAt" | "doctorIds">
> & {
  doctorIds?: number[];
};

export type ServiceFilters = {
  doctorId?: number;
  /** When true, only services with active = true (used when filtering by doctor for appointments). */
  activeOnly?: boolean;
};

export type Appointment = {
  id: number;
  patientId: number;
  doctorId: number;
  serviceId: number;
  price: number | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  billingStatus: AppointmentBillingStatus;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: number | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentFilters = {
  patientId?: number;
  doctorId?: number;
  serviceId?: number;
  status?: AppointmentStatus;
  billingStatus?: AppointmentBillingStatus;
  startFrom?: string;
  /** Верхняя граница по `start_at` (включительно). */
  startTo?: string;
  /** Синоним `startTo` (верхняя граница диапазона). Если заданы оба — используется `startTo`. */
  endTo?: string;
};

/** Generic patient list filters (no role semantics). */
export type PatientFilters = {
  /** When set, only patients whose id is in this list (empty → no rows). */
  ids?: number[];
  /** Include soft-deleted rows (e.g. resolve names for doctor-scoped lists by appointment patientIds). */
  includeDeleted?: boolean;
  /**
   * Server-side match on full_name and phone (ILIKE, case-insensitive).
   * When set (non-empty after trim), results are capped at 20 and soft-deleted rows are excluded.
   */
  search?: string;
};

export type AppointmentCreateInput = {
  patientId: number;
  doctorId: number;
  serviceId: number;
  price?: number | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  billingStatus?: AppointmentBillingStatus;
  cancelReason?: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
};

export type AppointmentUpdateInput = Partial<AppointmentCreateInput>;

export type AppointmentServiceAssignment = {
  id: number;
  appointmentId: number;
  serviceId: number;
  createdBy: number | null;
  createdAt: string;
};
