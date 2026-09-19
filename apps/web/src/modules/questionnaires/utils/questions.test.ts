import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { QuestionnaireQuestion } from "../api/questionnairesApi";
import { formatAnswer, missingRequired, toAnswers, toDrafts } from "./questions";

const questions: QuestionnaireQuestion[] = [
  { id: "complaints", label: "Жалобы", type: "textarea", required: true },
  { id: "weight", label: "Вес", type: "number", required: false },
  { id: "allergy", label: "Аллергия", type: "yes_no", required: false },
  { id: "chronic", label: "Болезни", type: "multi_choice", required: false, options: ["Диабет", "Астма"] },
];
const t = ((key: string) => key) as unknown as TFunction;

describe("questionnaire answers", () => {
  it("sends only answered questions and converts numbers typed with a comma", () => {
    expect(toAnswers(questions, { complaints: "Боль", weight: "72,5", allergy: false, chronic: [] })).toEqual({
      complaints: "Боль",
      weight: 72.5,
      allergy: false,
    });
  });

  it("finds the first unanswered required question", () => {
    expect(missingRequired(questions, { complaints: "" })?.id).toBe("complaints");
    expect(missingRequired(questions, { complaints: "Боль" })).toBeNull();
  });

  it("round-trips stored answers into editable drafts", () => {
    expect(toDrafts({ weight: 70, allergy: true, chronic: ["Астма"] })).toEqual({ weight: "70", allergy: true, chronic: ["Астма"] });
  });

  it("formats answers for reading", () => {
    expect(formatAnswer(true, t)).toBe("questionnaires.yes");
    expect(formatAnswer(["Диабет", "Астма"], t)).toBe("Диабет, Астма");
    expect(formatAnswer("2026-03-02", t)).toBe("02.03.2026");
    expect(formatAnswer(undefined, t)).toBe("—");
  });
});
