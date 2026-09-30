import type { AppointmentStatus } from "./coreTypes";

/** What an appointment write must do with the queue fields (decided by `planQueueChange`). */
export type QueueDirective = { kind: "keep" } | { kind: "issue"; day: string } | { kind: "clear" };

export type QueueEntryState = "waiting" | "called" | "serving" | "missed" | "done";

export type QueueEntry = {
  appointmentId: number;
  doctorId: number;
  patientId: number;
  patientName: string;
  number: number | null;      // null only for "serving" without a ticket
  code: string | null;        // formatQueueCode(queuePrefix, number) or null
  state: QueueEntryState;
  startAt: string;            // wall clock "YYYY-MM-DD HH:mm:ss"
  issuedAt: string | null;    // ISO instant
  calledAt: string | null;    // ISO instant
  callCount: number;
};

export type QueueDoctorDay = {
  doctorId: number;
  doctorName: string;
  specialty: string;
  room: string | null;
  prefix: string | null;
  serving: QueueEntry | null;  // in_consultation today (latest by updatedAt)
  waiting: QueueEntry[];       // status arrived (states waiting + called), by number asc
  missed: QueueEntry[];        // status no_show with today's number, by number asc
  doneCount: number;           // status completed with today's number
};

export type QueueToday = { date: string; timeZone: string; serverTime: string; doctors: QueueDoctorDay[] };

export type QueueTicket = {
  appointmentId: number; clinicName: string; code: string; number: number; doctorName: string; specialty: string;
  room: string | null; issuedAt: string; aheadCount: number; timeZone: string;
};

/** Repository row for one appointment in a queue day. */
export type QueueDayRow = {
  appointmentId: number; doctorId: number; patientId: number; patientName: string; status: AppointmentStatus;
  startAt: string; queueNumber: number | null; queuePrefix: string | null; queueDate: string | null;
  issuedAt: string | null; calledAt: string | null; callCount: number; updatedAt: string;
};
export type QueueDoctorRow = { id: number; name: string; specialty: string; room: string | null; prefix: string | null };
export type QueueTarget = {
  appointmentId: number; doctorId: number; status: AppointmentStatus; startAt: string;
  queueNumber: number | null; queueDate: string | null;
};

export interface IQueueRepository {
  /** Rows with (queue_date = day AND queue_number NOT NULL) OR (status = in_consultation AND start_at within day); excludes cancelled
   *  and deleted; optional doctor filter (null = all). Ordered by doctor_id, queue_number NULLS LAST, id. */
  listDayRows(clinicId: number, day: string, doctorIds: number[] | null): Promise<QueueDayRow[]>;
  getDayRow(clinicId: number, appointmentId: number): Promise<QueueDayRow | null>;
  listDoctors(clinicId: number, doctorIds: number[]): Promise<QueueDoctorRow[]>;
  findTarget(clinicId: number, appointmentId: number): Promise<QueueTarget | null>;
  /** Transaction: lock row FOR UPDATE; if status <> 'arrived' → ApiError 409; if already numbered for `day` → no-op; else allocate. */
  issue(clinicId: number, appointmentId: number, day: string): Promise<void>;
  /** Sets queue_called_at = now(), queue_call_count + 1 for an arrived row numbered on `day`; false if no row matched. */
  call(clinicId: number, appointmentId: number, day: string): Promise<boolean>;
  /** Calls the lowest-numbered arrived, never-called row of the doctor on `day` (FOR UPDATE SKIP LOCKED); returns its id or null. */
  callNext(clinicId: number, doctorId: number, day: string): Promise<number | null>;
  /** Arrived rows of the doctor on `day` with queue_number < number. */
  countAhead(clinicId: number, doctorId: number, day: string, queueNumber: number): Promise<number>;
  /** clinics.name trimmed, or "Клиника" when empty/missing. */
  clinicName(clinicId: number): Promise<string>;
}

export type QueueDisplayLanguage = "uz" | "ru" | "uz_ru";
export type QueueDisplay = {
  id: number; name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage;
  voiceEnabled: boolean; createdAt: string; updatedAt: string;
};
export type QueueDisplayInput = {
  name: string; doctorIds: number[] | null; showNames: boolean; language: QueueDisplayLanguage; voiceEnabled: boolean;
};
export type QueueDisplayWithCode = { display: QueueDisplay; code: string }; // code formatted "XXXXX-XXXXX", returned ONCE
export type QueueDisplayLookup = {
  display: QueueDisplay; clinicId: number; clinicName: string;
  subscriptionStatus: string | null; subscriptionEndsAt: string | null;
};

export interface IQueueDisplaysRepository {
  list(clinicId: number): Promise<QueueDisplay[]>;                         // revoked excluded, ordered by id
  create(clinicId: number, input: QueueDisplayInput, tokenHash: string, createdBy: number | null): Promise<QueueDisplay>;
  update(clinicId: number, id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay | null>; // bumps updated_at
  revoke(clinicId: number, id: number): Promise<boolean>;                  // sets revoked_at
  rotate(clinicId: number, id: number, tokenHash: string): Promise<QueueDisplay | null>;
  findByTokenHash(tokenHash: string): Promise<QueueDisplayLookup | null>; // NOT clinic scoped; excludes revoked; joins clinics
  existingDoctorIds(clinicId: number, doctorIds: number[]): Promise<number[]>;
}

export type QueueDisplayCabinet = {
  doctorId: number; doctorName: string; specialty: string; room: string | null;
  current: null | { code: string | null; name: string | null; state: "called" | "serving" };
  waiting: Array<{ code: string; name: string | null }>; // first 5 entries in state "waiting"
  waitingCount: number;                                   // all entries in state "waiting"
};
export type QueueDisplayCall = {
  key: string;            // `${appointmentId}:${callCount}`
  code: string; number: number; name: string | null; room: string | null; doctorName: string; calledAt: string;
};
export type QueueDisplayState = {
  serverTime: string; timeZone: string; clinicName: string;
  display: { name: string; language: QueueDisplayLanguage; voiceEnabled: boolean; showNames: boolean };
  cabinets: QueueDisplayCabinet[];
  recentCalls: QueueDisplayCall[]; // last 20 calls of the day (rows with calledAt and number, any status except cancelled), newest first
};
