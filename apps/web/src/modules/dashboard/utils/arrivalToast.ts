import type { Appointment } from "../../appointments/api/appointmentsFlowApi";

/** The dashboard's `t` (react-i18next) satisfies this; tests pass a plain function. */
export type ArrivalToastTranslate = (key: string, options?: { code: string }) => string;

/**
 * Toast after the dashboard's «Отметить приход»: «Выдан номер К-05» when the PUT response carries today's queue
 * code, otherwise null (no toast, as before the queue existed).
 */
export function arrivalToastMessage(
  appointment: Pick<Appointment, "queueCode"> | null | undefined,
  t: ArrivalToastTranslate
): string | null {
  const code = appointment?.queueCode?.trim();
  return code ? t("appointments.queue.issued", { code }) : null;
}
