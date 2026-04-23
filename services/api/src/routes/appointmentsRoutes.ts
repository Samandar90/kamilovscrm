import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  addAppointmentServiceController,
  cancelAppointmentController,
  checkAvailabilityController,
  completeAppointmentController,
  createAppointmentController,
  deleteAppointmentController,
  getAppointmentByIdController,
  listAppointmentServicesController,
  listAppointmentsController,
  updateAppointmentPriceController,
  updateAppointmentController,
} from "../controllers/appointmentsController";
import {
  validateAppointmentIdParam,
  validateCancelAppointment,
  validateCreateAppointment,
  validateUpdateAppointmentPrice,
  validateUpdateAppointment,
} from "../validators/appointmentsValidators";
import { requireAuth } from "../middleware/authMiddleware";
import { allowPermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get("/", requireAuth, allowPermission("APPOINTMENT_READ"), asyncHandler(listAppointmentsController));
router.get(
  "/check-availability",
  requireAuth,
  allowPermission("APPOINTMENT_READ"),
  asyncHandler(checkAvailabilityController)
);
router.get(
  "/:id",
  requireAuth,
  allowPermission("APPOINTMENT_READ"),
  validateAppointmentIdParam,
  asyncHandler(getAppointmentByIdController)
);
router.post(
  "/",
  requireAuth,
  allowPermission("APPOINTMENT_CREATE"),
  validateCreateAppointment,
  asyncHandler(createAppointmentController)
);
router.put(
  "/:id",
  requireAuth,
  allowPermission("APPOINTMENT_UPDATE"),
  validateAppointmentIdParam,
  validateUpdateAppointment,
  asyncHandler(updateAppointmentController)
);
router.patch(
  "/:id/price",
  requireAuth,
  allowPermission("APPOINTMENT_COMMERCIAL_PRICE"),
  validateAppointmentIdParam,
  validateUpdateAppointmentPrice,
  asyncHandler(updateAppointmentPriceController)
);
router.get(
  "/:id/services",
  requireAuth,
  allowPermission("APPOINTMENT_READ"),
  validateAppointmentIdParam,
  asyncHandler(listAppointmentServicesController)
);
router.post(
  "/:id/services",
  requireAuth,
  allowPermission("APPOINTMENT_UPDATE"),
  validateAppointmentIdParam,
  asyncHandler(addAppointmentServiceController)
);
router.patch(
  "/:id/complete",
  requireAuth,
  allowPermission("APPOINTMENT_UPDATE"),
  validateAppointmentIdParam,
  asyncHandler(completeAppointmentController)
);
router.patch(
  "/:id/cancel",
  requireAuth,
  allowPermission("APPOINTMENT_UPDATE"),
  validateAppointmentIdParam,
  validateCancelAppointment,
  asyncHandler(cancelAppointmentController)
);
router.delete(
  "/:id",
  requireAuth,
  allowPermission("APPOINTMENT_DELETE"),
  validateAppointmentIdParam,
  asyncHandler(deleteAppointmentController)
);

export { router as appointmentsRouter };
