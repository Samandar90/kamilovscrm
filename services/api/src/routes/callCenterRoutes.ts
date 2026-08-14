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

const router = Router();

router.use(requireAuth);
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
