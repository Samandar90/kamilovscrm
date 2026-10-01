import type { AppointmentStatus } from "../../repositories/interfaces/coreTypes";
import type { QueueDirective } from "../../repositories/interfaces/queueTypes";

/** Calendar day "YYYY-MM-DD" of `now` in `timeZone` (Intl en-CA). */
export function clinicToday(timeZone: string, now: Date): string {
  // formatToParts instead of format(): the en-CA pattern has changed between ICU versions, the parts have not.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** "YYYY-MM-DD" + n days (UTC date arithmetic on the calendar string). */
export function addDays(day: string, n: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + n));
  return shifted.toISOString().slice(0, 10);
}

/** "К-05", "К-123", "07"; number padded to 2 digits; prefix upper-cased; null/empty prefix → digits only. */
export function formatQueueCode(prefix: string | null | undefined, queueNumber: number): string {
  const digits = String(queueNumber).padStart(2, "0");
  const letter = (prefix ?? "").trim().toUpperCase();
  return letter ? `${letter}-${digits}` : digits;
}

/** "Фамилия Имя Отчество" → "Имя Ф."; single word → as is; empty → "". Unicode-safe first letter (Array.from), upper-cased. */
export function maskPatientName(fullName: string | null | undefined): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  const initial = (Array.from(words[0])[0] ?? "").toUpperCase();
  return `${words[1]} ${initial}.`;
}

const NUMERIC_ROOM = /^\d+$/;

/** Sort key for cabinets: numeric rooms ascending first, then other rooms (localeCompare "ru"), then null rooms; ties by doctorName. */
export function compareCabinets(
  a: { room: string | null; doctorName: string },
  b: { room: string | null; doctorName: string }
): number {
  const rank = (room: string) => (room === "" ? 2 : NUMERIC_ROOM.test(room) ? 0 : 1);
  const roomA = (a.room ?? "").trim();
  const roomB = (b.room ?? "").trim();
  const byGroup = rank(roomA) - rank(roomB);
  if (byGroup !== 0) return byGroup;
  if (rank(roomA) === 0) {
    const byNumber = Number(roomA) - Number(roomB);
    if (byNumber !== 0) return byNumber;
  } else if (rank(roomA) === 1) {
    const byName = roomA.localeCompare(roomB, "ru");
    if (byName !== 0) return byName;
  }
  return a.doctorName.localeCompare(b.doctorName, "ru");
}

export type QueueSnapshot = { status: AppointmentStatus; doctorId: number; startAt: string; queueNumber: number | null; queueDate: string | null };
export type QueueTargetState = { status: AppointmentStatus; doctorId: number; startAt: string };

/**
 * Rules (current = null for a new appointment):
 *   isToday = next.startAt.slice(0,10) === today
 *   hasToday = current?.queueNumber != null && current.queueDate === today
 *   doctorChanged = current != null && current.doctorId !== next.doctorId
 *   dateChanged = current != null && current.startAt.slice(0,10) !== next.startAt.slice(0,10)
 *   if next.status === "arrived" && isToday:
 *       current?.status === "no_show" → issue; !hasToday → issue; doctorChanged → issue; else keep
 *   if current?.queueNumber != null && (doctorChanged || dateChanged) → clear
 *   else keep
 *   issue → { kind: "issue", day: today }
 */
export function planQueueChange(current: QueueSnapshot | null, next: QueueTargetState, today: string): QueueDirective {
  const isToday = next.startAt.slice(0, 10) === today;
  const hasToday = current != null && current.queueNumber != null && current.queueDate === today;
  const doctorChanged = current != null && current.doctorId !== next.doctorId;
  const dateChanged = current != null && current.startAt.slice(0, 10) !== next.startAt.slice(0, 10);

  if (next.status === "arrived" && isToday) {
    if (current?.status === "no_show" || !hasToday || doctorChanged) {
      return { kind: "issue", day: today };
    }
    return { kind: "keep" };
  }
  if (current != null && current.queueNumber != null && (doctorChanged || dateChanged)) {
    return { kind: "clear" };
  }
  return { kind: "keep" };
}
