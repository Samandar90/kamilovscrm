import { requestJson } from "../../../api/http";

export type AIAction = {
  type: "navigate" | "open_quick_create_appointment";
  payload?: Record<string, unknown>;
};

export type AIAskResponse = {
  answer: string;
  suggestions?: string[];
  action?: AIAction;
};

export type AISummaryResponse = {
  summaryText: string;
  recommendationText: string;
  cards: Array<{
    key: string;
    label: string;
    value: string;
    tone?: "default" | "success" | "warning" | "info";
  }>;
};

export type AssistantChatHistoryItem = { role: "user" | "assistant"; content: string };

export type AIMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type BusinessInsightDto = {
  type: "warning" | "info" | "success";
  title: string;
  message: string;
  recommendation: string;
  link?: { label: string; path: string };
};

export type AIInsightsResponse = {
  insights: BusinessInsightDto[];
  generatedAt?: string;
  todayFocus?: string[];
  proactiveHeadline?: string | null;
  kpiTeaser?: string | null;
};

export type MorningBriefingResponse = {
  briefing: string;
};

export const aiAssistantService = {
  listMessages: async (): Promise<AIMessageDto[]> => {
    const data = await requestJson<{ messages?: AIMessageDto[] }>("/api/ai/messages");
    return Array.isArray(data.messages) ? data.messages : [];
  },

  clearMessages: async (): Promise<void> => {
    await requestJson<{ ok?: boolean }>("/api/ai/messages", { method: "DELETE" });
  },

  ask: async (message: string): Promise<AIAskResponse> => {
    const payload = await requestJson<AIAskResponse>("/api/ai/ask", {
      method: "POST",
      body: {
        message,
      },
    });
    // eslint-disable-next-line no-console
    console.log("[AI FRONT] ask response", {
      answerLen: payload.answer?.length ?? 0,
      suggestionsCount: payload.suggestions?.length ?? 0,
    });
    return {
      answer: payload.answer ?? "",
      suggestions: payload.suggestions ?? [],
      ...(payload.action ? { action: payload.action } : {}),
    };
  },

  insights: async (): Promise<AIInsightsResponse> => {
    const data = await requestJson<AIInsightsResponse>("/api/ai/insights", { slow: true });
    return {
      insights: Array.isArray(data.insights) ? data.insights : [],
      generatedAt: data.generatedAt,
      todayFocus: Array.isArray(data.todayFocus) ? data.todayFocus : [],
      proactiveHeadline: data.proactiveHeadline ?? null,
      kpiTeaser: data.kpiTeaser ?? null,
    };
  },

  morningBriefing: async (token?: string | null): Promise<MorningBriefingResponse> => {
    return requestJson<MorningBriefingResponse>("/api/ai/morning-briefing", { token, slow: true });
  },

  summary: async (): Promise<AISummaryResponse> => {
    const data = await requestJson<AISummaryResponse>("/api/ai/summary", { slow: true });
    // eslint-disable-next-line no-console
    console.log("[AI FRONT] getSummary response", {
      cards: data.cards?.length ?? 0,
      summaryLen: data.summaryText?.length ?? 0,
    });
    return {
      summaryText: data.summaryText ?? "",
      recommendationText: data.recommendationText ?? "",
      cards: Array.isArray(data.cards) ? data.cards : [],
    };
  },
};
