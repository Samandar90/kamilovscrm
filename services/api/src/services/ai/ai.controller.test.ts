import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { fakeResponse, pgError, printedLines } from "../../testing/logFixtures";

const append = vi.hoisted(() => vi.fn());
vi.mock("../../config/env", () => ({ env: { isProduction: true, dataProvider: "mock", debugAiText: false } }));
// The container wires every repository to the database, and the assistant calls OpenAI: neither is under test here.
vi.mock("../../container", () => ({ services: {} }));
vi.mock("./ai.service", () => ({
  AIService: class {
    handleMessage = async () => "Записал.";
  },
}));
vi.mock("../aiMessagesService", () => ({ aiMessagesService: { listLastNByUserId: async () => [], append } }));
import { aiAskV2Controller } from "./ai.controller";

const MESSAGE = "Запиши Каримова Алишера на завтра, телефон 901234567";

const ask = async () => {
  const req = {
    body: { message: MESSAGE },
    auth: { userId: 7, clinicId: 1, username: "reception1", role: "reception" },
  } as unknown as Request;
  const { res, sent } = fakeResponse();
  await aiAskV2Controller(req, res);
  return sent;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI assistant (v2) log of a request", () => {
  it("has the role, the verdict and the message length, not the message", async () => {
    append.mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await ask()).toEqual({ status: 200, body: { answer: "Записал.", suggestions: [] } });

    const lines = printedLines(log);
    expect(lines).toContain('[AI V2] ask {"role":"reception","allowed":true,"message":{"len":52}}');
    expect(lines.join("\n")).not.toContain("Каримова");
    expect(lines.join("\n")).not.toContain("901234567");
  });

  it("keeps the message out of the error log when saving it fails", async () => {
    append.mockRejectedValue(
      pgError({
        message: 'null value in column "clinic_id" of relation "ai_messages" violates not-null constraint',
        code: "23502",
        detail: `Failing row contains (41, 7, user, ${MESSAGE}, 2026-10-03 10:00:00+00, null).`,
        table: "ai_messages",
        column: "clinic_id",
        routine: "ExecConstraints",
      })
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await ask()).status).toBe(200);

    const printed = printedLines(error).join("\n");
    expect(printed).toContain("[AI V2] ask failed");
    expect(printed).toContain("23502");
    expect(printed).not.toContain("Каримова");
    expect(printed).not.toContain("901234567");
  });
});
