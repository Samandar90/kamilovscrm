import { afterEach, describe, expect, it, vi } from "vitest";
import { printedLines } from "../testing/logFixtures";

// The mock data provider: the search runs over the in-memory patients, without PostgreSQL.
vi.mock("../config/env", () => ({ env: { isProduction: true, dataProvider: "mock", debugAiText: false } }));
import { AiRuleEngine } from "./aiRuleEngine";
import { createEmptyClinicFactsSnapshot } from "./aiTypes";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI assistant patient search log", () => {
  it("has the length of the searched text, not the text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const answer = await new AiRuleEngine().answerAskQuick(
      "patient_search",
      createEmptyClinicFactsSnapshot(),
      "Найди пациента Каримов"
    );
    expect(answer).toEqual({ answer: "Пациент не найден." });

    const lines = printedLines(log);
    expect(lines).toContain('[AI] patient_search query {"len":7}');
    expect(lines.join("\n")).not.toContain("Каримов");
  });
});
