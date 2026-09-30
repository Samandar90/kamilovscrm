import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";

/** Actions of the staff Queue page; CabinetQueueCard emits them, QueuePage performs them. */
export type QueueAction =
  | { kind: "callNext"; doctorId: number }
  | { kind: "call"; entry: QueueEntry }
  | { kind: "start"; entry: QueueEntry }
  | { kind: "notCame"; entry: QueueEntry }
  | { kind: "returnToQueue"; entry: QueueEntry }
  | { kind: "complete"; entry: QueueEntry }
  | { kind: "openWorkspace"; entry: QueueEntry };

/** The patient «Вызвать следующего» will call: the first never-called entry (the API sorts `waiting` by number). */
export function nextWaiting(day: QueueDoctorDay): QueueEntry | null {
  return day.waiting.find((entry) => entry.state === "waiting") ?? null;
}

/**
 * Whole minutes since the number was issued, on the SERVER clock (a reception PC with a wrong clock must not
 * show "waits 65 min"). `serverTime` is `QueueToday.serverTime` of the snapshot, `clientSkewMs` is the client
 * clock minus the server clock measured when that snapshot arrived, `nowMs` is the current client clock.
 * Server "now" = nowMs - clientSkewMs, but never earlier than `serverTime` (client clock moved backwards).
 * Never negative; null when `issuedAt` is missing or unparsable.
 */
export function waitMinutes(
  issuedAt: string | null,
  serverTime: string,
  clientSkewMs: number,
  nowMs: number
): number | null {
  if (!issuedAt) return null;
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return null;
  const snapshotMs = Date.parse(serverTime);
  const estimatedServerNow = nowMs - clientSkewMs;
  const serverNow = Number.isFinite(snapshotMs) ? Math.max(snapshotMs, estimatedServerNow) : estimatedServerNow;
  return Math.max(0, Math.floor((serverNow - issuedMs) / 60_000));
}

/**
 * "2026-09-30 10:05:00" → "10:05". `startAt` is clinic WALL CLOCK stored as if UTC, so it is sliced,
 * never passed through Date/Intl (that would shift it by the browser's offset). "—" when unparsable.
 */
export function formatWallTime(startAt: string): string {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(startAt);
  return match ? `${match[1]}:${match[2]}` : "—";
}

/** How notices and confirmations name an entry: its ticket code, or the patient's name when it has no number. */
export function entryLabel(entry: QueueEntry): string {
  return entry.code ?? entry.patientName;
}
