import type { IAppointmentsRepository } from "./interfaces/IAppointmentsRepository";
import { APPOINTMENT_BILLING_STATUSES, APPOINTMENT_STATUSES } from "./interfaces/coreTypes";
import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentServiceAssignment,
  AppointmentStatus,
  AppointmentUpdateInput,
} from "./interfaces/coreTypes";
import {
  type AppointmentRecord,
  getMockDb,
  nextId,
} from "./mockDatabase";
export { APPOINTMENT_STATUSES };
export { APPOINTMENT_BILLING_STATUSES };
export type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentStatus,
  AppointmentUpdateInput,
};

const toAppointment = (row: AppointmentRecord): Appointment => ({ ...row });

export class MockAppointmentsRepository implements IAppointmentsRepository {
  async findAll(filters: AppointmentFilters = {}): Promise<Appointment[]> {
    return getMockDb()
      .appointments.filter((row) => {
        if (filters.patientId !== undefined && row.patientId !== filters.patientId) return false;
        if (filters.doctorId !== undefined && row.doctorId !== filters.doctorId) return false;
        if (filters.serviceId !== undefined && row.serviceId !== filters.serviceId) return false;
        if (filters.status !== undefined && row.status !== filters.status) return false;
        if (filters.billingStatus !== undefined && row.billingStatus !== filters.billingStatus) return false;
        if (filters.startFrom !== undefined && row.startAt < filters.startFrom) return false;
        const upper = filters.startTo ?? filters.endTo;
        if (upper !== undefined && row.startAt > upper) return false;
        return true;
      })
      .sort((a, b) => b.startAt.localeCompare(a.startAt))
      .map(toAppointment);
  }

  async findById(id: number): Promise<Appointment | null> {
    const found = getMockDb().appointments.find((item) => item.id === id);
    return found ? toAppointment(found) : null;
  }

  async create(input: AppointmentCreateInput): Promise<Appointment> {
    const now = new Date().toISOString();
    const created: AppointmentRecord = {
      id: nextId(),
      patientId: input.patientId,
      doctorId: input.doctorId,
      serviceId: input.serviceId,
      price: input.price ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      status: input.status,
      billingStatus: input.billingStatus ?? "draft",
      cancelReason: input.cancelReason ?? null,
      cancelledAt: null,
      cancelledBy: null,
      diagnosis: input.diagnosis ?? null,
      treatment: input.treatment ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    getMockDb().appointments.push(created);
    return toAppointment(created);
  }

  async update(id: number, input: AppointmentUpdateInput): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    db.appointments[idx] = { ...db.appointments[idx], ...input, updatedAt: new Date().toISOString() };
    return toAppointment(db.appointments[idx]);
  }

  async updatePrice(id: number, price: number): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    db.appointments[idx] = { ...db.appointments[idx], price, updatedAt: new Date().toISOString() };
    return toAppointment(db.appointments[idx]);
  }

  async cancel(
    id: number,
    cancelReason: string | null,
    cancelledBy: number
  ): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    db.appointments[idx] = {
      ...db.appointments[idx],
      status: "cancelled",
      cancelReason,
      cancelledAt: new Date().toISOString(),
      cancelledBy,
      updatedAt: new Date().toISOString(),
    };
    return toAppointment(db.appointments[idx]);
  }

  async delete(id: number): Promise<boolean> {
    const db = getMockDb();
    const before = db.appointments.length;
    db.appointments = db.appointments.filter((item) => item.id !== id);
    return db.appointments.length < before;
  }

  async findConflicting(
    doctorId: number,
    startAt: string,
    endAt: string,
    excludeAppointmentId?: number
  ): Promise<boolean> {
    const active = new Set<AppointmentStatus>([
      "scheduled",
      "confirmed",
      "arrived",
      "in_consultation",
    ]);
    return getMockDb().appointments.some((row) => {
      if (row.doctorId !== doctorId) return false;
      if (excludeAppointmentId !== undefined && row.id === excludeAppointmentId) return false;
      if (!active.has(row.status)) return false;
      return row.startAt < endAt && row.endAt > startAt;
    });
  }

  async patientExists(id: number): Promise<boolean> {
    return getMockDb().patients.some((item) => item.id === id && item.deletedAt === null);
  }

  async doctorExists(id: number): Promise<boolean> {
    return getMockDb().doctors.some((item) => item.id === id);
  }

  async serviceExists(id: number): Promise<boolean> {
    return getMockDb().services.some((item) => item.id === id);
  }

  async isServiceActive(serviceId: number): Promise<boolean> {
    const found = getMockDb().services.find((item) => item.id === serviceId);
    return found ? found.active === true : false;
  }

  async getServiceDuration(serviceId: number): Promise<number | null> {
    const found = getMockDb().services.find((item) => item.id === serviceId);
    return found ? found.duration : null;
  }

  async getServicePrice(serviceId: number): Promise<number | null> {
    const found = getMockDb().services.find((item) => item.id === serviceId);
    return found ? found.price : null;
  }

  async isServiceAssignedToDoctor(serviceId: number, doctorId: number): Promise<boolean> {
    return getMockDb().doctorServices.some(
      (item) => item.serviceId === serviceId && item.doctorId === doctorId
    );
  }

  async createServiceAssignment(
    appointmentId: number,
    serviceId: number,
    createdBy: number | null
  ): Promise<AppointmentServiceAssignment> {
    const created: AppointmentServiceAssignment = {
      id: nextId(),
      appointmentId,
      serviceId,
      createdBy,
      createdAt: new Date().toISOString(),
    };
    getMockDb().appointmentServices.push(created);
    return created;
  }

  async listServiceAssignments(appointmentId: number): Promise<AppointmentServiceAssignment[]> {
    return getMockDb().appointmentServices
      .filter((item) => item.appointmentId === appointmentId)
      .sort((a, b) => a.id - b.id)
      .map((item) => ({ ...item }));
  }

  async updateBillingStatus(
    appointmentId: number,
    billingStatus: AppointmentBillingStatus
  ): Promise<Appointment | null> {
    const db = getMockDb();
    const idx = db.appointments.findIndex((item) => item.id === appointmentId);
    if (idx < 0) {
      return null;
    }
    db.appointments[idx] = {
      ...db.appointments[idx],
      billingStatus,
      updatedAt: new Date().toISOString(),
    };
    return toAppointment(db.appointments[idx]);
  }
}
