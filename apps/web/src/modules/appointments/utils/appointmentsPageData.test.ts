import { describe, expect, it, vi } from "vitest";
import type { Appointment, InvoiceSummary } from "../api/appointmentsFlowApi";
import {
  appointmentsLoadRange,
  indexInvoicesByAppointment,
  loadAppointmentsPageData,
  loadSuggestedTimes,
  suggestFreeTimes,
  type AppointmentsPageApi,
} from "./appointmentsPageData";

const invoice = (id: number, appointmentId: number | null): InvoiceSummary => ({
  id, number: `INV-${id}`, patientId: 1, appointmentId, status: "issued",
  subtotal: 100000, discount: 0, total: 100000, paidAmount: 0,
  createdAt: "2026-10-03T05:00:00.000Z", updatedAt: "2026-10-03T05:00:00.000Z",
});
const appointments = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1 }) as Appointment);

const fakeApi = (overrides: Partial<AppointmentsPageApi> = {}): AppointmentsPageApi => ({
  listAppointments: vi.fn().mockResolvedValue(appointments(3)),
  listPatients: vi.fn().mockResolvedValue([{ id: 7 }]),
  listDoctors: vi.fn().mockResolvedValue([{ id: 1, name: "Каримов" }]),
  listServices: vi.fn().mockResolvedValue([{ id: 5 }]),
  listInvoices: vi.fn().mockResolvedValue([invoice(11, 2)]),
  ...overrides,
});
const fullAccess = { readBilling: true, readPatients: true };
const week = { from: "2026-10-03", to: "2026-10-10" };

describe("indexInvoicesByAppointment", () => {
  it("maps each appointment to its invoice and skips invoices without an appointment", () => {
    const linked = invoice(11, 2);
    expect(indexInvoicesByAppointment([invoice(10, null), linked])).toEqual({ 2: linked });
  });

  it("keeps the first invoice of an appointment: the API lists the newest first", () => {
    const newest = invoice(12, 2);
    expect(indexInvoicesByAppointment([newest, invoice(11, 2)])).toEqual({ 2: newest });
  });
});

describe("appointmentsLoadRange", () => {
  const today = "2026-10-03";

  it.each([
    ["today", { from: "2026-10-03", to: "2026-10-03" }],
    ["tomorrow", { from: "2026-10-04", to: "2026-10-04" }],
    ["the week", week],
    ["a calendar day inside the week", { from: "2026-10-10", to: "2026-10-10" }],
  ])("loads today and the next 7 days for %s, so these views share one request", (_view, visible) => {
    expect(appointmentsLoadRange(visible, today)).toEqual(week);
  });

  it.each([
    ["a past day", "2026-10-02"],
    ["the day after the week", "2026-10-11"],
    ["a day of another year", "2025-12-31"],
  ])("loads only %s picked in the calendar", (_view, day) => {
    expect(appointmentsLoadRange({ from: day, to: day }, today)).toEqual({ from: day, to: day });
  });

  it("carries the week over a month end", () => {
    expect(appointmentsLoadRange({ from: "2026-10-28", to: "2026-10-28" }, "2026-10-28")).toEqual({
      from: "2026-10-28",
      to: "2026-11-04",
    });
  });
});

describe("loadAppointmentsPageData", () => {
  it("asks only for the appointments of the given days, not for the clinic's whole history", async () => {
    const api = fakeApi();
    await loadAppointmentsPageData(api, "token", fullAccess, week);
    expect(api.listAppointments).toHaveBeenCalledTimes(1);
    expect(api.listAppointments).toHaveBeenCalledWith("token", week);
  });

  it("asks for invoices once, however many appointments the period has", async () => {
    const api = fakeApi({ listAppointments: vi.fn().mockResolvedValue(appointments(750)) });
    const data = await loadAppointmentsPageData(api, "token", fullAccess, week);
    expect(data.appointments).toHaveLength(750);
    expect(api.listInvoices).toHaveBeenCalledTimes(1);
    expect(api.listInvoices).toHaveBeenCalledWith("token");
    for (const call of [api.listAppointments, api.listPatients, api.listDoctors, api.listServices]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("returns the lists and the invoices indexed by appointment", async () => {
    const data = await loadAppointmentsPageData(fakeApi(), "token", fullAccess, week);
    expect(data.patients).toEqual([{ id: 7 }]);
    expect(data.doctors).toEqual([{ id: 1, name: "Каримов" }]);
    expect(data.services).toEqual([{ id: 5 }]);
    expect(data.invoicesByAppointmentId).toEqual({ 2: invoice(11, 2) });
  });

  it("does not ask for invoices or patients the user may not read", async () => {
    const api = fakeApi();
    const data = await loadAppointmentsPageData(api, "token", { readBilling: false, readPatients: false }, week);
    expect(api.listInvoices).not.toHaveBeenCalled();
    expect(api.listPatients).not.toHaveBeenCalled();
    expect(data.invoicesByAppointmentId).toEqual({});
    expect(data.patients).toEqual([]);
  });

  it("still opens the schedule when the invoice list fails", async () => {
    const api = fakeApi({ listInvoices: vi.fn().mockRejectedValue(new Error("network")) });
    const data = await loadAppointmentsPageData(api, "token", fullAccess, week);
    expect(data.appointments).toHaveLength(3);
    expect(data.invoicesByAppointmentId).toEqual({});
  });

  it("fails when the appointments themselves cannot be loaded", async () => {
    const api = fakeApi({ listAppointments: vi.fn().mockRejectedValue(new Error("network")) });
    await expect(loadAppointmentsPageData(api, "token", fullAccess, week)).rejects.toThrow("network");
  });
});

describe("free time suggestions for a busy slot", () => {
  const day = "2026-10-05";
  const slot = { doctorId: 4, dateYmd: day, durationMinutes: 30 };
  const visit = (from: string, to: string, overrides: Partial<Appointment> = {}) =>
    ({ id: 1, doctorId: 4, status: "scheduled", startAt: `${day} ${from}:00`, endAt: `${day} ${to}:00`, ...overrides }) as Appointment;

  it("offers the first three half-hour starts of a free day", () => {
    expect(suggestFreeTimes([], slot)).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("skips the starts that overlap the doctor's active visits", () => {
    const rows = [visit("08:00", "09:00"), visit("09:30", "10:00", { status: "in_consultation" }), visit("10:15", "10:45", { status: "arrived" })];
    expect(suggestFreeTimes(rows, slot)).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("ignores other doctors, other days and visits that no longer hold their time", () => {
    const rows = [
      visit("08:00", "09:00", { doctorId: 5 }),
      visit("08:00", "08:30", { status: "cancelled" }),
      visit("08:30", "09:00", { status: "completed" }),
      visit("09:00", "09:30", { status: "no_show" }),
      visit("08:00", "20:00", { startAt: "2026-10-04 08:00:00", endAt: "2026-10-04 20:00:00" }),
    ];
    expect(suggestFreeTimes(rows, slot)).toEqual(["08:00", "08:30", "09:00"]);
  });

  it("offers only the starts whose visit ends by 20:00", () => {
    expect(suggestFreeTimes([visit("08:00", "19:00")], { ...slot, durationMinutes: 60 })).toEqual(["19:00"]);
  });

  it("asks only for that doctor's visits of that day", async () => {
    const listAppointments = vi.fn().mockResolvedValue([visit("08:00", "08:30")]);
    expect(await loadSuggestedTimes({ listAppointments }, "token", slot)).toEqual(["08:30", "09:00", "09:30"]);
    expect(listAppointments.mock.calls).toEqual([["token", { from: day, to: day, doctorId: 4 }]]);
  });
});
