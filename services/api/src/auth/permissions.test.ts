import { describe, expect, it } from "vitest";
import { PERMISSIONS, hasPermission, roleHasPermissionKey, rolesWithPermission } from "./permissions";

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
