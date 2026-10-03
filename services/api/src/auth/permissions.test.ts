import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  USER_ROLES,
  hasPermission,
  roleHasPermissionKey,
  rolesWithPermission,
  type PermissionKey,
  type UserRole,
} from "./permissions";

describe("queue permissions", () => {
  it("grants the queue module per the electronic queue design", () => {
    expect(rolesWithPermission("queue", "read")).toEqual(["superadmin", "reception", "doctor", "nurse", "manager", "director"]);
    expect(rolesWithPermission("queue", "create")).toEqual(["superadmin", "reception"]);
    expect(rolesWithPermission("queue", "update")).toEqual(["superadmin", "reception", "doctor", "nurse"]);
    expect(rolesWithPermission("queue", "delete")).toEqual(["superadmin"]);
    for (const role of ["cashier", "operator", "accountant"] as const) {
      expect(hasPermission(role, "queue", "read")).toBe(false);
    }
  });

  it("lets only superadmin manage queue displays", () => {
    expect(PERMISSIONS.QUEUE_DISPLAY_MANAGE).toEqual(["superadmin"]);
    expect(roleHasPermissionKey("superadmin", "QUEUE_DISPLAY_MANAGE")).toBe(true);
    expect(roleHasPermissionKey("manager", "QUEUE_DISPLAY_MANAGE")).toBe(false);
    expect(roleHasPermissionKey("reception", "QUEUE_DISPLAY_MANAGE")).toBe(false);
  });
});

describe("marketer (external contractor)", () => {
  const marketer: UserRole = "marketer";

  it("is a known role", () => {
    expect(USER_ROLES).toContain("marketer");
  });

  it("has no permission on any module and action", () => {
    for (const module of PERMISSION_MODULES) {
      for (const action of PERMISSION_ACTIONS) {
        expect(hasPermission(marketer, module, action), `${module}.${action}`).toBe(false);
      }
    }
  });

  it("is in no named permission", () => {
    for (const key of Object.keys(PERMISSIONS) as PermissionKey[]) {
      expect(roleHasPermissionKey(marketer, key), key).toBe(false);
    }
  });

  it("is not derived into patients, appointments or ai read", () => {
    expect(rolesWithPermission("patients", "read")).not.toContain("marketer");
    expect(rolesWithPermission("appointments", "read")).not.toContain("marketer");
    expect(rolesWithPermission("ai", "read")).not.toContain("marketer");
  });
});
