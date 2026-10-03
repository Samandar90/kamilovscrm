import { describe, expect, it } from "vitest";
import {
  PERMISSION_MODULES,
  USER_ROLES,
  hasPermission,
  roleHasPermissionKey,
  type PermissionAction,
  type UserRole,
} from "./permissions";
import {
  CLINIC_STAFF,
  DASHBOARD_NAV_ROLES,
  QUEUE_ROLES,
  ROLE_LABEL_KEYS,
  canCallQueue,
  canCreateAppointmentWithPatientPicker,
  canIssueQueue,
  canManageQueueDisplays,
  canReadQueue,
  isExternalRole,
} from "./roleGroups";
import ru from "../locales/ru.json";
import uz from "../locales/uz.json";
describe("call-center operator booking", () => {
  it("opens existing-patient booking without granting financial or user administration access", () => {
    expect(canCreateAppointmentWithPatientPicker("operator")).toBe(true);
    expect(hasPermission("operator", "payments", "create")).toBe(false);
    expect(hasPermission("operator", "users", "update")).toBe(false);
  });
});

const ACTIONS: PermissionAction[] = ["read", "create", "update", "delete"];
/** Mirrors the API matrix: services/api/src/auth/permissions.ts (queue module). */
const EXPECTED_QUEUE_ACTIONS: Record<UserRole, PermissionAction[]> = {
  superadmin: ["read", "create", "update", "delete"],
  reception: ["read", "create", "update"],
  doctor: ["read", "update"],
  nurse: ["read", "update"],
  cashier: [],
  operator: [],
  accountant: [],
  manager: ["read"],
  director: ["read"],
  marketer: [],
};

describe("electronic queue permissions", () => {
  it.each(USER_ROLES)("grants %s exactly its queue actions", (role) => {
    expect(ACTIONS.filter((action) => hasPermission(role, "queue", action))).toEqual(EXPECTED_QUEUE_ACTIONS[role]);
  });

  it("lets only superadmin manage TV displays", () => {
    expect(USER_ROLES.filter((role) => roleHasPermissionKey(role, "QUEUE_DISPLAY_MANAGE"))).toEqual(["superadmin"]);
    expect(USER_ROLES.filter((role) => canManageQueueDisplays(role))).toEqual(["superadmin"]);
    expect(canManageQueueDisplays(null)).toBe(false);
    expect(canManageQueueDisplays(undefined)).toBe(false);
  });

  it("derives the queue page roles and action helpers from the matrix", () => {
    expect(QUEUE_ROLES).toEqual(["superadmin", "reception", "doctor", "nurse", "manager", "director"]);
    expect(USER_ROLES.filter((role) => canReadQueue(role))).toEqual(QUEUE_ROLES);
    expect(USER_ROLES.filter((role) => canIssueQueue(role))).toEqual(["superadmin", "reception"]);
    expect(USER_ROLES.filter((role) => canCallQueue(role))).toEqual(["superadmin", "reception", "doctor", "nurse"]);
    expect(canReadQueue(null)).toBe(false);
    expect(canIssueQueue(undefined)).toBe(false);
    expect(canCallQueue(null)).toBe(false);
  });
});

describe("external contractor role", () => {
  it("knows the marketer role and denies it every module and action", () => {
    expect(USER_ROLES).toContain("marketer");
    const granted = PERMISSION_MODULES.flatMap((module) =>
      ACTIONS.filter((action) => hasPermission("marketer", module, action)).map((action) => `${module}.${action}`)
    );
    expect(granted).toEqual([]);
  });

  it("keeps the marketer out of the clinic staff and leaves the staff list as it was", () => {
    expect(CLINIC_STAFF).not.toContain("marketer");
    expect(DASHBOARD_NAV_ROLES).not.toContain("marketer");
    expect(CLINIC_STAFF).toEqual(USER_ROLES.filter((role) => role !== "marketer"));
  });

  it("tells external roles from staff", () => {
    expect(isExternalRole("marketer")).toBe(true);
    expect(isExternalRole("operator")).toBe(false);
    expect(isExternalRole(null)).toBe(false);
  });
});

describe("role labels", () => {
  const textAt = (locale: unknown, key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);

  it.each(USER_ROLES)("names %s in Russian and Uzbek", (role) => {
    const key = ROLE_LABEL_KEYS[role];
    expect(key).toMatch(/^users\.\w+$/);
    for (const locale of [ru, uz]) {
      const text = textAt(locale, key);
      expect(typeof text).toBe("string");
      expect((text as string).trim()).not.toBe("");
    }
  });
});
