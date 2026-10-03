import { Router } from "express";
import {
  checkLeadSourceSheetController,
  createLeadSourceController,
  getLeadPatientMatchesController,
  listLeadSourcesController,
  listLeadsController,
  listMyLeadsController,
  manageLeadSourcesController,
  setLeadPatientController,
  syncLeadSourceSheetController,
  updateLeadController,
  updateLeadSourceController,
} from "../controllers/leadsController";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { allowPermission, checkPermission } from "../middleware/permissionMiddleware";
import { validateLeadIdParam } from "../validators/leadsValidators";

const router = Router();

// Свой requireAuth, как у очереди: роутер можно монтировать напрямую, без index.ts.
router.use(requireAuth);
router.get("/", checkPermission("leads", "read"), asyncHandler(listLeadsController));

// Таргетолог: единственный адрес с данными. allowPermission не пропускает superadmin автоматически,
// а в LEADS_OWN_READ только marketer. Объявлен до маршрутов с :id.
router.get("/mine", allowPermission("LEADS_OWN_READ"), asyncHandler(listMyLeadsController));

// Источники: список для фильтра — всем, кто читает лиды; управление — только superadmin (он указан в LEAD_SOURCES_MANAGE явно).
router.get("/sources", checkPermission("leads", "read"), asyncHandler(listLeadSourcesController));
router.get("/sources/manage", allowPermission("LEAD_SOURCES_MANAGE"), asyncHandler(manageLeadSourcesController));
router.post("/sources", allowPermission("LEAD_SOURCES_MANAGE"), asyncHandler(createLeadSourceController));
router.patch(
  "/sources/:id",
  allowPermission("LEAD_SOURCES_MANAGE"),
  validateLeadIdParam,
  asyncHandler(updateLeadSourceController)
);
// Таблица источника: проверить без записи и прочитать сейчас.
router.post(
  "/sources/:id/check",
  allowPermission("LEAD_SOURCES_MANAGE"),
  validateLeadIdParam,
  asyncHandler(checkLeadSourceSheetController)
);
router.post(
  "/sources/:id/sync",
  allowPermission("LEAD_SOURCES_MANAGE"),
  validateLeadIdParam,
  asyncHandler(syncLeadSourceSheetController)
);

router.patch("/:id", checkPermission("leads", "update"), validateLeadIdParam, asyncHandler(updateLeadController));
// Пациенты лида: к праву на лиды нужно и чтение пациентов.
router.get(
  "/:id/patient-matches",
  checkPermission("leads", "read"),
  allowPermission("PATIENT_READ"),
  validateLeadIdParam,
  asyncHandler(getLeadPatientMatchesController)
);
router.put(
  "/:id/patient",
  checkPermission("leads", "update"),
  allowPermission("PATIENT_READ"),
  validateLeadIdParam,
  asyncHandler(setLeadPatientController)
);

export { router as leadsRouter };
