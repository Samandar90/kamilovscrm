import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { ApiError } from "../middleware/errorHandler";

export const listCallRulesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.callCenter.listRules(auth));
};

export const addCallRuleController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const rule = await services.callCenter.addRule(auth, (req.body ?? {}).daysBefore);
  return res.status(201).json(rule);
};

export const removeCallRuleController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const removed = await services.callCenter.removeRule(auth, req.params.id);
  return res.status(200).json({ success: removed });
};

export const callQueueController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.callCenter.queue(auth, req.query.date));
};

export const markCallController = async (_req: Request, _res: Response) => {
  // Old logs remain readable; writes must use leased, immutable, guarded attempts.
  throw new ApiError(410, "Используйте обновлённый колл-центр");
};
