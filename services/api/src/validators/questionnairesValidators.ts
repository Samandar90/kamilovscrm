import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import {
  CHOICE_QUESTION_TYPES,
  QUESTION_TYPES,
  type QuestionType,
  type QuestionnaireAnswer,
  type QuestionnaireAnswers,
  type QuestionnaireFilters,
  type QuestionnaireQuestion,
} from "../repositories/interfaces/questionnaireTypes";

export const QUESTIONNAIRE_LIMITS = {
  title: 200,
  description: 2000,
  questions: 100,
  label: 300,
  options: 50,
  option: 200,
  text: 1000,
  textarea: 5000,
  search: 100,
  pageSize: 200,
} as const;

const DEFAULT_PAGE_SIZE = 50;
const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUESTION_TYPE_SET = new Set<string>(QUESTION_TYPES);

const badRequest = (message: string) => new ApiError(400, message);

export const parseRequiredText = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`Поле «${field}» обязательно`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest(`Поле «${field}» — не длиннее ${max} символов`);
  }
  return trimmed;
};

export const parseOptionalText = (value: unknown, field: string, max: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw badRequest(`Поле «${field}» должно быть строкой`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest(`Поле «${field}» — не длиннее ${max} символов`);
  }
  return trimmed === "" ? null : trimmed;
};

export const parsePositiveId = (value: unknown, field: string): number => {
  const id = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw badRequest(`Поле '${field}' должно быть положительным целым числом`);
  }
  return id;
};

const isValidCalendarDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const parseQuestions = (raw: unknown): QuestionnaireQuestion[] => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("Добавьте хотя бы один вопрос");
  }
  if (raw.length > QUESTIONNAIRE_LIMITS.questions) {
    throw badRequest(`В анкете может быть не больше ${QUESTIONNAIRE_LIMITS.questions} вопросов`);
  }
  const ids = new Set<string>();
  return raw.map((item: unknown, index: number) => {
    const position = `Вопрос №${index + 1}`;
    if (!item || typeof item !== "object") {
      throw badRequest(`${position}: неверный формат`);
    }
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!QUESTION_ID_PATTERN.test(id) || ids.has(id)) {
      throw badRequest(`${position}: неверный или повторяющийся идентификатор`);
    }
    ids.add(id);
    const label = parseRequiredText(source.label, position.toLowerCase(), QUESTIONNAIRE_LIMITS.label);
    if (typeof source.type !== "string" || !QUESTION_TYPE_SET.has(source.type)) {
      throw badRequest(`Вопрос «${label}»: неизвестный тип`);
    }
    if (source.required !== undefined && typeof source.required !== "boolean") {
      throw badRequest(`Вопрос «${label}»: признак обязательности должен быть true или false`);
    }
    const type = source.type as QuestionType;
    const question: QuestionnaireQuestion = { id, label, type, required: source.required === true };
    if (CHOICE_QUESTION_TYPES.has(type)) {
      const options = Array.isArray(source.options)
        ? source.options.map((option) => (typeof option === "string" ? option.trim() : ""))
        : [];
      if (options.length < 2 || options.length > QUESTIONNAIRE_LIMITS.options) {
        throw badRequest(`Вопрос «${label}»: нужно от 2 до ${QUESTIONNAIRE_LIMITS.options} вариантов ответа`);
      }
      if (options.some((option) => option === "" || option.length > QUESTIONNAIRE_LIMITS.option)) {
        throw badRequest(
          `Вопрос «${label}»: варианты ответа должны быть непустыми и не длиннее ${QUESTIONNAIRE_LIMITS.option} символов`
        );
      }
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
        throw badRequest(`Вопрос «${label}»: варианты ответа повторяются`);
      }
      question.options = options;
    }
    return question;
  });
};

const isBlankAnswer = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const parseAnswer = (question: QuestionnaireQuestion, value: unknown): QuestionnaireAnswer => {
  const invalid = () => badRequest(`Неверный ответ на вопрос «${question.label}»`);
  switch (question.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") throw invalid();
      const max = question.type === "text" ? QUESTIONNAIRE_LIMITS.text : QUESTIONNAIRE_LIMITS.textarea;
      const trimmed = value.trim();
      if (trimmed.length > max) {
        throw badRequest(`Ответ на вопрос «${question.label}» — не длиннее ${max} символов`);
      }
      return trimmed;
    }
    case "number": {
      const parsed =
        typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
      if (!Number.isFinite(parsed)) throw invalid();
      return parsed;
    }
    case "date":
      if (typeof value !== "string" || !isValidCalendarDate(value)) throw invalid();
      return value;
    case "yes_no":
      if (typeof value !== "boolean") throw invalid();
      return value;
    case "single_choice":
      if (typeof value !== "string" || !question.options?.includes(value)) throw invalid();
      return value;
    case "multi_choice": {
      const options = question.options ?? [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !options.includes(item))) {
        throw invalid();
      }
      // Stored in the template's option order, without duplicates.
      return options.filter((option) => value.includes(option));
    }
  }
};

/** Validates answers against the questions; unanswered questions are left out. */
export const parseAnswers = (raw: unknown, questions: QuestionnaireQuestion[]): QuestionnaireAnswers => {
  const source = raw ?? {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw badRequest("Ответы должны быть объектом");
  }
  const input = source as Record<string, unknown>;
  const knownIds = new Set(questions.map((question) => question.id));
  if (Object.keys(input).some((key) => !knownIds.has(key))) {
    throw badRequest("Есть ответ на вопрос, которого нет в анкете");
  }
  const answers: QuestionnaireAnswers = {};
  for (const question of questions) {
    const value = input[question.id];
    if (isBlankAnswer(value)) {
      if (question.required) {
        throw badRequest(`Ответьте на обязательный вопрос «${question.label}»`);
      }
      continue;
    }
    answers[question.id] = parseAnswer(question, value);
  }
  return answers;
};

const optionalQueryId = (value: unknown, field: string): number | undefined =>
  value === undefined || value === "" ? undefined : parsePositiveId(value, field);

const optionalQueryDate = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !isValidCalendarDate(value)) {
    throw badRequest(`Параметр '${field}' должен быть датой YYYY-MM-DD`);
  }
  return value;
};

const optionalQueryInt = (value: unknown, field: string, min: number, max: number, fallback: number): number => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest(`Параметр '${field}' должен быть целым числом от ${min} до ${max}`);
  }
  return parsed;
};

export const parseQuestionnaireFilters = (query: Request["query"]): QuestionnaireFilters => {
  const search = parseOptionalText(query.search, "search", QUESTIONNAIRE_LIMITS.search) ?? undefined;
  const filters: QuestionnaireFilters = {
    patientId: optionalQueryId(query.patientId, "patientId"),
    templateId: optionalQueryId(query.templateId, "templateId"),
    doctorId: optionalQueryId(query.doctorId, "doctorId"),
    search,
    dateFrom: optionalQueryDate(query.dateFrom, "dateFrom"),
    dateTo: optionalQueryDate(query.dateTo, "dateTo"),
    limit: optionalQueryInt(query.limit, "limit", 1, QUESTIONNAIRE_LIMITS.pageSize, DEFAULT_PAGE_SIZE),
    offset: optionalQueryInt(query.offset, "offset", 0, Number.MAX_SAFE_INTEGER, 0),
  };
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw badRequest("Дата «с» должна быть не позже даты «по»");
  }
  return filters;
};

export const validateQuestionnaireIdParam = (req: Request, _res: Response, next: NextFunction): void => {
  parsePositiveId(req.params.id, "id");
  next();
};
