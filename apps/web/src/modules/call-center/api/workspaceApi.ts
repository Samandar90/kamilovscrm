import { requestJson } from "../../../api/http";

export type Campaign = "base" | "recall" | "followup" | "reminder";
export type Segment = Campaign | "callbacks";
export type Outcome = "contacted" | "confirmed" | "no_answer" | "callback" | "declined" | "wrong_number";
export type WorkspaceSettings = {
  recallEnabled: boolean; recallDays: number;
  followupEnabled: boolean; followupDays: number;
  reminderEnabled: boolean; reminderDays: number;
  workStart: string; workEnd: string; retryMinutes: number; maxAttempts: number; script: string;
};
export type NamedOption = { id: number; name: string };
export type WorkspacePatient = {
  patientId: number; patientName: string; phone: string | null;
  lastVisitAt: string | null; lastDoctorName: string | null; lastDoctorId: number | null;
  nextAppointmentId: number | null; nextVisitAt: string | null; nextDoctorName: string | null;
  visitsCount: number; taskId: number | null; episodeKey: string; campaign: Campaign;
  dueAt: string | null; status: "new" | "callback" | "done" | "exhausted"; attempts: number;
  assignedTo: number | null; assignedToName: string | null;
  claimedBy: number | null; claimedByName: string | null; claimExpiresAt: string | null;
  lastOutcome: string | null; lastContactAt: string | null;
};
export type ContactAttempt = {
  id: number; patientId: number; patientName: string; campaign: string; outcome: string;
  note: string | null; calledAt: string; calledByName: string | null; callbackAt: string | null;
};
export type Counts = Record<Segment, number>;
export type WorkspaceResponse = {
  items: WorkspacePatient[]; total: number; page: number; pageSize: number; counts: Counts;
  doctors: NamedOption[]; operators: NamedOption[]; settings: WorkspaceSettings;
};
export type WorkspaceFilters = {
  segment: Segment; search: string; page: number; status: string; doctorId: string; operatorId: string;
};
const base = "/api/call-center";
export const workspaceApi = {
  list: (filters: WorkspaceFilters, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== "") query.set(key, String(value)); });
    return requestJson<WorkspaceResponse>(`${base}/workspace?${query}`, { signal });
  },
  settings: () => requestJson<WorkspaceSettings>(`${base}/settings`),
  saveSettings: (body: WorkspaceSettings) => requestJson<WorkspaceSettings>(`${base}/settings`, { method: "PUT", body }),
  preview: (body: WorkspaceSettings) => requestJson<Counts>(`${base}/preview`, { method: "POST", body }),
  history: (patientId?: number, page = 1, signal?: AbortSignal) =>
    requestJson<{ items: ContactAttempt[]; total: number }>(`${base}/history?page=${page}${patientId ? `&patientId=${patientId}` : ""}`, { signal }),
  claim: (patient: WorkspacePatient) => requestJson<{ taskId: number }>(`${base}/claim`, {
    method: "POST", body: { patientId: patient.patientId, campaign: patient.campaign, episodeKey: patient.episodeKey },
  }),
  release: (patientId: number, taskId?: number) => requestJson<{ success: boolean }>(`${base}/release`, { method: "POST", body: { patientId, taskId } }),
  attempt: (body: { taskId: number; outcome: Outcome; note: string | null; callbackAt: string | null; requestId: string }) =>
    requestJson<ContactAttempt>(`${base}/attempts`, { method: "POST", body }),
  assign: (taskId: number, operatorId: number | null) => requestJson<{ success: boolean }>(`${base}/assign`, {
    method: "POST", body: { taskId, operatorId },
  }),
};
