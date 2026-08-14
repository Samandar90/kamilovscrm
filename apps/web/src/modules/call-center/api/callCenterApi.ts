import { requestJson } from "../../../api/http";

export const CALL_OUTCOMES = ["confirmed", "no_answer", "rescheduled", "cancelled"] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export type CallReminderRule = {
  id: number;
  daysBefore: number;
};

export type CallReminderLog = {
  outcome: CallOutcome;
  note: string | null;
  calledBy: number | null;
  calledByName: string | null;
  calledAt: string;
};

export type CallQueueItem = {
  appointmentId: number;
  daysBefore: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentStatus: string;
  log: CallReminderLog | null;
};

export const callCenterApi = {
  listRules: () => requestJson<CallReminderRule[]>("/api/call-center/rules"),

  addRule: (daysBefore: number) =>
    requestJson<CallReminderRule>("/api/call-center/rules", {
      method: "POST",
      body: { daysBefore },
    }),

  removeRule: (id: number) =>
    requestJson<{ success: boolean }>(`/api/call-center/rules/${id}`, { method: "DELETE" }),

  queue: (date: string) => requestJson<CallQueueItem[]>(`/api/call-center/queue?date=${date}`),

  mark: (input: { appointmentId: number; daysBefore: number; outcome: CallOutcome; note: string | null }) =>
    requestJson<CallReminderLog>("/api/call-center/mark", { method: "POST", body: input }),
};
