import { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  addOwnServiceController,
  createOwnServiceController,
  createServiceController,
  deleteServiceController,
  getServiceByIdController,
  listOwnServicesController,
  listServicesController,
  removeOwnServiceController,
  updateServiceController,
} from "../controllers/servicesController";
import {
  validateCreateService,
  validateServiceIdParam,
  validateUpdateService,
} from "../validators/servicesValidators";
import { requireAuth } from "../middleware/authMiddleware";
import {
  allowServicesReadOrClinicalAssistant,
} from "../middleware/clinicalDirectoryReadMiddleware";
import { allowPermission, checkPermission } from "../middleware/permissionMiddleware";

const router = Router();

/** A doctor's new service is always active and linked only to that doctor (set by the service). */
const forceOwnServiceFields = (req: Request, _res: Response, next: NextFunction): void => {
  req.body = { ...(req.body ?? {}), active: true, doctorIds: [] };
  next();
};

// «Мои услуги» врача. Объявлены до "/:id", чтобы "mine" не разбирался как id.
router.get(
  "/mine",
  requireAuth,
  allowPermission("DOCTOR_OWN_SERVICES"),
  asyncHandler(listOwnServicesController)
);
router.post(
  "/mine",
  requireAuth,
  allowPermission("DOCTOR_OWN_SERVICES"),
  asyncHandler(addOwnServiceController)
);
router.post(
  "/mine/new",
  requireAuth,
  allowPermission("DOCTOR_OWN_SERVICES"),
  forceOwnServiceFields,
  validateCreateService,
  asyncHandler(createOwnServiceController)
);
router.delete(
  "/mine/:serviceId",
  requireAuth,
  allowPermission("DOCTOR_OWN_SERVICES"),
  asyncHandler(removeOwnServiceController)
);

router.get(
  "/",
  requireAuth,
  allowServicesReadOrClinicalAssistant,
  asyncHandler(listServicesController)
);
router.get(
  "/:id",
  requireAuth,
  allowServicesReadOrClinicalAssistant,
  validateServiceIdParam,
  asyncHandler(getServiceByIdController)
);
router.post(
  "/",
  requireAuth,
  checkPermission("services", "create"),
  validateCreateService,
  asyncHandler(createServiceController)
);
router.put(
  "/:id",
  requireAuth,
  checkPermission("services", "update"),
  validateServiceIdParam,
  validateUpdateService,
  asyncHandler(updateServiceController)
);
router.delete(
  "/:id",
  requireAuth,
  checkPermission("services", "delete"),
  validateServiceIdParam,
  asyncHandler(deleteServiceController)
);

export { router as servicesRouter };
