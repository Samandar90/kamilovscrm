import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  callNextQueueEntryController,
  callQueueEntryController,
  getQueueTicketController,
  getQueueTodayController,
  issueQueueNumberController,
} from "../controllers/queueController";
import { validateQueueDoctorIdParam, validateQueueIdParam } from "../validators/queueValidators";

const router = Router();

// Свой requireAuth: тесты монтируют роутер напрямую, без index.ts. Врач/медсестра — только своя очередь (сервис).
router.use(requireAuth);
router.get("/today", checkPermission("queue", "read"), asyncHandler(getQueueTodayController));
router.post(
  "/appointments/:id/issue",
  checkPermission("queue", "create"),
  validateQueueIdParam,
  asyncHandler(issueQueueNumberController)
);
router.post(
  "/appointments/:id/call",
  checkPermission("queue", "update"),
  validateQueueIdParam,
  asyncHandler(callQueueEntryController)
);
router.get(
  "/appointments/:id/ticket",
  checkPermission("queue", "read"),
  validateQueueIdParam,
  asyncHandler(getQueueTicketController)
);
router.post(
  "/doctors/:doctorId/call-next",
  checkPermission("queue", "update"),
  validateQueueDoctorIdParam,
  asyncHandler(callNextQueueEntryController)
);

export { router as queueRouter };
