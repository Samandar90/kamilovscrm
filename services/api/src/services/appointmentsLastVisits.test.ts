import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../config/env", () => ({ env: { isProduction: false } }));
import { AppointmentsService } from "./appointmentsService";
import { MockAppointmentsRepository } from "../repositories/appointmentsRepository";
import { getMockDb, type AppointmentRecord } from "../repositories/mockDatabase";

const service = new AppointmentsService(new MockAppointmentsRepository());
const reception = { userId: 2, clinicId: 1, username: "reception", role: "reception" as const };
const createdAt = "2026-01-01T00:00:00.000Z";
const visit = (
  id: number,
  patientId: number,
  doctorId: number,
  startAt: string,
  status: AppointmentRecord["status"] = "completed"
): AppointmentRecord => ({
  id, patientId, doctorId, serviceId: 3, price: 100000, startAt, endAt: startAt, status, billingStatus: "draft",
  cancelReason: null, cancelledAt: null, cancelledBy: null, diagnosis: null, treatment: null, notes: null,
  createdAt, updatedAt: createdAt,
});

beforeEach(() => {
  getMockDb().appointments = [
    visit(1, 101, 10, "2026-02-01 10:00:00"),
    visit(2, 100, 10, "2026-01-10 09:00:00"),
    visit(3, 100, 11, "2026-03-05 00:30:00"),
    visit(4, 101, 10, "2099-05-01 11:00:00", "scheduled"),
    visit(5, 102, 11, "2026-04-04 12:00:00", "cancelled"),
  ];
});

describe("last visit per patient (mock data provider)", () => {
  it("returns the latest start of every patient, whatever the status, ordered by patient", async () => {
    expect(await service.listLastVisits(reception)).toEqual([
      { patientId: 100, lastVisitAt: "2026-03-05 00:30:00" },
      { patientId: 101, lastVisitAt: "2099-05-01 11:00:00" },
      { patientId: 102, lastVisitAt: "2026-04-04 12:00:00" },
    ]);
  });

  it.each([
    ["doctor", { ...reception, role: "doctor" as const, doctorId: 10 }],
    ["nurse", { ...reception, role: "nurse" as const, nurseDoctorId: 10 }],
  ])("counts only the visits of the %s's own doctor", async (_role, auth) => {
    expect(await service.listLastVisits(auth)).toEqual([
      { patientId: 100, lastVisitAt: "2026-01-10 09:00:00" },
      { patientId: 101, lastVisitAt: "2099-05-01 11:00:00" },
    ]);
  });

  it("refuses a nurse who is not attached to a doctor", async () => {
    await expect(service.listLastVisits({ ...reception, role: "nurse" as const, nurseDoctorId: null })).rejects.toMatchObject({ status: 403 });
  });
});
