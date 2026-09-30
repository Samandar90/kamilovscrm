import type {
  QueueDayRow,
  QueueDisplay,
  QueueDisplayCabinet,
  QueueDisplayCall,
  QueueDisplayState,
  QueueDoctorDay,
  QueueEntry,
} from "../../repositories/interfaces/queueTypes";
import { compareCabinets, formatQueueCode, maskPatientName } from "./queueRules";

/** Сколько ждущих показывает карточка кабинета на ТВ. */
export const DISPLAY_WAITING_LIMIT = 5;
/** Сколько последних вызовов уходит на ТВ (лента + обнаружение новых вызовов). */
export const DISPLAY_RECENT_CALLS_LIMIT = 20;

const instantMs = (iso: string | null): number => (iso ? Date.parse(iso) : 0);
const byNumber = (a: QueueEntry, b: QueueEntry): number => (a.number ?? 0) - (b.number ?? 0);

/**
 * Публичное состояние ТВ-экрана. Чистая функция: на вход — очередь дня (QueueDoctorDay + сырые строки),
 * на выход — только то, что можно показать в холле. Полное ФИО, телефоны, id пациентов сюда не попадают:
 * имя маскируется ("Имя Ф.") или скрывается целиком (showNames = false).
 */
export function buildDisplayState(input: {
  serverTime: string;
  timeZone: string;
  clinicName: string;
  display: QueueDisplay;
  doctors: QueueDoctorDay[];
  rows: QueueDayRow[];
}): QueueDisplayState {
  const { display } = input;
  const nameOf = (fullName: string): string | null => (display.showNames ? maskPatientName(fullName) : null);

  const cabinets: QueueDisplayCabinet[] = [...input.doctors].sort(compareCabinets).map((doctor) => {
    const latestCalled =
      doctor.waiting
        .filter((entry) => entry.state === "called")
        .sort((a, b) => instantMs(b.calledAt) - instantMs(a.calledAt))[0] ?? null;
    const current: QueueDisplayCabinet["current"] = doctor.serving
      ? { code: doctor.serving.code, name: nameOf(doctor.serving.patientName), state: "serving" }
      : latestCalled
        ? { code: latestCalled.code, name: nameOf(latestCalled.patientName), state: "called" }
        : null;
    const waiting = doctor.waiting.filter((entry) => entry.state === "waiting").sort(byNumber);
    return {
      doctorId: doctor.doctorId,
      doctorName: doctor.doctorName,
      specialty: doctor.specialty,
      room: doctor.room,
      current,
      waiting: waiting
        .slice(0, DISPLAY_WAITING_LIMIT)
        .map((entry) => ({ code: entry.code ?? String(entry.number ?? ""), name: nameOf(entry.patientName) })),
      waitingCount: waiting.length,
    };
  });

  const doctorById = new Map(input.doctors.map((doctor) => [doctor.doctorId, doctor]));
  const recentCalls: QueueDisplayCall[] = input.rows
    .filter((row) => row.calledAt != null && row.queueNumber != null && row.status !== "cancelled")
    .sort((a, b) => instantMs(b.calledAt) - instantMs(a.calledAt))
    .slice(0, DISPLAY_RECENT_CALLS_LIMIT)
    .map((row) => {
      const doctor = doctorById.get(row.doctorId);
      const queueNumber = row.queueNumber as number;
      return {
        key: `${row.appointmentId}:${row.callCount}`,
        code: formatQueueCode(row.queuePrefix, queueNumber),
        number: queueNumber,
        name: nameOf(row.patientName),
        room: doctor?.room ?? null,
        doctorName: doctor?.doctorName ?? "",
        calledAt: row.calledAt as string,
      };
    });

  return {
    serverTime: input.serverTime,
    timeZone: input.timeZone,
    clinicName: input.clinicName,
    display: {
      name: display.name,
      language: display.language,
      voiceEnabled: display.voiceEnabled,
      showNames: display.showNames,
    },
    cabinets,
    recentCalls,
  };
}
