import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { ApiError } from "../middleware/errorHandler";
import {
  getUziTemplateController,
  listUziTemplatesController,
} from "../controllers/uziTemplatesController";

/** Бланки доступны только на приёме — тем же ролям, что и рабочее место врача. */
const allowDoctorWorkspaceRoles = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.auth) {
    throw new ApiError(401, "Unauthorized");
  }
  const allowed = ["superadmin", "manager", "doctor", "nurse"];
  if (!allowed.includes(req.auth.role)) {
    throw new ApiError(403, "Недостаточно прав для протоколов УЗИ");
  }
  next();
};

const router = Router();

router.get("/", requireAuth, allowDoctorWorkspaceRoles, asyncHandler(listUziTemplatesController));
router.get(
  "/:templateId",
  requireAuth,
  allowDoctorWorkspaceRoles,
  asyncHandler(getUziTemplateController)
);

export { router as uziTemplatesRouter };
