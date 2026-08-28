export const WORKSPACE_CAMPAIGNS = ["base", "recall", "followup", "reminder"] as const;
export const WORKSPACE_OUTCOMES = ["contacted", "confirmed", "no_answer", "callback", "declined", "wrong_number"] as const;
export type WorkspaceCampaign = (typeof WORKSPACE_CAMPAIGNS)[number];
export type WorkspaceOutcome = (typeof WORKSPACE_OUTCOMES)[number];
export type WorkspaceSettings = {
  recallEnabled: boolean; recallDays: number;
  followupEnabled: boolean; followupDays: number; followupMaxDays: number;
  returnLeadDays: number; maxCallsPerDay: number; minContactIntervalMinutes: number;
  reminderEnabled: boolean; reminderDays: number;
  workStart: string; workEnd: string; retryMinutes: number; maxAttempts: number; script: string;
};
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  recallEnabled: true, recallDays: 90, followupEnabled: true, followupDays: 3,
  reminderEnabled: true, reminderDays: 1, workStart: "09:00", workEnd: "18:00",
  retryMinutes: 120, maxAttempts: 3, followupMaxDays: 14, returnLeadDays: 7, maxCallsPerDay: 3, minContactIntervalMinutes: 120,
  script: "Здравствуйте, {patient}! Это клиника. Ваш врач — {doctor}. Последний визит: {lastVisit}. Следующий визит: {nextVisit}. Вам удобно говорить?",
};
export type WorkspaceCounts = Record<WorkspaceCampaign | "callbacks" | "today" | "archive", number>;
export type ContactPreferences = {
  doNotCall: boolean; preferredLanguage: "ru" | "uz" | null;
  preferredCallStart: string | null; preferredCallEnd: string | null;
};
export type ContactBlockReason = "do_not_call" | "no_phone" | "outside_hours" | "daily_limit" | "cooldown" | "callback_scheduled" | null;
export type NamedOption = { id: number; name: string };
export type WorkspacePatient = {
  patientId: number; patientName: string; phone: string | null;
  contactPreferences: ContactPreferences; recommendedReturnDate: string | null;
  reason: "base" | "callback" | "reminder" | "recommended_return" | "recall" | "followup";
  contactBlockReason: ContactBlockReason;
  lastVisitAt: string | null; lastDoctorName: string | null; lastDoctorId: number | null;
  nextAppointmentId: number | null; nextVisitAt: string | null; nextDoctorName: string | null; visitsCount: number;
  taskId: number | null; episodeKey: string; campaign: WorkspaceCampaign; dueAt: string | null;
  status: "new" | "callback" | "done" | "exhausted"; attempts: number;
  assignedTo: number | null; assignedToName: string | null;
  claimedBy: number | null; claimedByName: string | null; claimExpiresAt: string | null;
  lastOutcome: string | null; lastContactAt: string | null;
};
export type WorkspaceFilters = {
  segment: WorkspaceCampaign | "callbacks" | "today" | "archive"; status: "all" | "new" | "callback" | "overdue" | "done";
  search: string; page: number; doctorId: number | null; operatorId: number | null;
};
export type WorkspaceResult = {
  items: WorkspacePatient[]; total: number; page: number; pageSize: 30;
  dailyProgress: { completed: number; pending: number };
  counts: WorkspaceCounts; doctors: NamedOption[]; operators: NamedOption[]; settings: WorkspaceSettings;
};
export type ContactAttempt = {
  id: number; patientId: number; patientName: string; campaign: string; outcome: string;
  note: string | null; calledAt: string; calledByName: string | null; callbackAt: string | null;
};
export type WorkspaceClaim = { patientId: number; campaign: WorkspaceCampaign; episodeKey: string; operatorId: number };
export type WorkspaceAttemptInput = {
  taskId: number; outcome: WorkspaceOutcome; note: string | null; callbackAt: string | null; requestId: string; operatorId: number;
};
