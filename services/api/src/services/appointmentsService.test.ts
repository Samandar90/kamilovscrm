import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
vi.mock("../config/env", () => ({ env: { isProduction: false } }));
import { AppointmentsService } from "./appointmentsService";
import { MockAppointmentsRepository } from "../repositories/appointmentsRepository";
import { getMockDb } from "../repositories/mockDatabase";
import { allowPermission } from "../middleware/permissionMiddleware";
import type { PermissionKey } from "../auth/permissions";

const operator = { userId: 2, clinicId: 1, username: "operator", role: "operator" as const };
const repository = new MockAppointmentsRepository();
const service = new AppointmentsService(repository);
const input = { patientId: 1, doctorId: 2, serviceId: 3, startAt: "2099-08-27 10:00:00", endAt: "", status: "scheduled" as const, diagnosis: null, treatment: null, notes: null };
const createdAt = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  const db = getMockDb();
  db.patients = [{ id: 1, fullName: "Пациент", phone: null, gender: null, birthDate: null, source: null, notes: null, createdAt, deletedAt: null }];
  db.doctors = [{ id: 2, name: "Врач", speciality: "Терапевт", percent: 10, active: true, createdAt }];
  db.services = [{ id: 3, name: "Консультация", category: "Приём", price: 100000, duration: 30, active: true, createdAt }];
  db.doctorServices = [{ doctorId: 2, serviceId: 3 }];
  db.appointments = [];
  db.appointmentServices = [];
});

describe("operator appointment booking boundary", () => {
  it("allows an operator through the create route permission and persists a scheduled appointment", async () => {
    expect(() => allowPermission("APPOINTMENT_CREATE")({ auth: operator } as Request, {} as Response, () => {})).not.toThrow();
    const saved = await service.create(operator, input);
    expect(saved).toMatchObject({ patientId: 1, doctorId: 2, serviceId: 3, status: "scheduled", endAt: "2099-08-27 10:30:00", price: 100000 });
    expect(await repository.findById(saved.id)).not.toBeNull();
  });
  it.each<PermissionKey>(["PAYMENT_READ", "CASH_READ", "INVOICE_READ", "REPORT_READ", "USERS_READ", "USERS_CREATE", "APPOINTMENT_COMMERCIAL_PRICE", "APPOINTMENT_DELETE"])("still denies operator capability %s", (key) => {
    expect(() => allowPermission(key)({ auth: operator } as Request, {} as Response, () => {})).toThrow();
  });
  it("does not allow operator diagnosis writes while booking", async () => {
    await expect(service.create(operator, { ...input, diagnosis: "Private clinical data" })).rejects.toMatchObject({ status: 403 });
    expect(getMockDb().appointments).toHaveLength(0);
  });
  it.each([100000, 1])("uses catalog pricing for operator booking regardless of supplied primary price %s", async price => {
    const saved = await service.create(operator, { ...input, price });
    expect(saved.price).toBe(100000);
    expect(getMockDb().appointmentServices[0].price).toBe(100000);
  });
  it("uses catalog pricing for every operator service line, including the primary service", async () => {
    getMockDb().services.push({ id: 4, name: "УЗИ", category: "Диагностика", price: 200000, duration: 30, active: true, createdAt });
    getMockDb().doctorServices.push({ doctorId: 2, serviceId: 4 });
    await service.create(operator, { ...input, price: 1, serviceLines: [{ serviceId: 3, price: 2 }, { serviceId: 4, price: 3 }] });
    expect(getMockDb().appointmentServices.map(line => ({ serviceId: line.serviceId, price: line.price }))).toEqual([{ serviceId: 3, price: 100000 }, { serviceId: 4, price: 200000 }]);
  });
});
