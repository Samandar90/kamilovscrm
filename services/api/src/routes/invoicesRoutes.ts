import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createInvoiceController,
  createInvoiceFromAppointmentController,
  deleteInvoiceController,
  getInvoiceByIdController,
  listInvoicesController,
  updateInvoiceController,
} from "../controllers/invoicesController";
import {
  validateCreateInvoice,
  validateInvoiceIdParam,
  validateUpdateInvoice,
} from "../validators/invoicesValidators";
import { requireAuth } from "../middleware/authMiddleware";
import { requireFinancialPortalAccess } from "../middleware/doctorFinanceBlockMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "read"),
  asyncHandler(listInvoicesController)
);
router.get(
  "/:id",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "read"),
  validateInvoiceIdParam,
  asyncHandler(getInvoiceByIdController)
);
router.post(
  "/from-appointment",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "create"),
  asyncHandler(createInvoiceFromAppointmentController)
);
router.post(
  "/",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "create"),
  validateCreateInvoice,
  asyncHandler(createInvoiceController)
);
router.put(
  "/:id",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "update"),
  validateInvoiceIdParam,
  validateUpdateInvoice,
  asyncHandler(updateInvoiceController)
);
router.delete(
  "/:id",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("invoices", "delete"),
  validateInvoiceIdParam,
  asyncHandler(deleteInvoiceController)
);

export { router as invoicesRouter };
