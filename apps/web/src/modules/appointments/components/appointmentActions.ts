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
};

export function buildUnifiedAppointmentActions({
  appointment,
  canCreateInvoice,
  hasInvoice,
}: Params): UnifiedAppointmentAction[] {
  const actions: UnifiedAppointmentAction[] = [];
  const status = appointment.status;

  if (status === "scheduled" || status === "arrived" || status === "confirmed") {
    actions.push({ key: "start", label: "Начать приём", tone: "primary" });
    return actions;
  }

  if (status === "in_consultation") {
    actions.push({ key: "workspace", label: "Рабочее место врача", tone: "primary" });
    actions.push({ key: "complete", label: "Завершить", tone: "secondary" });
    return actions;
  }

  if (status === "completed") {
    actions.push({ key: "workspace", label: "Рабочее место врача", tone: "primary" });
    if (canCreateInvoice && !hasInvoice) {
      actions.push({ key: "invoice", label: "Счёт", tone: "secondary" });
    }
    return actions;
  }

  actions.push({ key: "open", label: "Открыть", tone: "secondary" });
  return actions;
}
