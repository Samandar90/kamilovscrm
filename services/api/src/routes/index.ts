import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { clinicMetaController } from "../controllers/metaController";
import { clinicMeController, createClinicController } from "../controllers/clinicController";
import { onboardingController } from "../controllers/onboardingController";
import { livenessCheck, readinessCheck } from "../controllers/healthController";
import { aiDebugController } from "../controllers/aiAssistantController";
import { env } from "../config/env";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { authRouter } from "./authRoutes";
import { devRouter } from "./devRoutes";
import { usersRouter } from "./usersRoutes";
import { patientsRouter } from "./patientsRoutes";
import { doctorsRouter } from "./doctorsRoutes";
import { appointmentsRouter } from "./appointmentsRoutes";
import { servicesRouter } from "./servicesRoutes";
import { invoicesRouter } from "./invoicesRoutes";
import { paymentsRouter } from "./paymentsRoutes";
import { expensesRouter } from "./expensesRoutes";
import { cashRegisterRouter } from "./cashRegisterRoutes";
import { reportsRouter } from "./reportsRoutes";
import { aiAssistantRouter } from "./aiAssistantRoutes";

const router = Router();

router.get("/health", livenessCheck);
router.get("/health/ready", asyncHandler(readinessCheck));
router.post("/onboarding", asyncHandler(onboardingController));
router.get("/meta/clinic", requireAuth, asyncHandler(clinicMetaController));
router.get("/clinic/me", requireAuth, asyncHandler(clinicMeController));
router.post("/clinics", requireAuth, asyncHandler(createClinicController));
router.get(
  "/debug/ai",
  requireAuth,
  checkPermission("users", "read"),
  asyncHandler(aiDebugController)
);

router.use("/auth", authRouter);
if (env.allowDevBootstrap) {
  router.use("/dev", devRouter);
}
router.use("/users", usersRouter);
router.use("/patients", patientsRouter);
router.use("/doctors", doctorsRouter);
router.use("/appointments", appointmentsRouter);
router.use("/services", servicesRouter);
router.use("/invoices", invoicesRouter);
router.use("/payments", paymentsRouter);
router.use("/expenses", expensesRouter);
router.use("/cash-register", cashRegisterRouter);
router.use("/reports", reportsRouter);
router.use("/ai", aiAssistantRouter);

export { router as rootRouter };

