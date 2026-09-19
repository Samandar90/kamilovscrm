import type { TFunction } from "i18next";
import type {
  QuestionType,
  QuestionnaireAnswer,
  QuestionnaireAnswers,
  QuestionnaireQuestion,
} from "../api/questionnairesApi";

export const QUESTION_TYPE_KEYS: Record<QuestionType, string> = {
  text: "questionnaires.types.text",
  textarea: "questionnaires.types.textarea",
  number: "questionnaires.types.number",
  date: "questionnaires.types.date",
  yes_no: "questionnaires.types.yes_no",
  single_choice: "questionnaires.types.single_choice",
  multi_choice: "questionnaires.types.multi_choice",
};

export const isChoiceQuestion = (type: QuestionType): boolean =>
  type === "single_choice" || type === "multi_choice";

/** Stable, URL-safe key for a new question; answers are stored under it. */
export const newQuestionId = (): string => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Draft value in a form: numbers stay strings while typing, unanswered is undefined. */
export type AnswerDraft = string | boolean | string[] | undefined;
export type AnswerDrafts = Record<string, AnswerDraft>;

export const toDrafts = (answers: QuestionnaireAnswers): AnswerDrafts =>
  Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, typeof value === "number" ? String(value) : value])
  );

/** Sends only answered questions; the API validates types against the template. */
export const toAnswers = (questions: QuestionnaireQuestion[], drafts: AnswerDrafts): QuestionnaireAnswers => {
  const answers: QuestionnaireAnswers = {};
  for (const question of questions) {
    const value = drafts[question.id];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    answers[question.id] = question.type === "number" && typeof value === "string" ? Number(value.replace(",", ".")) : value;
  }
  return answers;
};

export const missingRequired = (questions: QuestionnaireQuestion[], drafts: AnswerDrafts): QuestionnaireQuestion | null =>
  questions.find((question) => {
    if (!question.required) return false;
    const value = drafts[question.id];
    return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  }) ?? null;

export const formatAnswer = (answer: QuestionnaireAnswer | undefined, t: TFunction): string => {
  if (answer === undefined) return "—";
  if (typeof answer === "boolean") return answer ? t("questionnaires.yes") : t("questionnaires.no");
  if (Array.isArray(answer)) return answer.join(", ");
  if (typeof answer === "string" && /^\d{4}-\d{2}-\d{2}$/.test(answer)) {
    const [year, month, day] = answer.split("-");
    return `${day}.${month}.${year}`;
  }
  return String(answer);
};
