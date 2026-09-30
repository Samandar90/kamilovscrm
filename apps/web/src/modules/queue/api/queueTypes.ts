/**
 * Mirrors services/api/src/repositories/interfaces/queueTypes.ts (web-facing types) — update both files together.
 * Time fields: `startAt` is clinic WALL CLOCK "YYYY-MM-DD HH:mm:ss" (format it without any time-zone conversion);
 * `issuedAt`, `calledAt`, `serverTime`, `createdAt`, `updatedAt` are real ISO instants (format in `timeZone`).
 */
export type QueueEntryState = "waiting" | "called" | "serving" | "missed" | "done";

export type QueueEntry = {
  appointmentId: number;
  doctorId: number;
  patientId: number;
  patientName: string;
  /** null only for "serving" without a ticket (doctor started the visit directly). */
  number: number | null;
  /** "К-05", "К-123", "07"; null when there is no number. */
  code: string | null;
  state: QueueEntryState;
  startAt: string;
  issuedAt: string | null;
  calledAt: string | null;
  callCount: number;
};

export type QueueDoctorDay = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  prefix: string | null;
  /** in_consultation today (latest by update time). */
  serving: QueueEntry | null;
  /** status arrived (states "waiting" and "called"), by number ascending. */
  waiting: QueueEntry[];
  /** no_show with today's number, by number ascending ("Вернуть в очередь"). */
  missed: QueueEntry[];
  doneCount: number;
};

export type QueueToday = { date: string; timeZone: string; serverTime: string; doctors: QueueDoctorDay[] };

export type QueueTicket = {
  appointmentId: number;
  clinicName: string;
  code: string;
  number: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  issuedAt: string;
  aheadCount: number;
  timeZone: string;
};

export type QueueDisplayLanguage = "uz" | "ru" | "uz_ru";

export type QueueDisplay = {
  id: number;
  name: string;
  /** null = every doctor who has a queue today. */
  doctorIds: number[] | null;
  showNames: boolean;
  language: QueueDisplayLanguage;
  voiceEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QueueDisplayInput = {
  name: string;
  doctorIds: number[] | null;
  showNames: boolean;
  language: QueueDisplayLanguage;
  voiceEnabled: boolean;
};

/** `code` is formatted "XXXXX-XXXXX" and is returned only by create and rotate-code (never stored in clear). */
export type QueueDisplayWithCode = { display: QueueDisplay; code: string };

export type QueueDisplayCabinet = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  current: null | { code: string | null; name: string | null; state: "called" | "serving" };
  /** First 5 entries in state "waiting". */
  waiting: Array<{ code: string; name: string | null }>;
  /** All entries in state "waiting". */
  waitingCount: number;
};

export type QueueDisplayCall = {
  /** `${appointmentId}:${callCount}` — a re-call produces a new key. */
  key: string;
  code: string;
  number: number;
  name: string | null;
  room: string | null;
  doctorName: string;
  calledAt: string;
};

export type QueueDisplayState = {
  serverTime: string;
  timeZone: string;
  clinicName: string;
  display: { name: string; language: QueueDisplayLanguage; voiceEnabled: boolean; showNames: boolean };
  cabinets: QueueDisplayCabinet[];
  /** Last 20 calls of the day, newest first. */
  recentCalls: QueueDisplayCall[];
};
