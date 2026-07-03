import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { requirePlatformAdmin } from "../middleware/platformMiddleware";
import {
  platformAccessController,
  listClinicsController,
  updateClinicSubscriptionController,
  updateClinicBrandingController,
  updateClinicSmsController,
} from "../controllers/platformController";

const router = Router();

// Доступно любому авторизованному — фронт узнаёт, показывать ли раздел «Платформа».
router.get("/access", requireAuth, asyncHandler(platformAccessController));

// Управление клиниками/подписками — только платформенный админ.
router.get(
  "/clinics",
  requireAuth,
  asyncHandler(requirePlatformAdmin),
  asyncHandler(listClinicsController)
);
router.post(
  "/clinics/:id/subscription",
  requireAuth,
  asyncHandler(requirePlatformAdmin),
  asyncHandler(updateClinicSubscriptionController)
);
router.post(
  "/clinics/:id/branding",
  requireAuth,
  asyncHandler(requirePlatformAdmin),
  asyncHandler(updateClinicBrandingController)
);
router.post(
  "/clinics/:id/sms",
  requireAuth,
  asyncHandler(requirePlatformAdmin),
  asyncHandler(updateClinicSmsController)
);

export { router as platformRouter };
