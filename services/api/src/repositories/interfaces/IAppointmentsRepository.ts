import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentInvoiceLine,
  AppointmentServiceAssignment,
  AppointmentUpdateInput,
} from "./coreTypes";

export interface IAppointmentsRepository {
  findAll(filters?: AppointmentFilters): Promise<Appointment[]>;
  findById(id: number): Promise<Appointment | null>;
  create(data: AppointmentCreateInput): Promise<Appointment>;
  update(id: number, data: AppointmentUpdateInput): Promise<Appointment | null>;
  updatePrice(id: number, price: number): Promise<Appointment | null>;
  cancel(
    id: number,
    cancelReason: string | null,
    cancelledBy: number
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
  createServiceAssignment(
    appointmentId: number,
    serviceId: number,
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment>;
  deleteServiceAssignment(appointmentId: number, serviceId: number): Promise<boolean>;
  replaceServiceAssignments(
    appointmentId: number,
    serviceIds: number[],
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment[]>;
  listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]>;
  /** Позиции счёта: цены и количества из appointment_services (не из каталога). */
  listAppointmentInvoiceLines(appointmentId: number): Promise<AppointmentInvoiceLine[]>;
  updateBillingStatus(
    appointmentId: number,
    billingStatus: AppointmentBillingStatus
  ): Promise<Appointment | null>;
}
