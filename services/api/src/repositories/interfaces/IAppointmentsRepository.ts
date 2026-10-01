import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentInvoiceLine,
  AppointmentServiceAssignment,
  AppointmentServiceLineReplacement,
  AppointmentUpdateInput,
} from "./coreTypes";
import type { QueueDirective } from "./queueTypes";

/** Side effects of a write decided by AppointmentsService (see services/queue/queueRules.ts). */
export type AppointmentWriteOptions = {
  /** "issue": next number of the doctor's counter for `day`; "clear": drop the ticket; default "keep". */
  queue?: QueueDirective;
  /**
   * Skip the slot-overlap check. Only for a no-show returning to today's queue in its UNCHANGED slot
   * (same time and doctor), which may be taken by now; a moved slot is always checked.
   */
  skipConflictCheck?: boolean;
};

export interface IAppointmentsRepository {
  findAll(filters?: AppointmentFilters): Promise<Appointment[]>;
  findById(id: number): Promise<Appointment | null>;
  create(data: AppointmentCreateInput, options?: AppointmentWriteOptions): Promise<Appointment>;
  update(
    id: number,
    data: AppointmentUpdateInput,
    options?: AppointmentWriteOptions
  ): Promise<Appointment | null>;
  updatePrice(id: number, price: number): Promise<Appointment | null>;
  cancel(
    id: number,
    cancelReason: string | null,
    cancelledByUserId: number,
    cancelledByRole?: string | null
  ): Promise<Appointment | null>;
  delete(id: number): Promise<boolean>;
  findConflicting(
    doctorId: number,
    startAt: string,
    endAt: string,
    excludeId?: number
  ): Promise<boolean>;
  patientExists(id: number): Promise<boolean>;
  doctorExists(id: number): Promise<boolean>;
  serviceExists(id: number): Promise<boolean>;
  /** Service row exists, not soft-deleted, and active (for new/changed bookings). */
  isServiceActive(serviceId: number): Promise<boolean>;
  getServiceDuration(serviceId: number): Promise<number | null>;
  getServicePrice(serviceId: number): Promise<number | null>;
  isServiceAssignedToDoctor(serviceId: number, doctorId: number): Promise<boolean>;
  /**
   * Patient is in the current clinic and either registered by this doctor or already had an appointment with them.
   */
  isPatientEligibleForDoctorBooking(patientId: number, doctorId: number): Promise<boolean>;
  /**
   * Atomically replaces the appointment's service lines. The first line becomes the primary
   * service (appointments.service_id / price). Optimistic lock: fails with 409 when the
   * appointment changed after `expectedUpdatedAt` was read, and while an active invoice exists
   * (the invoice is a snapshot of these lines). Returns null when the appointment is absent.
   */
  replaceServiceLines(
    appointmentId: number,
    lines: AppointmentServiceLineReplacement[],
    options: { endAt?: string; updatedBy: number | null; expectedUpdatedAt: string }
  ): Promise<Appointment | null>;
  listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]>;
  /** Позиции счёта: цены и количества из appointment_services (не из каталога). */
  listAppointmentInvoiceLines(appointmentId: number): Promise<AppointmentInvoiceLine[]>;
  updateBillingStatus(
    appointmentId: number,
    billingStatus: AppointmentBillingStatus
  ): Promise<Appointment | null>;
}
