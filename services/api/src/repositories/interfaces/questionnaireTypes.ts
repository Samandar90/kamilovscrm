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

export const CHOICE_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set(["single_choice", "multi_choice"]);

export type QuestionnaireQuestion = {
  /** Stable key of the question inside its template; answers are keyed by it. */
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  /** Only for choice questions. */
  options?: string[];
};

export type QuestionnaireAnswer = string | number | boolean | string[];
/** Unanswered questions are absent. */
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;

export type QuestionnaireTemplate = {
  id: number;
  title: string;
  description: string | null;
  /** null — template for every doctor of the clinic. */
  doctorId: number | null;
  doctorName: string | null;
  questions: QuestionnaireQuestion[];
  active: boolean;
  createdBy: number | null;
  createdByName: string | null;
  /** Filled questionnaires based on this template. */
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

/** A filled questionnaire keeps a snapshot of the template's title and questions. */
export type PatientQuestionnaire = PatientQuestionnaireSummary & {
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswers;
};

export type PatientQuestionnaireCreateInput = {
  patientId: number;
  templateId: number;
  title: string;
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswers;
  appointmentId: number | null;
  doctorId: number | null;
};

export type QuestionnaireFilters = {
  patientId?: number;
  templateId?: number;
  doctorId?: number;
  /** Patient name / phone or questionnaire title. */
  search?: string;
  /** Clinic calendar dates, YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
};

export type QuestionnaireListResult = {
  items: PatientQuestionnaireSummary[];
  total: number;
};

export type AppointmentContext = {
  patientId: number;
  doctorId: number;
};

export interface IQuestionnairesRepository {
  listTemplates(options: { includeInactive: boolean }): Promise<QuestionnaireTemplate[]>;
  findTemplate(id: number): Promise<QuestionnaireTemplate | null>;
  createTemplate(input: QuestionnaireTemplateInput, userId: number): Promise<QuestionnaireTemplate>;
  updateTemplate(
    id: number,
    input: QuestionnaireTemplateInput,
    userId: number
  ): Promise<QuestionnaireTemplate | null>;
  list(filters: QuestionnaireFilters): Promise<QuestionnaireListResult>;
  findById(id: number): Promise<PatientQuestionnaire | null>;
  create(input: PatientQuestionnaireCreateInput, userId: number): Promise<PatientQuestionnaire>;
  updateAnswers(
    id: number,
    answers: QuestionnaireAnswers,
    userId: number
  ): Promise<PatientQuestionnaire | null>;
  softDelete(id: number): Promise<boolean>;
  patientExists(id: number): Promise<boolean>;
  doctorExists(id: number): Promise<boolean>;
  findAppointmentContext(appointmentId: number): Promise<AppointmentContext | null>;
}
