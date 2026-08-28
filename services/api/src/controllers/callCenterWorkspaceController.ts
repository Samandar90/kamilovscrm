import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";

// The workspace is durable by design; do not silently use transient demo storage.
const workspace = () => {
  if (env.dataProvider !== "postgres") throw new ApiError(503, "Для рабочего места колл-центра требуется PostgreSQL");
  return services.callCenterWorkspace;
};
export const getWorkspaceController = async (req: Request, res: Response) => res.json(await workspace().workspace(getAuthPayload(req), req.query));
export const getWorkspaceSettingsController = async (req: Request, res: Response) => res.json(await workspace().getSettings(getAuthPayload(req)));
export const saveWorkspaceSettingsController = async (req: Request, res: Response) => res.json(await workspace().saveSettings(getAuthPayload(req), req.body));
export const previewWorkspaceController = async (req: Request, res: Response) => res.json(await workspace().preview(getAuthPayload(req), req.body));
export const workspaceHistoryController = async (req: Request, res: Response) => res.json(await workspace().history(getAuthPayload(req), req.query));
export const claimWorkspaceController = async (req: Request, res: Response) => res.json(await workspace().claim(getAuthPayload(req), req.body ?? {}));
export const releaseWorkspaceController = async (req: Request, res: Response) => res.json(await workspace().release(getAuthPayload(req), req.body ?? {}));
export const workspaceAttemptController = async (req: Request, res: Response) => res.json(await workspace().attempt(getAuthPayload(req), req.body ?? {}));
export const assignWorkspaceController = async (req: Request, res: Response) => res.json(await workspace().assign(getAuthPayload(req), req.body ?? {}));
