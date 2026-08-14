import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  attendanceSummaryController,
  listAttendanceController,
  removeAttendanceController,
  upsertAttendanceController,
} from "../controllers/attendanceController";

const router = Router();

router.use(requireAuth);
router.get("/", checkPermission("attendance", "read"), asyncHandler(listAttendanceController));
router.get(
  "/summary",
  checkPermission("attendance", "read"),
  asyncHandler(attendanceSummaryController)
);
router.put("/", checkPermission("attendance", "update"), asyncHandler(upsertAttendanceController));
router.delete(
  "/:userId/:workDate",
  checkPermission("attendance", "update"),
  asyncHandler(removeAttendanceController)
);

export { router as attendanceRouter };
