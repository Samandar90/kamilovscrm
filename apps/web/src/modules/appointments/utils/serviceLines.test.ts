import { describe, expect, it } from "vitest";
import {
  canChangeAppointmentServices,
  draftLineFor,
  toServiceLineInputs,
  totalDurationMinutes,
  totalPrice,
} from "./serviceLines";

const visit = { doctorId: 2, status: "scheduled" as const, billingStatus: "draft" as const };

describe("service lines of a visit", () => {
  it("drafts a line with the rounded catalog price", () => {
    expect(draftLineFor({ id: 3, name: "УЗИ", price: "150 000", duration: 30 })).toEqual({ serviceId: 3, price: 150000 });
  });

  it("sends prices only for roles with commercial-price access", () => {
    const lines = [{ serviceId: 3, price: 99.6 }, { serviceId: 4, price: 10 }];
    expect(toServiceLineInputs(lines, true)).toEqual([{ serviceId: 3, price: 100 }, { serviceId: 4, price: 10 }]);
    expect(toServiceLineInputs(lines, false)).toEqual([{ serviceId: 3 }, { serviceId: 4 }]);
  });

  it("totals duration and price over every line", () => {
    const lines = [{ serviceId: 3, price: 100 }, { serviceId: 4, price: 50 }, { serviceId: 5, price: 1 }];
    expect(totalDurationMinutes(lines, { 3: { duration: 30 }, 4: { duration: 15 } })).toBe(45);
    expect(totalPrice(lines)).toBe(151);
  });

  it("lets scheduling staff and the visit's own doctor change services until payment or the end", () => {
    for (const role of ["superadmin", "reception", "manager", "operator"] as const) {
      expect(canChangeAppointmentServices({ role }, visit)).toBe(true);
    }
    expect(canChangeAppointmentServices({ role: "doctor", doctorId: 2 }, visit)).toBe(true);
    expect(canChangeAppointmentServices({ role: "doctor", doctorId: 9 }, visit)).toBe(false);
    for (const role of ["nurse", "cashier", "accountant", "director"] as const) {
      expect(canChangeAppointmentServices({ role }, visit)).toBe(false);
    }
    expect(canChangeAppointmentServices({ role: "reception" }, { ...visit, status: "completed" })).toBe(false);
    expect(canChangeAppointmentServices({ role: "reception" }, { ...visit, billingStatus: "paid" })).toBe(false);
    expect(canChangeAppointmentServices(null, visit)).toBe(false);
  });
});
