import { describe, expect, it, vi } from "vitest";
import type { Appointment, InvoiceSummary } from "../api/appointmentsFlowApi";
import { indexInvoicesByAppointment, loadAppointmentsPageData, type AppointmentsPageApi } from "./appointmentsPageData";

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

describe("loadAppointmentsPageData", () => {
  it("asks for invoices once, however many appointments the clinic has", async () => {
    const api = fakeApi({ listAppointments: vi.fn().mockResolvedValue(appointments(750)) });
    const data = await loadAppointmentsPageData(api, "token", fullAccess);
    expect(data.appointments).toHaveLength(750);
    expect(api.listInvoices).toHaveBeenCalledTimes(1);
    expect(api.listInvoices).toHaveBeenCalledWith("token");
    for (const call of [api.listAppointments, api.listPatients, api.listDoctors, api.listServices]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("returns the lists and the invoices indexed by appointment", async () => {
    const data = await loadAppointmentsPageData(fakeApi(), "token", fullAccess);
    expect(data.patients).toEqual([{ id: 7 }]);
    expect(data.doctors).toEqual([{ id: 1, name: "Каримов" }]);
    expect(data.services).toEqual([{ id: 5 }]);
    expect(data.invoicesByAppointmentId).toEqual({ 2: invoice(11, 2) });
  });

  it("does not ask for invoices or patients the user may not read", async () => {
    const api = fakeApi();
    const data = await loadAppointmentsPageData(api, "token", { readBilling: false, readPatients: false });
    expect(api.listInvoices).not.toHaveBeenCalled();
    expect(api.listPatients).not.toHaveBeenCalled();
    expect(data.invoicesByAppointmentId).toEqual({});
    expect(data.patients).toEqual([]);
  });

  it("still opens the schedule when the invoice list fails", async () => {
    const api = fakeApi({ listInvoices: vi.fn().mockRejectedValue(new Error("network")) });
    const data = await loadAppointmentsPageData(api, "token", fullAccess);
    expect(data.appointments).toHaveLength(3);
    expect(data.invoicesByAppointmentId).toEqual({});
  });

  it("fails when the appointments themselves cannot be loaded", async () => {
    const api = fakeApi({ listAppointments: vi.fn().mockRejectedValue(new Error("network")) });
    await expect(loadAppointmentsPageData(api, "token", fullAccess)).rejects.toThrow("network");
  });
});
