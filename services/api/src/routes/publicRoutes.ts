import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { publicQueueDisplayRateLimit } from "../middleware/publicRateLimit";
import { getPublicQueueDisplayController } from "../controllers/queueController";

// Публичные эндпоинты: без requireAuth и без гейта подписки (ТВ в холле не входит в систему).
// Доступ — только по коду экрана; подписку клиники экрана проверяет сервис (403).
const router = Router();

router.get("/queue-display/:code", publicQueueDisplayRateLimit, asyncHandler(getPublicQueueDisplayController));

export { router as publicRouter };
