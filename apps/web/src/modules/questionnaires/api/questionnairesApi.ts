import { requestJson } from "../../../api/http";

/** Mirrors services/api/src/repositories/interfaces/questionnaireTypes.ts. */
export const QUESTION_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "yes_no",
  "single_choice",
  "multi_choice",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export type QuestionnaireQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
};

export type QuestionnaireAnswer = string | number | boolean | string[];
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;

export type QuestionnaireTemplate = {
  id: number;
  title: string;
  description: string | null;
  doctorId: number | null;
  doctorName: string | null;
  questions: QuestionnaireQuestion[];
  active: boolean;
  createdBy: number | null;
  createdByName: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type QuestionnaireTemplateInput = {
  title: string;
  description: string | null;
  doctorId: number | null;
  questions: QuestionnaireQuestion[];
  active: boolean;
};

export type PatientQuestionnaireSummary = {
  id: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
  templateId: number | null;
  title: string;
  appointmentId: number | null;
  doctorId: number | null;
  doctorName: string | null;
  createdBy: number | null;
  createdByName: string | null;
  updatedByName: string | null;
  questionCount: number;
  answeredCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PatientQuestionnaire = PatientQuestionnaireSummary & {
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswers;
};

export type QuestionnaireFilters = {
  patientId?: number;
  templateId?: number;
  doctorId?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type QuestionnaireListResult = {
  items: PatientQuestionnaireSummary[];
  total: number;
};

const toQuery = (filters: QuestionnaireFilters): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const questionnairesApi = {
  listTemplates: (token: string, includeInactive = false) =>
    requestJson<QuestionnaireTemplate[]>(
      `/api/questionnaires/templates${includeInactive ? "?includeInactive=true" : ""}`,
      { token }
    ),

  createTemplate: (token: string, input: QuestionnaireTemplateInput) =>
    requestJson<QuestionnaireTemplate>("/api/questionnaires/templates", { method: "POST", token, body: input }),

  updateTemplate: (token: string, id: number, input: QuestionnaireTemplateInput) =>
    requestJson<QuestionnaireTemplate>(`/api/questionnaires/templates/${id}`, {
      method: "PUT",
      token,
      body: input,
    }),

  list: (token: string, filters: QuestionnaireFilters, signal?: AbortSignal) =>
    requestJson<QuestionnaireListResult>(`/api/questionnaires${toQuery(filters)}`, { token, signal }),

  get: (token: string, id: number) => requestJson<PatientQuestionnaire>(`/api/questionnaires/${id}`, { token }),

  create: (
    token: string,
    input: { patientId: number; templateId: number; appointmentId?: number | null; answers: QuestionnaireAnswers }
  ) => requestJson<PatientQuestionnaire>("/api/questionnaires", { method: "POST", token, body: input }),

  updateAnswers: (token: string, id: number, answers: QuestionnaireAnswers) =>
    requestJson<PatientQuestionnaire>(`/api/questionnaires/${id}`, { method: "PUT", token, body: { answers } }),

  remove: (token: string, id: number) =>
    requestJson<{ success: boolean }>(`/api/questionnaires/${id}`, { method: "DELETE", token }),
};
