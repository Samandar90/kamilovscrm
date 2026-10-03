import type { Request, Response } from "express";
import { services } from "../container";
import { errorForLog } from "../utils/logRedaction";
import { getAuthPayload } from "../utils/requestAuth";

export const aiRecommendationsController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  try {
    const result = await services.aiRecommendations.getRecommendations(auth);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[AI RECOMMENDATIONS ERROR]", errorForLog(error));
    return res.status(500).json({
      error: "Не удалось загрузить рекомендации",
    });
  }
};
