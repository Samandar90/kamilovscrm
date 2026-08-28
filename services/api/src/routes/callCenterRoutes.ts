import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  addCallRuleController,
  callQueueController,
  listCallRulesController,
  markCallController,
  removeCallRuleController,
} from "../controllers/callCenterController";
import {
  getWorkspaceController, getWorkspaceSettingsController, saveWorkspaceSettingsController,
  previewWorkspaceController, workspaceHistoryController, claimWorkspaceController,
  releaseWorkspaceController, workspaceAttemptController, assignWorkspaceController, savePatientPreferencesController,
} from "../controllers/callCenterWorkspaceController";

const router = Router();

router.use(requireAuth);
router.get("/workspace", checkPermission("callcenter", "read"), asyncHandler(getWorkspaceController));
router.get("/settings", checkPermission("callcenter", "read"), asyncHandler(getWorkspaceSettingsController));
router.put("/settings", checkPermission("callcenter", "update"), asyncHandler(saveWorkspaceSettingsController));
router.post("/preview", checkPermission("callcenter", "read"), asyncHandler(previewWorkspaceController));
router.get("/history", checkPermission("callcenter", "read"), asyncHandler(workspaceHistoryController));
router.post("/claim", checkPermission("callcenter", "update"), asyncHandler(claimWorkspaceController));
router.post("/release", checkPermission("callcenter", "update"), asyncHandler(releaseWorkspaceController));
router.post("/attempts", checkPermission("callcenter", "update"), asyncHandler(workspaceAttemptController));
router.post("/assign", checkPermission("callcenter", "update"), asyncHandler(assignWorkspaceController));
router.put("/patients/:patientId/preferences", checkPermission("callcenter", "update"), asyncHandler(savePatientPreferencesController));
// Очередь и отметки — модуль callcenter (operator + superadmin).
router.get("/rules", checkPermission("callcenter", "read"), asyncHandler(listCallRulesController));
router.get("/queue", checkPermission("callcenter", "read"), asyncHandler(callQueueController));
router.post("/mark", checkPermission("callcenter", "update"), asyncHandler(markCallController));
// Настройка правил — только superadmin, проверка в сервисе (роль не выражается матрицей).
router.post("/rules", checkPermission("callcenter", "read"), asyncHandler(addCallRuleController));
router.delete(
  "/rules/:id",
  checkPermission("callcenter", "read"),
  asyncHandler(removeCallRuleController)
);

export { router as callCenterRouter };
