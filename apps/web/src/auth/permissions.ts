/**
 * Дублирует services/api/src/auth/permissions.ts — при смене матрицы обновлять оба файла.
 */
export const USER_ROLES = [
  "superadmin",
  "reception",
  "doctor",
  "nurse",
  "cashier",
  "operator",
  "accountant",
  "manager",
  "director",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSION_MODULES = [
  "patients",
  "doctors",
  "services",
  "appointments",
  "invoices",
  "payments",
  "expenses",
  "cash",
  "reports",
  "users",
  "ai",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = ["read", "create", "update", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

type RoleRule = Partial<Record<PermissionModule, readonly PermissionAction[]>>;

const ROLE_PERMISSIONS: Record<UserRole, RoleRule> = {
  superadmin: {},

  reception: {
    patients: ["read", "create", "update"],
    doctors: ["read"],
    services: ["read"],
    appointments: ["read", "create", "update", "delete"],
    ai: ["read", "create"],
  },

  doctor: {
    patients: ["read", "create"],
    doctors: ["read"],
    services: ["read"],
    appointments: ["read", "create", "update"],
    ai: ["read", "create"],
  },

  nurse: {
    patients: ["read", "create"],
    appointments: ["read", "update"],
    ai: ["read", "create"],
  },

  cashier: {
    patients: ["read"],
    appointments: ["read"],
    invoices: ["read", "update"],
    payments: ["read", "create"],
    expenses: ["read", "create", "update", "delete"],
    cash: ["read", "update"],
    ai: ["read", "create"],
  },

  operator: {
    patients: ["read", "create"],
    appointments: ["read", "update"],
    ai: ["read", "create"],
  },

  accountant: {
    patients: ["read"],
    appointments: ["read"],
    invoices: ["read"],
    payments: ["read"],
    expenses: ["read", "create", "update", "delete"],
    cash: ["read"],
    reports: ["read"],
    ai: ["read", "create"],
  },

  manager: {
    patients: ["read", "create", "update"],
    doctors: ["read"],
    services: ["read"],
    appointments: ["read", "create", "update", "delete"],
    invoices: ["read"],
    payments: ["read"],
    expenses: ["read", "create", "update", "delete"],
    cash: ["read"],
    reports: ["read"],
    ai: ["read", "create"],
  },

  director: {
    patients: ["read"],
    appointments: ["read"],
    invoices: ["read"],
    payments: ["read"],
    expenses: ["read"],
    cash: ["read"],
    reports: ["read"],
    ai: ["read", "create"],
  },
};

export function hasPermission(
  role: UserRole,
  module: PermissionModule,
  action: PermissionAction
): boolean {
  if (role === "superadmin") {
    return true;
  }
  const allowed = ROLE_PERMISSIONS[role]?.[module];
  return Boolean(allowed?.includes(action));
}

export function rolesWithPermission(
  module: PermissionModule,
  action: PermissionAction
): UserRole[] {
  return USER_ROLES.filter((r) => hasPermission(r, module, action));
}

const uniqRoles = (roles: UserRole[]): readonly UserRole[] => [...new Set(roles)];

const roleList = (module: PermissionModule, action: PermissionAction): readonly UserRole[] =>
  rolesWithPermission(module, action);

/** Именованные возможности — зеркало `services/api/src/auth/permissions.ts` → `PERMISSIONS`. */
export const PERMISSIONS = {
  PATIENT_READ: roleList("patients", "read"),
  PATIENT_CREATE: roleList("patients", "create"),
  PATIENT_UPDATE: roleList("patients", "update"),
  PATIENT_DELETE: roleList("patients", "delete"),
  DOCTORS_READ: roleList("doctors", "read"),
  SERVICES_READ: roleList("services", "read"),
  APPOINTMENT_READ: roleList("appointments", "read"),
  APPOINTMENT_CREATE: roleList("appointments", "create"),
  APPOINTMENT_UPDATE: roleList("appointments", "update"),
  APPOINTMENT_DELETE: roleList("appointments", "delete"),
  APPOINTMENT_COMMERCIAL_PRICE: ["superadmin", "reception", "manager"] as const satisfies readonly UserRole[],
  INVOICE_READ: roleList("invoices", "read"),
  PAYMENT_READ: roleList("payments", "read"),
  CASH_READ: roleList("cash", "read"),
  REPORT_READ: roleList("reports", "read"),
  EXPENSE_READ: roleList("expenses", "read"),
  USERS_READ: roleList("users", "read"),
  USERS_CREATE: roleList("users", "create"),
  USERS_UPDATE: roleList("users", "update"),
  USERS_DELETE: roleList("users", "delete"),
  AI_READ: roleList("ai", "read"),
  AI_CREATE: roleList("ai", "create"),
  FINANCIAL_PORTAL_ACCESS: uniqRoles([
    ...rolesWithPermission("invoices", "read"),
    ...rolesWithPermission("payments", "read"),
    ...rolesWithPermission("cash", "read"),
    ...rolesWithPermission("reports", "read"),
  ]),
  DEV_ADMIN_BOOTSTRAP: ["superadmin"] as const satisfies readonly UserRole[],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export function roleHasPermissionKey(role: UserRole, key: PermissionKey): boolean {
  const allowed = PERMISSIONS[key] as readonly UserRole[];
  return allowed.includes(role);
}

/** @deprecated Используйте `PERMISSIONS.APPOINTMENT_COMMERCIAL_PRICE`. */
export const APPOINTMENT_COMMERCIAL_PRICE_ROLES: readonly UserRole[] = PERMISSIONS.APPOINTMENT_COMMERCIAL_PRICE;

export function canSetAppointmentCommercialPrice(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return roleHasPermissionKey(role, "APPOINTMENT_COMMERCIAL_PRICE");
}
