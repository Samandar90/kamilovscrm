import { Router } from "express";
// Отдельный алиас: импорт не конфликтует с тем, что уже импортировано из permissionMiddleware ниже.
import { allowPermission as allowQueuePermission } from "../middleware/permissionMiddleware";
import {
  createQueueDisplayController,
  deleteQueueDisplayController,
  listQueueDisplaysController,
  rotateQueueDisplayCodeController,
  updateQueueDisplayController,
} from "../controllers/queueController";
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

// ТВ-экраны: только superadmin. allowPermission не пропускает superadmin автоматически — он указан в QUEUE_DISPLAY_MANAGE явно.
router.get("/displays", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(listQueueDisplaysController));
router.post("/displays", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(createQueueDisplayController));
router.patch("/displays/:id", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(updateQueueDisplayController));
router.delete("/displays/:id", allowQueuePermission("QUEUE_DISPLAY_MANAGE"), asyncHandler(deleteQueueDisplayController));
router.post(
  "/displays/:id/rotate-code",
  allowQueuePermission("QUEUE_DISPLAY_MANAGE"),
  asyncHandler(rotateQueueDisplayCodeController)
);

export { router as queueRouter };
