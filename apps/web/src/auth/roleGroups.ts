import type { UserRole } from "./permissions";
import {
  PERMISSIONS,
  USER_ROLES,
  canSetAppointmentCommercialPrice,
  hasPermission,
  roleHasPermissionKey,
  rolesWithPermission,
} from "./permissions";

export { USER_ROLES, hasPermission, rolesWithPermission };

export const CLINIC_STAFF: UserRole[] = [...USER_ROLES];

/** "Dashboard" menu item — excludes nurse and cashier (narrow workspace / finance-only). */
export const DASHBOARD_NAV_ROLES: UserRole[] = CLINIC_STAFF.filter(
  (r) => r !== "nurse" && r !== "cashier"
);

/** Billing navigation and routes: have access to invoices, payments, or cash */
export const BILLING_ROLES = USER_ROLES.filter(
  (r) =>
    hasPermission(r, "invoices", "read") ||
    hasPermission(r, "payments", "read") ||
    hasPermission(r, "cash", "read")
);

export const REPORT_ROLES = rolesWithPermission("reports", "read");
export const EXPENSES_READ_ROLES = rolesWithPermission("expenses", "read");

export const PATIENTS_ROLES = rolesWithPermission("patients", "read");

/** "Patients" page and menu item — operational roles only (API read available for cashier/accountant/director — no card list UI). */
export const PATIENTS_PAGE_ROUTE_ROLES = PATIENTS_ROLES.filter(
  (r) => r !== "cashier" && r !== "accountant" && r !== "director"
);

/** "Payments" route (read-only journal view). */
export const PAYMENTS_READ_PAGE_ROLES = rolesWithPermission("payments", "read");

export const APPOINTMENTS_ROLES = rolesWithPermission("appointments", "read");

/** "Appointments" section in menu and SPA route — excludes accountant and director (API read available for invoice linking). */
export const APPOINTMENTS_PAGE_ROUTE_ROLES = APPOINTMENTS_ROLES.filter(
  (r) => r !== "accountant" && r !== "director"
);

export const DOCTORS_PAGE_ROLES = rolesWithPermission("doctors", "read");

export const SERVICES_PAGE_ROLES = rolesWithPermission("services", "read");

/** "Doctors" / "Services" reference pages — doctor sees only self and own services via API, UI hidden. */
export const DOCTORS_DIRECTORY_ROLES = DOCTORS_PAGE_ROLES.filter((r) => r !== "doctor");
export const SERVICES_DIRECTORY_ROLES = SERVICES_PAGE_ROLES.filter((r) => r !== "doctor");

export const USERS_PAGE_ROLES = rolesWithPermission("users", "read");

export const SYSTEM_ARCH_ROLES = rolesWithPermission("users", "read");

/** Табель посещаемости сотрудников — модуль attendance выдан только superadmin. */
export const ATTENDANCE_ROLES = rolesWithPermission("attendance", "read");

/** Колл-центр: очередь звонков-напоминаний (operator + superadmin). */
export const CALL_CENTER_ROLES = rolesWithPermission("callcenter", "read");

/** База анкет пациентов (общая для всех врачей). */
export const QUESTIONNAIRE_ROLES = rolesWithPermission("questionnaires", "read");

/** Страница «Очередь»: все, у кого есть queue.read (manager/director — только просмотр). */
export const QUEUE_ROLES = rolesWithPermission("queue", "read");

/** «Мои услуги»: врач сам ведёт список своих услуг. */
export const MY_SERVICES_ROLES: UserRole[] = [...PERMISSIONS.DOCTOR_OWN_SERVICES];

export const DOCTOR_WORKSPACE_ROLES: UserRole[] = ["superadmin", "manager", "doctor", "nurse"];

export const canReadBilling = (role: UserRole | undefined | null): boolean =>
  !!role &&
  (hasPermission(role, "invoices", "read") ||
    hasPermission(role, "payments", "read") ||
    hasPermission(role, "cash", "read"));

export const canReadAppointments = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "appointments", "read");

export const canWriteAppointments = (role: UserRole | undefined | null): boolean =>
  !!role &&
  (hasPermission(role, "appointments", "create") ||
    hasPermission(role, "appointments", "update") ||
    hasPermission(role, "appointments", "delete"));

export const canCreateAppointments = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "appointments", "create");

export const canUpdateAppointments = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "appointments", "update");

export const canDeleteAppointments = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "appointments", "delete");

export { canSetAppointmentCommercialPrice };

/** PUT /appointments/:id/services — mirrors SERVICE_EDITOR_ROLES in the API (doctor: own visits only). */
const APPOINTMENT_SERVICE_EDITOR_ROLES: readonly UserRole[] = [
  "superadmin",
  "reception",
  "manager",
  "operator",
  "doctor",
];

export const canEditAppointmentServices = (role: UserRole | undefined | null): boolean =>
  !!role && APPOINTMENT_SERVICE_EDITOR_ROLES.includes(role);

/** Creating appointment with patient picker from directory (modals with autocomplete). */
export const canCreateAppointmentWithPatientPicker = (
  role: UserRole | undefined | null
): boolean => canCreateAppointments(role) && canReadPatients(role);

export const canReadPatients = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "patients", "read");

export const canReadAi = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "ai", "read");

export const canCreatePatients = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "patients", "create");

/**
 * "Quick patient booking" button on dashboard: admin and reception roles only
 * (excludes doctor, call operator, etc.).
 */
export const canUseDashboardQuickPatientBooking = (role: UserRole | undefined | null): boolean =>
  role === "superadmin" || role === "manager" || role === "reception";

export const canUpdatePatients = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "patients", "update");

export const canWriteBilling = (role: UserRole | undefined | null): boolean =>
  !!role &&
  (hasPermission(role, "payments", "create") ||
    hasPermission(role, "invoices", "create") ||
    hasPermission(role, "invoices", "update") ||
    hasPermission(role, "cash", "update"));

/** Payment refund (POST /payments/:id/refund). */
export const canRefundPayments = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "payments", "update");

/** Clinical fields in visit history (aligned with API redaction). */
export const PATIENT_VISIT_CLINICAL_ROLES: UserRole[] = [
  "superadmin",
  "manager",
  "reception",
  "doctor",
  "nurse",
];

export const canViewPatientVisitClinical = (role: UserRole | undefined | null): boolean =>
  !!role && PATIENT_VISIT_CLINICAL_ROLES.includes(role);

export const canCreateQuestionnaires = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "questionnaires", "create");

export const canUpdateQuestionnaires = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "questionnaires", "update");

export const canDeleteQuestionnaires = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "questionnaires", "delete");

export const canManageQuestionnaireTemplates = (role: UserRole | undefined | null): boolean =>
  !!role && roleHasPermissionKey(role, "QUESTIONNAIRE_TEMPLATE_MANAGE");

/** Электронная очередь: просмотр очереди, талон. */
export const canReadQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "read");

/** Выдать номер / вернуть в очередь (регистратура). */
export const canIssueQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "create");

/** Вызвать пациента / «Вызвать следующего» (врач и медсестра — только своя очередь, проверяет API). */
export const canCallQueue = (role: UserRole | undefined | null): boolean =>
  !!role && hasPermission(role, "queue", "update");

/** ТВ-экраны очереди — только superadmin. */
export const canManageQueueDisplays = (role: UserRole | undefined | null): boolean =>
  !!role && roleHasPermissionKey(role, "QUEUE_DISPLAY_MANAGE");
