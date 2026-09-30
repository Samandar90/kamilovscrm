import type {
  IQueueRepository,
  QueueDayRow,
  QueueDoctorDay,
  QueueDoctorRow,
  QueueEntry,
  QueueEntryState,
} from "../../repositories/interfaces/queueTypes";
import { compareCabinets, formatQueueCode } from "./queueRules";

/** Состояние в очереди выводится из статуса записи — отдельного автомата состояний нет. */
const stateOf = (row: QueueDayRow): QueueEntryState | null => {
  switch (row.status) {
    case "arrived":
      return row.calledAt ? "called" : "waiting";
    case "in_consultation":
      return "serving";
    case "no_show":
      return "missed";
    case "completed":
      return "done";
    default:
      return null;
  }
};

export function toQueueEntry(row: QueueDayRow): QueueEntry | null {
  const state = stateOf(row);
  if (!state) {
    return null;
  }
  return {
    appointmentId: row.appointmentId,
    doctorId: row.doctorId,
    patientId: row.patientId,
    patientName: row.patientName,
    number: row.queueNumber,
    code: row.queueNumber != null ? formatQueueCode(row.queuePrefix, row.queueNumber) : null,
    state,
    startAt: row.startAt,
    issuedAt: row.issuedAt,
    calledAt: row.calledAt,
    callCount: row.callCount,
  };
}

const byNumber = (a: QueueEntry, b: QueueEntry): number =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.appointmentId - b.appointmentId;

export function buildQueueDoctors(rows: QueueDayRow[], doctors: QueueDoctorRow[], alwaysInclude: number[]): QueueDoctorDay[] {
  const entriesByDoctor = new Map<number, QueueEntry[]>();
  const updatedAtMs = new Map<number, number>();
  for (const row of rows) {
    const entry = toQueueEntry(row);
    if (!entry) {
      continue;
    }
    updatedAtMs.set(entry.appointmentId, Date.parse(row.updatedAt));
    const list = entriesByDoctor.get(entry.doctorId);
    if (list) {
      list.push(entry);
    } else {
      entriesByDoctor.set(entry.doctorId, [entry]);
    }
  }

  const include = new Set(alwaysInclude);
  const days: QueueDoctorDay[] = [];
  for (const doctor of doctors) {
    const entries = entriesByDoctor.get(doctor.id) ?? [];
    if (entries.length === 0 && !include.has(doctor.id)) {
      continue;
    }
    // Если «на приёме» несколько (врач не завершил прошлый приём) — показываем последнего по updated_at.
    const serving =
      entries
        .filter((entry) => entry.state === "serving")
        .sort(
          (a, b) =>
            (updatedAtMs.get(b.appointmentId) ?? 0) - (updatedAtMs.get(a.appointmentId) ?? 0) ||
            b.appointmentId - a.appointmentId
        )[0] ?? null;
    days.push({
      doctorId: doctor.id,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      room: doctor.room,
      prefix: doctor.prefix,
      serving,
      waiting: entries.filter((entry) => entry.state === "waiting" || entry.state === "called").sort(byNumber),
      missed: entries.filter((entry) => entry.state === "missed").sort(byNumber),
      doneCount: entries.filter((entry) => entry.state === "done").length,
    });
  }
  return days.sort((a, b) => compareCabinets(a, b));
}

export async function loadQueueDay(
  repo: IQueueRepository,
  clinicId: number,
  day: string,
  doctorFilter: number[] | null,
  alwaysInclude: number[]
): Promise<{ rows: QueueDayRow[]; doctors: QueueDoctorDay[] }> {
  const rows = await repo.listDayRows(clinicId, day, doctorFilter);
  const ids = [...new Set([...rows.map((row) => row.doctorId), ...alwaysInclude])];
  const doctorRows = ids.length > 0 ? await repo.listDoctors(clinicId, ids) : [];
  return { rows, doctors: buildQueueDoctors(rows, doctorRows, alwaysInclude) };
}
