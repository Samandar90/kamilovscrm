import { describe, expect, it } from "vitest";
import type { Appointment, AppointmentStatus } from "../api/appointmentsFlowApi";
import { buildUnifiedAppointmentActions } from "./appointmentActions";

const t = (key: string) => key;

const appointment = (status: AppointmentStatus): Appointment => ({
  id: 1,
  patientId: 1,
  doctorId: 1,
  serviceId: 1,
  price: null,
  startAt: "2026-09-30 10:00:00",
  endAt: "2026-09-30 10:30:00",
  status,
  billingStatus: "draft",
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt: "2026-09-30 09:00:00",
  updatedAt: "2026-09-30 09:00:00",
});

const actionsFor = (status: AppointmentStatus, flags: { canCreateInvoice?: boolean; hasInvoice?: boolean } = {}) =>
  buildUnifiedAppointmentActions({
    appointment: appointment(status),
    canCreateInvoice: flags.canCreateInvoice ?? false,
    hasInvoice: flags.hasInvoice ?? false,
    t,
  });

describe("buildUnifiedAppointmentActions", () => {
  it("labels the first step «Отметить приход» for booked visits (it moves them to arrived and issues a queue number)", () => {
    expect(actionsFor("scheduled")).toEqual([{ key: "start", label: "appointment.markArrived", tone: "primary" }]);
    expect(actionsFor("confirmed")).toEqual([{ key: "start", label: "appointment.markArrived", tone: "primary" }]);
  });

  it("labels the next step «Начать приём» once the patient has arrived", () => {
    expect(actionsFor("arrived")).toEqual([
      { key: "start", label: "appointmentActions.startConsultation", tone: "primary" },
    ]);
  });

  it("keeps the later stages unchanged", () => {
    expect(actionsFor("in_consultation").map((a) => a.key)).toEqual(["workspace", "complete"]);
    expect(actionsFor("completed", { canCreateInvoice: true }).map((a) => a.key)).toEqual(["workspace", "invoice"]);
    expect(actionsFor("completed", { canCreateInvoice: true, hasInvoice: true }).map((a) => a.key)).toEqual([
      "workspace",
    ]);
    expect(actionsFor("cancelled").map((a) => a.key)).toEqual(["open"]);
    expect(actionsFor("no_show").map((a) => a.key)).toEqual(["open"]);
  });
});
