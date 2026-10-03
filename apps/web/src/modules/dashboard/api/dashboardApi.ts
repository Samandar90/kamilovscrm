import { requestJson } from "../../../api/http";
import {
  appointmentsListPath,
  type Appointment,
  type AppointmentListFilters,
  type InvoiceCreateInput,
} from "../../appointments/api/appointmentsFlowApi";
import { normalizeInvoiceCreatePayload } from "../../../utils/normalizeInvoiceCreatePayload";
import type {
  CashRegisterShift,
  InvoiceSummary,
  Payment,
} from "../../billing/api/cashDeskApi";

export type DashboardDoctor = { id: number; name: string; active: boolean };
export type DashboardPatient = { id: number; fullName: string; createdAt?: string };
export type DashboardService = { id: number; name: string };

export const dashboardApi = {
  listAppointments: (filters: AppointmentListFilters) =>
    requestJson<Appointment[]>(appointmentsListPath(filters)),
  listPayments: () => requestJson<Payment[]>("/api/payments"),
  listInvoices: () => requestJson<InvoiceSummary[]>("/api/invoices"),
  listPatients: () => requestJson<DashboardPatient[]>("/api/patients"),
  listDoctors: () => requestJson<DashboardDoctor[]>("/api/doctors"),
  listServices: () => requestJson<DashboardService[]>("/api/services"),
  activeShift: () =>
    requestJson<CashRegisterShift | null>("/api/cash-register/shifts/active"),

  markArrived: (appointmentId: number) =>
    requestJson<Appointment>(`/api/appointments/${appointmentId}`, {
      method: "PUT",
      body: { status: "arrived" },
    }),
  completeAppointment: (appointmentId: number) =>
    requestJson<Appointment>(`/api/appointments/${appointmentId}`, {
      method: "PUT",
      body: { status: "completed" },
    }),
  createInvoiceForAppointment: (payload: {
    patientId: number;
    appointmentId: number;
    serviceId: number;
  }) => {
    const raw: InvoiceCreateInput = {
      patientId: payload.patientId,
      appointmentId: payload.appointmentId,
      items: [{ serviceId: payload.serviceId, quantity: 1 }],
      status: "issued",
    };
    const body = normalizeInvoiceCreatePayload(raw);
    // eslint-disable-next-line no-console
    console.log("[POST /api/invoices] payload", body);
    return requestJson<InvoiceSummary>("/api/invoices", {
      method: "POST",
      body,
    });
  },
};
