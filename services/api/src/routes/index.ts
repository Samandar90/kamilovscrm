import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { clinicMetaController } from "../controllers/metaController";
import { clinicMeController, createClinicController } from "../controllers/clinicController";
import { onboardingController } from "../controllers/onboardingController";
import { livenessCheck, readinessCheck } from "../controllers/healthController";
import { aiDebugController } from "../controllers/aiAssistantController";
import { env } from "../config/env";
import { requireAuth } from "../middleware/authMiddleware";
import { requireActiveSubscription } from "../middleware/subscriptionMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { authRouter } from "./authRoutes";
import { platformRouter } from "./platformRoutes";
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
router.use("/platform", platformRouter);
if (env.allowDevBootstrap) {
  router.use("/dev", devRouter);
}

// Гейт подписки на дата-роутах: requireAuth ставит clinic-контекст, затем проверка подписки.
// /auth, /onboarding, /clinic/me, /meta/clinic, /health сюда НЕ входят —
// чтобы при истёкшей подписке можно было войти, увидеть статус и выйти.
const subscriptionGuard = asyncHandler(requireActiveSubscription);
router.use("/users", requireAuth, subscriptionGuard, usersRouter);
router.use("/patients", requireAuth, subscriptionGuard, patientsRouter);
router.use("/doctors", requireAuth, subscriptionGuard, doctorsRouter);
router.use("/appointments", requireAuth, subscriptionGuard, appointmentsRouter);
router.use("/services", requireAuth, subscriptionGuard, servicesRouter);
router.use("/invoices", requireAuth, subscriptionGuard, invoicesRouter);
router.use("/payments", requireAuth, subscriptionGuard, paymentsRouter);
router.use("/expenses", requireAuth, subscriptionGuard, expensesRouter);
router.use("/cash-register", requireAuth, subscriptionGuard, cashRegisterRouter);
router.use("/reports", requireAuth, subscriptionGuard, reportsRouter);
router.use("/ai", requireAuth, subscriptionGuard, aiAssistantRouter);

export { router as rootRouter };

