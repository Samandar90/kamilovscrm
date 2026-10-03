import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { fakeResponse, printedLines } from "../testing/logFixtures";

vi.mock("../config/env", () => ({ env: { isProduction: true, dataProvider: "mock", debugAiText: false } }));
// The container wires every repository to the database; the assistant's answer is not under test here.
vi.mock("../container", () => ({
  services: { aiAssistant: { handle: async () => ({ answer: "Найден: Каримов Алишер.", suggestions: [] }) } },
}));
import { aiAskController } from "./aiAssistantController";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI assistant log of a request", () => {
  it("has the message length and the history size, not the message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const req = {
      body: {
        message: "Найди пациента Каримов",
        history: [{ role: "user", content: "Покажи записи Каримова на сегодня" }],
      },
      auth: { userId: 7, clinicId: 1, username: "reception1", role: "reception" },
    } as unknown as Request;
    const { res, sent } = fakeResponse();
    await aiAskController(req, res);
    expect(sent).toEqual({ status: 200, body: { answer: "Найден: Каримов Алишер.", suggestions: [] } });

    const lines = printedLines(log);
    expect(lines).toContain('[AI] ask intent {"message":{"len":22},"historyLen":1}');
    expect(lines.join("\n")).not.toContain("Каримов");
  });
});
