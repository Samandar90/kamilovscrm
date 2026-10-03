import type { Request, Response } from "express";
import { AiFactBuilderService } from "../ai/aiFactBuilderService";
import { dbPool } from "../config/database";
import { services } from "../container";
import { ApiError } from "../middleware/errorHandler";
import type { AssistantChatHistoryItem } from "../ai/aiLlmService";
import { errorForLog, textForLog } from "../utils/logRedaction";
import { getAuthPayload } from "../utils/requestAuth";

const FALLBACK_CRM = "Не удалось получить данные CRM";

function parseChatHistory(body: unknown): AssistantChatHistoryItem[] {
  if (!body || typeof body !== "object" || !("history" in body)) return [];
  const h = (body as { history?: unknown }).history;
  if (!Array.isArray(h)) return [];
  const out: AssistantChatHistoryItem[] = [];
  for (const item of h) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role;
    const content = (item as { content?: string }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content: content.trim() });
    }
  }
  return out.slice(-24);
}

export const aiAskController = async (req: Request, res: Response) => {
  try {
    const auth = getAuthPayload(req);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = parseChatHistory(req.body);
    console.log(
      "[AI] ask intent",
      JSON.stringify({ message: textForLog(message), historyLen: history.length })
    );
    if (!message) {
      return res.status(400).json({
        answer: "Пустой запрос",
        suggestions: [],
      });
    }
    const result = await services.aiAssistant.handle(auth, message, history);
    const payload = {
      answer: result.answer,
      suggestions: result.suggestions ?? [],
      ...(result.action ? { action: result.action } : {}),
    };
    console.log("[AI] ask success", JSON.stringify({ answerLen: payload.answer.length, suggestions: payload.suggestions.length }));
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    console.error("[AI] ask controller error (real)", errorForLog(error));
    return res.status(200).json({
      answer: FALLBACK_CRM,
      suggestions: [],
    });
  }
};

export const aiSummaryController = async (req: Request, res: Response) => {
  try {
    const auth = getAuthPayload(req);
    console.log("[AI] summary start");
    const result = await services.aiAssistant.getSummary(auth);
    console.log("[AI] summary ok", JSON.stringify({ cards: result.cards?.length ?? 0 }));
    console.log("[AI] summary cards keys", JSON.stringify({ cardKeys: result.cards?.map((c) => c.key) }));
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    console.error("[AI] summary controller error (real)", errorForLog(error));
    return res.status(200).json({
      summaryText: FALLBACK_CRM,
      recommendationText: "Попробуйте обновить страницу.",
      cards: [],
    });
  }
};

export const aiDebugController = async (_req: Request, res: Response) => {
  try {
    const builder = new AiFactBuilderService();
    const snapshot = await builder.getClinicSnapshot();
    const [paymentsCount, invoicesCount, appointmentsCount, paymentsRows] = await Promise.all([
      dbPool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM payments"),
      dbPool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM invoices"),
      dbPool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM appointments"),
      dbPool.query<{
        id: string;
        invoice_id: string;
        amount: string;
        refunded_amount: string;
        created_at: string;
      }>(
        `SELECT id::text, invoice_id::text, amount::text, COALESCE(refunded_amount, 0)::text AS refunded_amount, created_at::text
         FROM payments
         ORDER BY created_at DESC
         LIMIT 5`
      ),
    ]);

    return res.status(200).json({
      revenueToday: snapshot.revenueToday,
      paymentsCount: Number(paymentsCount.rows[0]?.c ?? 0),
      invoicesCount: Number(invoicesCount.rows[0]?.c ?? 0),
      appointmentsCount: Number(appointmentsCount.rows[0]?.c ?? 0),
      paymentsRows: paymentsRows.rows,
    });
  } catch (error) {
    console.error("[AI DEBUG ERROR FULL]", errorForLog(error));
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
