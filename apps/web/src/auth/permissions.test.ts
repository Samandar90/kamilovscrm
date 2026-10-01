import { describe, expect, it } from "vitest";
import { USER_ROLES, hasPermission, roleHasPermissionKey, type PermissionAction, type UserRole } from "./permissions";
import {
  QUEUE_ROLES,
  canCallQueue,
  canCreateAppointmentWithPatientPicker,
  canIssueQueue,
  canManageQueueDisplays,
  canReadQueue,
} from "./roleGroups";
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
