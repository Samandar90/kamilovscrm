import { afterEach, describe, expect, it, vi } from "vitest";
import { printedLines } from "../testing/logFixtures";

vi.mock("../config/env", () => ({ env: { isProduction: true, dataProvider: "mock", debugAiText: false } }));
vi.mock("@/lib/openai", () => ({ hasOpenAI: false, openai: null }));
import { AIAssistantService } from "./aiAssistantService";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI assistant log of a refused request", () => {
  it("has the role and the message length, not the message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // The reception desk may not ask about money: the hard gate refuses before any data is read.
    const result = await new AIAssistantService().handle(
      { userId: 7, clinicId: 1, username: "reception1", role: "reception" },
      "Какая выручка у Каримова?"
    );
    expect(result.answer).toMatch(/^У вас нет доступа к этой информации/);

    const lines = printedLines(log);
    expect(lines).toContain('[AI] ask path {"path":"hard_gate_block","role":"reception","message":{"len":25}}');
    expect(lines.join("\n")).not.toContain("Каримова");
  });
});
