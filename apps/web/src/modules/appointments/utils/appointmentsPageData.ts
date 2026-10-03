import type { Appointment, appointmentsFlowApi, InvoiceSummary } from "../api/appointmentsFlowApi";
import { addDaysYmd, pad2 } from "./appointmentFormUtils";

export type AppointmentsPageApi = Pick<
  typeof appointmentsFlowApi,
  "listAppointments" | "listPatients" | "listDoctors" | "listServices" | "listInvoices"
>;

/** Calendar days `YYYY-MM-DD`, both included. */
export type DayRange = { from: string; to: string };

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
 * Days to request for the visible period. Today, Tomorrow and Week all lie inside "today and the next 7 days",
 * so they share one request and switching between them needs no network. Any other day is requested on its own.
 */
export function appointmentsLoadRange(visible: DayRange, today: string): DayRange {
  const week = { from: today, to: addDaysYmd(today, 7) };
  return visible.from >= week.from && visible.to <= week.to ? week : visible;
}

/**
 * Everything the Appointments page shows, in five parallel requests.
 * Appointments come for `range` only: the clinic's whole history grows with every working day.
 * Invoices come as one list: asking per appointment cost a request (plus a CORS preflight) for every appointment
 * the clinic ever had, on each load and after each action.
 */
export async function loadAppointmentsPageData(
  api: AppointmentsPageApi,
  token: string,
  access: { readBilling: boolean; readPatients: boolean },
  range: DayRange
) {
  const [appointments, patients, doctors, services, invoices] = await Promise.all([
    api.listAppointments(token, range),
    access.readPatients ? api.listPatients(token) : Promise.resolve([]),
    api.listDoctors(token),
    api.listServices(token),
    // Invoice state is optional here: if the list fails, the schedule still opens.
    access.readBilling ? api.listInvoices(token).catch((): InvoiceSummary[] => []) : Promise.resolve([]),
  ]);
  return { appointments, patients, doctors, services, invoicesByAppointmentId: indexInvoicesByAppointment(invoices) };
}

export type SlotRequest = { doctorId: number; dateYmd: string; durationMinutes: number };

const SLOT_HOLDING_STATUSES = new Set<Appointment["status"]>(["scheduled", "confirmed", "arrived", "in_consultation"]);

const wallClockToDate = (value: string): Date => new Date(value.includes(" ") ? value.replace(" ", "T") : value);

/**
 * Up to three half-hour starts from 08:00 at which a visit of `durationMinutes` does not overlap the doctor's
 * active visits and ends by 20:00.
 */
export function suggestFreeTimes(rows: Appointment[], { doctorId, dateYmd, durationMinutes }: SlotRequest): string[] {
  const suggestions: string[] = [];
  for (let hour = 8; hour <= 19; hour += 1) {
    for (const minute of [0, 30]) {
      const slot = `${pad2(hour)}:${pad2(minute)}`;
      const start = new Date(`${dateYmd}T${slot}:00`);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (end.getHours() > 20 || (end.getHours() === 20 && end.getMinutes() > 0)) continue;
      const busy = rows.some(
        (row) =>
          row.doctorId === doctorId &&
          SLOT_HOLDING_STATUSES.has(row.status) &&
          start < wallClockToDate(row.endAt) &&
          end > wallClockToDate(row.startAt)
      );
      if (!busy) suggestions.push(slot);
      if (suggestions.length >= 3) break;
    }
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

/** Free starts for a busy slot, from that doctor's visits of that day as the server has them now. */
export async function loadSuggestedTimes(
  api: Pick<AppointmentsPageApi, "listAppointments">,
  token: string,
  slot: SlotRequest
): Promise<string[]> {
  const rows = await api.listAppointments(token, { from: slot.dateYmd, to: slot.dateYmd, doctorId: slot.doctorId });
  return suggestFreeTimes(rows, slot);
}
