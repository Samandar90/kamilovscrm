import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/authMiddleware";
import { allowPermission } from "../middleware/permissionMiddleware";
import {
  createQuestionnaireController,
  createQuestionnaireTemplateController,
  deleteQuestionnaireController,
  getQuestionnaireController,
  listQuestionnaireTemplatesController,
  listQuestionnairesController,
  updateQuestionnaireController,
  updateQuestionnaireTemplateController,
} from "../controllers/questionnairesController";
import { validateQuestionnaireIdParam } from "../validators/questionnairesValidators";

const router = Router();

// Шаблоны объявлены до "/:id", чтобы "templates" не разбирался как id анкеты.
router.get(
  "/templates",
  requireAuth,
  allowPermission("QUESTIONNAIRE_READ"),
  asyncHandler(listQuestionnaireTemplatesController)
);
router.post(
  "/templates",
  requireAuth,
  allowPermission("QUESTIONNAIRE_TEMPLATE_MANAGE"),
  asyncHandler(createQuestionnaireTemplateController)
);
router.put(
  "/templates/:id",
  requireAuth,
  allowPermission("QUESTIONNAIRE_TEMPLATE_MANAGE"),
  validateQuestionnaireIdParam,
  asyncHandler(updateQuestionnaireTemplateController)
);

router.get("/", requireAuth, allowPermission("QUESTIONNAIRE_READ"), asyncHandler(listQuestionnairesController));
router.get(
  "/:id",
  requireAuth,
  allowPermission("QUESTIONNAIRE_READ"),
  validateQuestionnaireIdParam,
  asyncHandler(getQuestionnaireController)
);
router.post("/", requireAuth, allowPermission("QUESTIONNAIRE_CREATE"), asyncHandler(createQuestionnaireController));
router.put(
  "/:id",
  requireAuth,
  allowPermission("QUESTIONNAIRE_UPDATE"),
  validateQuestionnaireIdParam,
  asyncHandler(updateQuestionnaireController)
);
router.delete(
  "/:id",
  requireAuth,
  allowPermission("QUESTIONNAIRE_DELETE"),
  validateQuestionnaireIdParam,
  asyncHandler(deleteQuestionnaireController)
);

export { router as questionnairesRouter };
