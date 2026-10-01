import { requestJson } from "../../../api/http";
import type {
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayWithCode,
  QueueEntry,
  QueueTicket,
  QueueToday,
} from "./queueTypes";

/**
 * Staff queue endpoints (/api/queue). Like the call-center workspaceApi, the token is taken from storage by
 * requestJson. Failures are HttpError (src/api/http.ts) with the server's Russian `error` text and `status`.
 */
const base = "/api/queue";
export const queueApi = {
  today: (doctorId?: number | null, signal?: AbortSignal) =>
    requestJson<QueueToday>(`${base}/today${doctorId ? `?doctorId=${doctorId}` : ""}`, { signal }),
  issue: (appointmentId: number) =>
    requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/issue`, { method: "POST" }),
  call: (appointmentId: number) =>
    requestJson<{ entry: QueueEntry }>(`${base}/appointments/${appointmentId}/call`, { method: "POST" }),
  callNext: (doctorId: number) =>
    requestJson<{ entry: QueueEntry | null }>(`${base}/doctors/${doctorId}/call-next`, { method: "POST" }),
  ticket: (appointmentId: number) => requestJson<QueueTicket>(`${base}/appointments/${appointmentId}/ticket`),
  listDisplays: () => requestJson<QueueDisplay[]>(`${base}/displays`),
  createDisplay: (input: QueueDisplayInput) =>
    requestJson<QueueDisplayWithCode>(`${base}/displays`, { method: "POST", body: input }),
  updateDisplay: (id: number, patch: Partial<QueueDisplayInput>) =>
    requestJson<QueueDisplay>(`${base}/displays/${id}`, { method: "PATCH", body: patch }),
  deleteDisplay: (id: number) =>
    requestJson<{ success: boolean; id: number }>(`${base}/displays/${id}`, { method: "DELETE" }),
  rotateCode: (id: number) =>
    requestJson<QueueDisplayWithCode>(`${base}/displays/${id}/rotate-code`, { method: "POST" }),
};
