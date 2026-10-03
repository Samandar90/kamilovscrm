import type { appointmentsFlowApi, InvoiceSummary } from "../api/appointmentsFlowApi";

export type AppointmentsPageApi = Pick<
  typeof appointmentsFlowApi,
  "listAppointments" | "listPatients" | "listDoctors" | "listServices" | "listInvoices"
>;

/** Invoice of each appointment. An appointment has one invoice; if the list ever holds two, the first (newest) wins. */
export function indexInvoicesByAppointment(invoices: InvoiceSummary[]): Record<number, InvoiceSummary> {
  const byAppointment: Record<number, InvoiceSummary> = {};
  for (const invoice of invoices) {
    if (invoice.appointmentId != null && byAppointment[invoice.appointmentId] === undefined) {
      byAppointment[invoice.appointmentId] = invoice;
    }
  }
  return byAppointment;
}

/**
 * Everything the Appointments page shows, in five parallel requests.
 * Invoices come as one list: asking per appointment cost a request (plus a CORS preflight) for every appointment
 * the clinic ever had, on each load and after each action.
 */
export async function loadAppointmentsPageData(
  api: AppointmentsPageApi,
  token: string,
  access: { readBilling: boolean; readPatients: boolean }
) {
  const [appointments, patients, doctors, services, invoices] = await Promise.all([
    api.listAppointments(token),
    access.readPatients ? api.listPatients(token) : Promise.resolve([]),
    api.listDoctors(token),
    api.listServices(token),
    // Invoice state is optional here: if the list fails, the schedule still opens.
    access.readBilling ? api.listInvoices(token).catch((): InvoiceSummary[] => []) : Promise.resolve([]),
  ]);
  return { appointments, patients, doctors, services, invoicesByAppointmentId: indexInvoicesByAppointment(invoices) };
}
