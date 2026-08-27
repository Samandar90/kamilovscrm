import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import { canCreateAppointmentWithPatientPicker } from "./roleGroups";
describe("call-center operator booking", () => {
  it("opens existing-patient booking without granting financial or user administration access", () => {
    expect(canCreateAppointmentWithPatientPicker("operator")).toBe(true);
    expect(hasPermission("operator", "payments", "create")).toBe(false);
    expect(hasPermission("operator", "users", "update")).toBe(false);
  });
});
