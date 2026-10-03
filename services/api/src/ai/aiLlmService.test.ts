import { afterEach, describe, expect, it, vi } from "vitest";
import { printedLines } from "../testing/logFixtures";
import {
  type AiAssistantStructuredContext,
  createEmptyClinicFactsSnapshot,
  summaryFactsFromSnapshot,
} from "./aiTypes";

const create = vi.hoisted(() => vi.fn());
vi.mock("../config/env", () => ({ env: { isProduction: true, dataProvider: "mock", debugAiText: false } }));

/** A chat completion as the OpenAI API returns it. */
const completion = {
  id: "chatcmpl-AbC123",
  object: "chat.completion",
  created: 1759480000,
  model: "gpt-4o-mini-2024-07-18",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "У пациента Каримова три визита.", refusal: null, annotations: [] },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 412,
    completion_tokens: 12,
    total_tokens: 424,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  },
  service_tier: "default",
  system_fingerprint: "fp_abc123",
};

const context: AiAssistantStructuredContext = {
  revenueToday: 0,
  revenue7d: 0,
  unpaidInvoicesCount: 0,
  unpaidInvoicesAmount: 0,
  appointmentsToday: 0,
  completedToday: 0,
  pendingToday: 0,
  avgCheckToday: 0,
  avgCheck7d: 0,
  topDoctor: null,
  cashShiftStatus: "closed",
  noShow30d: 0,
  doctors: [],
  activeServices: [],
};

/** Loads the service with the given OpenAI client module: the client is the external side and no request leaves the process. */
const askAssistant = async (openaiModule: { hasOpenAI: boolean; openai: unknown }) => {
  vi.resetModules();
  vi.doMock("@/lib/openai", () => openaiModule);
  const { completeAssistantChat } = await import("./aiLlmService");
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const answer = await completeAssistantChat(
    summaryFactsFromSnapshot(createEmptyClinicFactsSnapshot()),
    "crm_analytics",
    context,
    [],
    "Сколько визитов было у пациента Каримова?",
    "director"
  );
  return { answer, lines: printedLines(log) };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAI call log", () => {
  it("has the sizes of the prompt and of the answer, not their text", async () => {
    create.mockResolvedValue(completion);
    const { answer, lines } = await askAssistant({ hasOpenAI: true, openai: { chat: { completions: { create } } } });
    expect(answer).toBe("У пациента Каримова три визита.");

    expect(lines).toContain('PROMPT: {"len":53}');
    expect(lines).toContain(
      'AI RESPONSE: {"id":"chatcmpl-AbC123","model":"gpt-4o-mini-2024-07-18","finishReason":"stop","contentLen":31,"promptTokens":412,"completionTokens":12,"totalTokens":424}'
    );
    expect(lines.join("\n")).not.toContain("Каримова");
  });

  it("has only the size of the prompt when there is no OpenAI client", async () => {
    const { answer, lines } = await askAssistant({ hasOpenAI: false, openai: null });
    expect(answer).toBeNull();

    expect(lines).toContain('PROMPT: {"len":53}');
    expect(lines.join("\n")).not.toContain("Каримова");
  });
});
