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
const admin = { ...operator, role: "superadmin" as const };
const doctor = { ...operator, role: "doctor" as const, doctorId: 2 };

beforeEach(() => {
  const db = getMockDb();
  db.patients = [{ id: 1, fullName: "Пациент", phone: null, gender: null, birthDate: null, source: null, notes: null, createdAt, deletedAt: null }];
  db.doctors = [{ id: 2, name: "Врач", speciality: "Терапевт", percent: 10, active: true, createdAt }];
  db.services = [{ id: 3, name: "Консультация", category: "Приём", price: 100000, duration: 30, active: true, createdAt }];
  db.doctorServices = [{ doctorId: 2, serviceId: 3 }];
  db.appointments = [];
  db.appointmentServices = [];
});

describe("recommended return date", () => {
  it("persists a clinician-supplied date and allows clearing it", async () => {
    const saved = await service.create(admin, { ...input, recommendedReturnDate: "2099-09-10" });
    expect(saved).toMatchObject({ recommendedReturnDate: "2099-09-10" });
    const changed = await service.update(doctor, saved.id, { recommendedReturnDate: "2099-10-01" });
    expect(changed).toMatchObject({ recommendedReturnDate: "2099-10-01" });
    expect(await service.update(doctor, saved.id, { recommendedReturnDate: null })).toMatchObject({ recommendedReturnDate: null });
  });
  it.each(["2099-02-30", "2099-08-27", "2099-08-26", "10.09.2099", 123])("rejects invalid or non-later return date %s without writing", async value => {
    const saved = await service.create(admin, input);
    await expect(service.update(doctor, saved.id, { recommendedReturnDate: value as string })).rejects.toMatchObject({ status: 400 });
    expect((await repository.findById(saved.id))).not.toMatchObject({ recommendedReturnDate: value });
  });
  it("denies an operator setting or clearing the clinical recommendation", async () => {
    await expect(service.create(operator, { ...input, recommendedReturnDate: "2099-09-10" })).rejects.toMatchObject({ status: 403 });
    const saved = await service.create(admin, input);
    await expect(service.update(operator, saved.id, { recommendedReturnDate: "2099-09-10" })).rejects.toMatchObject({ status: 403 });
    await expect(service.update(operator, saved.id, { recommendedReturnDate: null })).rejects.toMatchObject({ status: 403 });
  });
  it("does not allow another doctor to modify the recommendation", async () => {
    const saved = await service.create(admin, input);
    expect(await service.update({ ...doctor, doctorId: 99 }, saved.id, { recommendedReturnDate: "2099-09-10" })).toBeNull();
  });
  it("preserves the date when completing the visit and changing unrelated fields", async () => {
    const saved = await service.create(admin, { ...input, status: "confirmed", recommendedReturnDate: "2099-09-10" });
    expect(await service.update(doctor, saved.id, { status: "completed", diagnosis: "Diagnosis", treatment: "Treatment", recommendedReturnDate: undefined })).toMatchObject({ recommendedReturnDate: "2099-09-10", status: "completed" });
  });
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

describe("multiple services per appointment", () => {
  const reception = { ...operator, role: "reception" as const };
  const addService = (id: number, price: number, duration: number, assigned = true) => {
    getMockDb().services.push({ id, name: `Услуга ${id}`, category: "Приём", price, duration, active: true, createdAt });
    if (assigned) getMockDb().doctorServices.push({ doctorId: 2, serviceId: id });
  };
  const lines = (appointmentId: number) =>
    getMockDb().appointmentServices
      .filter(line => line.appointmentId === appointmentId)
      .map(line => ({ serviceId: line.serviceId, price: line.price, quantity: line.quantity }));

  beforeEach(() => {
    getMockDb().invoices = [];
    addService(4, 200000, 45);
    addService(5, 50000, 15);
  });

  it("books every selected service and sizes the slot to their total duration", async () => {
    const saved = await service.create(reception, { ...input, serviceLines: [{ serviceId: 3 }, { serviceId: 4, price: 180000 }, { serviceId: 5 }] });
    expect(saved.endAt).toBe("2099-08-27 11:30:00");
    expect(lines(saved.id)).toEqual([
      { serviceId: 3, price: 100000, quantity: 1 },
      { serviceId: 4, price: 180000, quantity: 1 },
      { serviceId: 5, price: 50000, quantity: 1 },
    ]);
  });

  it("ignores client prices from roles without commercial price access", async () => {
    getMockDb().patients[0].createdByDoctorId = 2;
    const saved = await service.create(doctor, { ...input, price: 1, serviceLines: [{ serviceId: 3, price: 1 }, { serviceId: 4, price: 1 }] });
    expect(saved.price).toBe(100000);
    expect(lines(saved.id).map(line => line.price)).toEqual([100000, 200000]);
  });

  it("rejects a booked service that is not assigned to the doctor", async () => {
    addService(6, 10000, 10, false);
    await expect(service.create(reception, { ...input, serviceLines: [{ serviceId: 6 }] })).rejects.toMatchObject({ status: 400 });
    expect(getMockDb().appointments).toHaveLength(0);
  });

  it("sums durations of all services when checking availability", async () => {
    await service.create(admin, { ...input, startAt: "2099-08-27 11:00:00" });
    expect(await service.checkAvailability(admin, { doctorId: 2, serviceIds: [3], date: "2099-08-27", time: "10:00" })).toEqual({ available: true });
    expect(await service.checkAvailability(admin, { doctorId: 2, serviceIds: [3, 4], date: "2099-08-27", time: "10:00" })).toEqual({ available: false });
  });

  it("replaces services: new primary, kept custom price, catalog price for new lines, resized slot", async () => {
    const saved = await service.create(reception, { ...input, serviceLines: [{ serviceId: 3 }, { serviceId: 4, price: 180000 }] });
    const updated = await service.replaceServices(reception, saved.id, [{ serviceId: 4 }, { serviceId: 5 }]);
    expect(updated).toMatchObject({ serviceId: 4, price: 180000, endAt: "2099-08-27 11:00:00" });
    expect(lines(saved.id)).toEqual([
      { serviceId: 4, price: 180000, quantity: 1 },
      { serviceId: 5, price: 50000, quantity: 1 },
    ]);
  });

  it("lets commercial roles set line prices but forces catalog prices for an operator", async () => {
    const saved = await service.create(reception, input);
    await service.replaceServices(reception, saved.id, [{ serviceId: 3, price: 90000 }]);
    expect(lines(saved.id)).toEqual([{ serviceId: 3, price: 90000, quantity: 1 }]);
    await service.replaceServices(operator, saved.id, [{ serviceId: 3, price: 1 }, { serviceId: 4, price: 1 }]);
    expect(lines(saved.id).map(line => line.price)).toEqual([90000, 200000]);
  });

  it("refuses a resize that overlaps the doctor's next visit without writing", async () => {
    const first = await service.create(reception, input);
    await service.create(reception, { ...input, startAt: "2099-08-27 10:30:00" });
    await expect(service.replaceServices(reception, first.id, [{ serviceId: 3 }, { serviceId: 4 }])).rejects.toMatchObject({ status: 409 });
    expect(lines(first.id)).toEqual([{ serviceId: 3, price: 100000, quantity: 1 }]);
  });

  it("keeps the visit time once the patient has arrived", async () => {
    const saved = await service.create(reception, input);
    await service.update(reception, saved.id, { status: "arrived" });
    expect(await service.replaceServices(reception, saved.id, [{ serviceId: 3 }, { serviceId: 4 }])).toMatchObject({ endAt: "2099-08-27 10:30:00" });
  });

  it("keeps a booked service that was later removed from the doctor, but validates new ones", async () => {
    const saved = await service.create(reception, { ...input, serviceLines: [{ serviceId: 3 }, { serviceId: 4 }] });
    getMockDb().doctorServices = getMockDb().doctorServices.filter(link => link.serviceId !== 4);
    await expect(service.replaceServices(reception, saved.id, [{ serviceId: 4 }, { serviceId: 5 }])).resolves.toMatchObject({ serviceId: 4 });
    addService(6, 10000, 10, false);
    await expect(service.replaceServices(reception, saved.id, [{ serviceId: 6 }])).rejects.toMatchObject({ status: 400 });
    expect(await service.update(reception, saved.id, { status: "arrived" })).toMatchObject({ status: "arrived" });
  });

  it("blocks changes after completion, payment or invoicing", async () => {
    const completed = await service.create(reception, { ...input, status: "confirmed" });
    await service.update(doctor, completed.id, { status: "completed" });
    await expect(service.replaceServices(reception, completed.id, [{ serviceId: 4 }])).rejects.toMatchObject({ status: 400 });

    const invoiced = await service.create(reception, { ...input, startAt: "2099-08-28 10:00:00" });
    getMockDb().invoices.push({ id: 900, number: "INV-900", patientId: 1, appointmentId: invoiced.id, status: "issued", subtotal: 100000, discount: 0, total: 100000, paidAmount: 0, createdAt, updatedAt: createdAt, deletedAt: null });
    await expect(service.replaceServices(reception, invoiced.id, [{ serviceId: 4 }])).rejects.toMatchObject({ status: 409 });
    expect(lines(invoiced.id)).toEqual([{ serviceId: 3, price: 100000, quantity: 1 }]);

    getMockDb().invoices[0].status = "cancelled";
    await expect(service.replaceServices(reception, invoiced.id, [{ serviceId: 4 }])).resolves.toMatchObject({ serviceId: 4 });
  });

  it("scopes doctors to their own visits and denies nurses and cashiers", async () => {
    const saved = await service.create(reception, input);
    await expect(service.replaceServices(doctor, saved.id, [{ serviceId: 4 }])).resolves.toMatchObject({ serviceId: 4 });
    await expect(service.replaceServices({ ...doctor, doctorId: 99 }, saved.id, [{ serviceId: 3 }])).rejects.toMatchObject({ status: 404 });
    await expect(service.replaceServices({ ...operator, role: "nurse", nurseDoctorId: 2 }, saved.id, [{ serviceId: 3 }])).rejects.toMatchObject({ status: 403 });
    await expect(service.replaceServices({ ...operator, role: "cashier" }, saved.id, [{ serviceId: 3 }])).rejects.toMatchObject({ status: 403 });
  });

  it("changes services only through replaceServices and reschedules using every service", async () => {
    const saved = await service.create(reception, { ...input, serviceLines: [{ serviceId: 3 }, { serviceId: 4 }] });
    await expect(service.update(reception, saved.id, { serviceId: 4 })).rejects.toMatchObject({ status: 400 });
    expect(await service.update(reception, saved.id, { startAt: "2099-08-27 14:00:00" })).toMatchObject({ endAt: "2099-08-27 15:15:00" });
  });
});
