import { queueApi } from "../../queue/api/queueApi";
import type { QueueEntry } from "../../queue/api/queueTypes";
import type { Appointment } from "../api/appointmentsFlowApi";

export type QueueIssueResult = { ok: true; code: string; entry: QueueEntry } | { ok: false; message: string };

/**
 * «Выдать номер»: backfills today's queue number for a visit that is already «Пришёл» but has none
 * (POST /api/queue/appointments/:id/issue, idempotent on the server). Never throws: a refusal comes back as the
 * server's Russian text (409 «Запись не на сегодня», «Номер выдаётся только пришедшему пациенту») or `fallbackMessage`.
 */
export async function issueQueueNumber(appointmentId: number, fallbackMessage: string): Promise<QueueIssueResult> {
  try {
    const { entry } = await queueApi.issue(appointmentId);
    return entry.code ? { ok: true, code: entry.code, entry } : { ok: false, message: fallbackMessage };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : fallbackMessage };
  }
}

/** The row as the page shows it right after «Выдать номер», until the silent reload brings the server's copy. */
export function withIssuedQueueNumber(appointment: Appointment, entry: QueueEntry): Appointment {
  return { ...appointment, queueNumber: entry.number, queueCode: entry.code, queueIssuedAt: entry.issuedAt };
}
