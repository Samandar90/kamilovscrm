import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  changeUserPasswordController,
  createUserController,
  deleteUserController,
  getUserByIdController,
  impersonateUserController,
  listUsersController,
  toggleUserActiveController,
  updateUserController,
} from "../controllers/usersController";
import { requireAuth } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import {
  validateCreateUser,
  validateChangeUserPassword,
  validateUpdateUser,
  validateUserIdParam,
} from "../validators/usersValidators";

const router = Router();

router.use(requireAuth);
router.get("/", checkPermission("users", "read"), asyncHandler(listUsersController));
router.get("/:id", checkPermission("users", "read"), validateUserIdParam, asyncHandler(getUserByIdController));
router.post("/", checkPermission("users", "create"), validateCreateUser, asyncHandler(createUserController));
router.put(
  "/:id",
  checkPermission("users", "update"),
  validateUserIdParam,
  validateUpdateUser,
  asyncHandler(updateUserController)
);
router.delete(
  "/:id",
  checkPermission("users", "delete"),
  validateUserIdParam,
  asyncHandler(deleteUserController)
);
router.patch(
  "/:id/toggle-active",
  checkPermission("users", "update"),
  validateUserIdParam,
  asyncHandler(toggleUserActiveController)
);
// Только superadmin — проверка внутри services.auth.impersonate (роль не выражается через матрицу permissions).
router.post(
  "/:id/impersonate",
  validateUserIdParam,
  asyncHandler(impersonateUserController)
);
router.patch(
  "/:id/password",
  checkPermission("users", "update"),
  validateUserIdParam,
  validateChangeUserPassword,
  asyncHandler(changeUserPasswordController)
);

export { router as usersRouter };
