import type { Appointment } from "../api/appointmentsFlowApi";

export type UnifiedAppointmentAction = {
  key: "start" | "complete" | "workspace" | "invoice" | "open";
  label: string;
  tone: "primary" | "secondary";
};

type Params = {
  appointment: Appointment;
  canCreateInvoice: boolean;
  hasInvoice: boolean;
  t?: (key: string) => string;
};

export function buildUnifiedAppointmentActions({
  appointment,
  canCreateInvoice,
  hasInvoice,
  t = (k) => k,
}: Params): UnifiedAppointmentAction[] {
  const actions: UnifiedAppointmentAction[] = [];
  const status = appointment.status;

  if (status === "scheduled" || status === "arrived" || status === "confirmed") {
    actions.push({ key: "start", label: t("appointmentActions.startConsultation"), tone: "primary" });
    return actions;
  }

  if (status === "in_consultation") {
    actions.push({ key: "workspace", label: t("appointmentActions.doctorWorkspace"), tone: "primary" });
    actions.push({ key: "complete", label: t("common.close"), tone: "secondary" });
    return actions;
  }

  if (status === "completed") {
    actions.push({ key: "workspace", label: t("appointmentActions.doctorWorkspace"), tone: "primary" });
    if (canCreateInvoice && !hasInvoice) {
      actions.push({ key: "invoice", label: t("billing.invoice"), tone: "secondary" });
    }
    return actions;
  }

  actions.push({ key: "open", label: t("common.actions.open"), tone: "secondary" });
  return actions;
}
