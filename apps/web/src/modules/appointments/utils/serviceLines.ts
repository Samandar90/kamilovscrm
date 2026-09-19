import type { PublicUser } from "../../../auth/types";
import { canEditAppointmentServices } from "../../../auth/roleGroups";
import { coercePriceToNumber } from "../../../shared/lib/money";
import type { Appointment, AppointmentServiceLineInput, Service } from "../api/appointmentsFlowApi";

/** A service picked for a visit. The first line is the primary service of the appointment. */
export type ServiceLineDraft = {
  serviceId: number;
  price: number;
};

export const catalogPrice = (service: Pick<Service, "price">): number =>
  Math.round(coercePriceToNumber(service.price));

export const draftLineFor = (service: Service): ServiceLineDraft => ({
  serviceId: service.id,
  price: catalogPrice(service),
});

/** Only roles with commercial-price access send prices; the server prices the rest from the catalog. */
export const toServiceLineInputs = (
  lines: ServiceLineDraft[],
  canSetPrice: boolean
): AppointmentServiceLineInput[] =>
  lines.map((line) =>
    canSetPrice ? { serviceId: line.serviceId, price: Math.round(line.price) } : { serviceId: line.serviceId }
  );

/** Total slot length of the visit; unknown durations count as 0. */
export const totalDurationMinutes = (
  lines: ServiceLineDraft[],
  servicesById: Record<number, Pick<Service, "duration">>
): number => lines.reduce((sum, line) => sum + (servicesById[line.serviceId]?.duration ?? 0), 0);

export const totalPrice = (lines: ServiceLineDraft[]): number =>
  lines.reduce((sum, line) => sum + line.price, 0);

/** Services can change until the visit ends; the API also refuses once an invoice exists. */
const SERVICE_EDITABLE_STATUSES = new Set<Appointment["status"]>([
  "scheduled",
  "confirmed",
  "arrived",
  "in_consultation",
]);

export const canChangeAppointmentServices = (
  user: Pick<PublicUser, "role" | "doctorId"> | null | undefined,
  appointment: Pick<Appointment, "doctorId" | "status" | "billingStatus">
): boolean =>
  canEditAppointmentServices(user?.role) &&
  (user?.role !== "doctor" || (user.doctorId != null && user.doctorId === appointment.doctorId)) &&
  SERVICE_EDITABLE_STATUSES.has(appointment.status) &&
  appointment.billingStatus !== "paid";
