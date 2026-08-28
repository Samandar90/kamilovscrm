import type { ContactAttempt, ContactPreferences, WorkspaceAttemptInput, WorkspaceClaim, WorkspaceCounts, WorkspaceFilters, WorkspaceResult, WorkspaceSettings } from "./callCenterWorkspaceTypes";

export interface ICallCenterWorkspaceRepository {
  getSettings(): Promise<WorkspaceSettings>;
  savePreferences(patientId: number, preferences: ContactPreferences, operatorId: number): Promise<ContactPreferences>;
  saveSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings>;
  workspace(filters: WorkspaceFilters): Promise<WorkspaceResult>;
  preview(settings: WorkspaceSettings): Promise<WorkspaceCounts>;
  history(patientId: number | null, page: number): Promise<{ items: ContactAttempt[]; total: number }>;
  claim(input: WorkspaceClaim): Promise<{ taskId: number }>;
  release(patientId: number, operatorId: number, taskId?: number): Promise<void>;
  attempt(input: WorkspaceAttemptInput): Promise<ContactAttempt>;
  assign(taskId: number, operatorId: number | null): Promise<void>;
}
