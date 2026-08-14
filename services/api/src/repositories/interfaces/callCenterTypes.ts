export const CALL_OUTCOMES = ["confirmed", "no_answer", "rescheduled", "cancelled"] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export type CallReminderRule = {
  id: number;
  /** За сколько дней до приёма звонить (0 = в день приёма). */
  daysBefore: number;
};

export type CallReminderLog = {
  outcome: CallOutcome;
  note: string | null;
  calledBy: number | null;
  calledByName: string | null;
  calledAt: string;
};

/** Одна строка очереди: «позвонить пациенту по записи X (напоминание за N дней)». */
export type CallQueueItem = {
  appointmentId: number;
  daysBefore: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  /** Настенные дата и время приёма. */
  appointmentDate: string;
  appointmentTime: string;
  appointmentStatus: string;
  /** null — звонок ещё не сделан. */
  log: CallReminderLog | null;
};

export type CallMarkInput = {
  appointmentId: number;
  daysBefore: number;
  outcome: CallOutcome;
  note: string | null;
  calledBy: number;
};
