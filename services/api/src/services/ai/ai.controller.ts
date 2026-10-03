import type { Request, Response } from "express";
import { AI_ACCESS_DENIED_MESSAGE, checkAIRequestAccess } from "../../ai/aiAssistantHardGate";
import { AIService } from "./ai.service";
import { services } from "../../container";
import { aiMessagesService } from "../aiMessagesService";
import { errorForLog, textForLog } from "../../utils/logRedaction";
import { getAuthPayload } from "../../utils/requestAuth";

const aiService = new AIService({
  patientsService: services.patients,
  doctorsService: services.doctors,
  servicesService: services.services,
  appointmentsService: services.appointments,
  invoicesService: services.invoices,
  paymentsService: services.payments,
  cashRegisterService: services.cashRegister,
  reportsService: services.reports,
});

const AI_ERROR_ANSWER = "Не удалось получить ответ. Попробуйте ещё раз.";

export const aiAskV2Controller = async (req: Request, res: Response) => {
  try {
    const auth = getAuthPayload(req);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      return res.status(400).json({ answer: "Пустой запрос", suggestions: [] });
    }

    const chatHistory = await aiMessagesService.listLastNByUserId(auth.userId, 10);
    await aiMessagesService.append(auth.userId, "user", message);

    const allowed = checkAIRequestAccess(auth.role, message);
    console.log("[AI V2] ask", JSON.stringify({ role: auth.role, allowed, message: textForLog(message) }));
    if (!allowed) {
      await aiMessagesService.append(auth.userId, "assistant", AI_ACCESS_DENIED_MESSAGE);
      return res.status(200).json({
        answer: AI_ACCESS_DENIED_MESSAGE,
        message: AI_ACCESS_DENIED_MESSAGE,
        suggestions: [],
      });
    }

    let answer: string;
    try {
      answer = await aiService.handleMessage(message, auth, chatHistory);
    } catch (error) {
      console.error("[AI V2] handleMessage failed", errorForLog(error));
      answer = AI_ERROR_ANSWER;
    }

    await aiMessagesService.append(auth.userId, "assistant", answer);
    return res.status(200).json({ answer, suggestions: [] });
  } catch (error) {
    console.error("[AI V2] ask failed", errorForLog(error));
    try {
      const auth = getAuthPayload(req);
      await aiMessagesService.append(auth.userId, "assistant", AI_ERROR_ANSWER);
    } catch {
      /* ignore */
    }
    return res.status(200).json({ answer: AI_ERROR_ANSWER, suggestions: [] });
  }
};
