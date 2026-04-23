import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  clearFinancialDataController,
  closeCurrentShiftController,
  closeShiftController,
  getActiveShiftController,
  getShiftByIdController,
  getCurrentShiftSummaryController,
  listCashEntriesController,
  openShiftController,
  shiftHistoryController,
} from "../controllers/cashRegisterController";
import {
  validateCloseShift,
  validateEntriesQuery,
  validateOpenShift,
  validateShiftIdParam,
} from "../validators/cashRegisterValidators";
import { requireAuth } from "../middleware/authMiddleware";
import { requireFinancialPortalAccess } from "../middleware/doctorFinanceBlockMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get(
  "/shift/current",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  asyncHandler(getActiveShiftController)
);
router.get(
  "/summary/current",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  asyncHandler(getCurrentShiftSummaryController)
);
router.post(
  "/shift/open",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "update"),
  validateOpenShift,
  asyncHandler(openShiftController)
);
router.post(
  "/shift/close",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "update"),
  validateCloseShift,
  asyncHandler(closeCurrentShiftController)
);

router.post(
  "/shifts/open",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "update"),
  validateOpenShift,
  asyncHandler(openShiftController)
);
router.get(
  "/shifts/active",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  asyncHandler(getActiveShiftController)
);
router.post(
  "/shifts/:id/close",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "update"),
  validateShiftIdParam,
  validateCloseShift,
  asyncHandler(closeShiftController)
);
router.get(
  "/shifts/history",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  asyncHandler(shiftHistoryController)
);
router.get(
  "/shifts/:id",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  validateShiftIdParam,
  asyncHandler(getShiftByIdController)
);
router.get(
  "/entries",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "read"),
  validateEntriesQuery,
  asyncHandler(listCashEntriesController)
);
router.post(
  "/clear",
  requireAuth,
  requireFinancialPortalAccess,
  checkPermission("cash", "update"),
  asyncHandler(clearFinancialDataController)
);

export { router as cashRegisterRouter };
