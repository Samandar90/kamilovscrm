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

describe("leads permissions", () => {
  it("has a leads module that reception, operator and manager read and update", () => {
    expect(PERMISSION_MODULES).toContain("leads");
    expect(rolesWithPermission("leads", "read")).toEqual(["superadmin", "reception", "operator", "manager"]);
    expect(rolesWithPermission("leads", "update")).toEqual(["superadmin", "reception", "operator", "manager"]);
    // Leads are created only by the sheet reader and are never deleted: no role is granted these actions.
    expect(rolesWithPermission("leads", "create")).toEqual(["superadmin"]);
    expect(rolesWithPermission("leads", "delete")).toEqual(["superadmin"]);
  });

  it("gives the other roles nothing in the leads module", () => {
    for (const role of ["director", "doctor", "nurse", "cashier", "accountant", "marketer"] as const) {
      for (const action of PERMISSION_ACTIONS) {
        expect(hasPermission(role, "leads", action), `${role} leads.${action}`).toBe(false);
      }
    }
  });

  it("lets only superadmin manage lead sources and only the marketer read own leads", () => {
    expect(PERMISSIONS.LEAD_SOURCES_MANAGE).toEqual(["superadmin"]);
    expect(PERMISSIONS.LEADS_OWN_READ).toEqual(["marketer"]);
    for (const role of USER_ROLES) {
      expect(roleHasPermissionKey(role, "LEAD_SOURCES_MANAGE"), role).toBe(role === "superadmin");
      // allowPermission does not auto-pass superadmin: the owner has no "own leads" either.
      expect(roleHasPermissionKey(role, "LEADS_OWN_READ"), role).toBe(role === "marketer");
    }
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

  it("is in one named permission only: reading own leads", () => {
    const granted = (Object.keys(PERMISSIONS) as PermissionKey[]).filter((key) => roleHasPermissionKey(marketer, key));
    expect(granted).toEqual(["LEADS_OWN_READ"]);
  });

  it("is not derived into patients, appointments or ai read", () => {
    expect(rolesWithPermission("patients", "read")).not.toContain("marketer");
    expect(rolesWithPermission("appointments", "read")).not.toContain("marketer");
    expect(rolesWithPermission("ai", "read")).not.toContain("marketer");
  });
});
