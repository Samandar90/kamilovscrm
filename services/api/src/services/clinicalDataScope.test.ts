import { describe, expect, it } from "vitest";
import { shouldRedactAppointmentClinicalFields } from "./clinicalDataScope";

describe("shouldRedactAppointmentClinicalFields", () => {
  it("hides diagnosis, treatment and notes from the external contractor", () => {
    expect(shouldRedactAppointmentClinicalFields("marketer")).toBe(true);
  });

  it("keeps them for reception", () => {
    expect(shouldRedactAppointmentClinicalFields("reception")).toBe(false);
  });
});
