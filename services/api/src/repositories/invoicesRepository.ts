import type { IInvoicesRepository } from "./interfaces/IInvoicesRepository";
import {
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceCreateInput,
  type InvoiceFilters,
  type InvoiceItem,
  type InvoiceItemInput,
  type InvoiceStatus,
  type InvoiceSummary,
  type InvoiceUpdateInput,
} from "./interfaces/billingTypes";
import { getMockDb, nextId, type InvoiceRecord } from "./mockDatabase";

export {
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceCreateInput,
  type InvoiceFilters,
  type InvoiceItem,
  type InvoiceItemInput,
  type InvoiceStatus,
  type InvoiceSummary,
  type InvoiceUpdateInput,
};

const toSummary = (row: InvoiceRecord): InvoiceSummary => ({
  id: row.id,
  number: row.number,
  patientId: row.patientId,
  appointmentId: row.appointmentId,
  status: row.status,
  subtotal: row.subtotal,
  discount: row.discount,
  total: row.total,
  paidAmount: row.paidAmount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class MockInvoicesRepository implements IInvoicesRepository {
  async findAll(filters: InvoiceFilters = {}): Promise<InvoiceSummary[]> {
    return getMockDb()
      .invoices.filter((row) => {
        if (row.deletedAt) return false;
        if (filters.patientId !== undefined && row.patientId !== filters.patientId) return false;
        if (
          filters.appointmentId !== undefined &&
          row.appointmentId !== filters.appointmentId
        ) {
          return false;
        }
        if (filters.status !== undefined && row.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => toSummary(row));
  }

  async findByAppointmentId(appointmentId: number): Promise<InvoiceSummary | null> {
    const found = getMockDb()
      .invoices
      .filter((row) => row.appointmentId === appointmentId && !row.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return found ? toSummary(found) : null;
  }

  async findById(id: number): Promise<Invoice | null> {
    const invoice = getMockDb().invoices.find((row) => row.id === id && !row.deletedAt);
    if (!invoice) return null;
    const items = getMockDb()
      .invoiceItems.filter((row) => row.invoiceId === id)
      .map((row) => ({ ...row }));
    return { ...toSummary(invoice), items };
  }

  async create(input: InvoiceCreateInput, items: InvoiceItemInput[]): Promise<InvoiceSummary> {
    const now = new Date().toISOString();
    const created = {
      id: nextId(),
      number: input.number,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      status: input.status,
      subtotal: input.subtotal,
      discount: input.discount,
      total: input.total,
      paidAmount: input.paidAmount,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    getMockDb().invoices.push(created);
    await this.replaceItems(created.id, items);
    return toSummary(created);
  }

  async update(
    id: number,
    input: InvoiceUpdateInput,
    replaceLineItems?: InvoiceItemInput[]
  ): Promise<InvoiceSummary | null> {
    const db = getMockDb();
    const idx = db.invoices.findIndex((row) => row.id === id && !row.deletedAt);
    if (idx < 0) return null;
    db.invoices[idx] = {
      ...db.invoices[idx],
      ...input,
      appointmentId:
        input.appointmentId !== undefined ? input.appointmentId ?? null : db.invoices[idx].appointmentId,
      updatedAt: new Date().toISOString(),
    };
    if (replaceLineItems !== undefined) {
      await this.replaceItems(id, replaceLineItems);
    }
    return toSummary(db.invoices[idx]);
  }

  async delete(id: number): Promise<boolean> {
    const db = getMockDb();
    const idx = db.invoices.findIndex((row) => row.id === id && !row.deletedAt);
    if (idx < 0) return false;
    db.invoices[idx] = {
      ...db.invoices[idx],
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  async replaceItems(invoiceId: number, items: InvoiceItemInput[]): Promise<void> {
    const db = getMockDb();
    db.invoiceItems = db.invoiceItems.filter((row) => row.invoiceId !== invoiceId);
    for (const item of items) {
      db.invoiceItems.push({
        id: nextId(),
        invoiceId,
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      });
    }
  }

  async patientExists(id: number): Promise<boolean> {
    return getMockDb().patients.some((row) => row.id === id && row.deletedAt === null);
  }

  async appointmentExists(id: number): Promise<boolean> {
    return getMockDb().appointments.some((row) => row.id === id);
  }

  async getAppointmentPatientId(appointmentId: number): Promise<number | null> {
    const found = getMockDb().appointments.find((row) => row.id === appointmentId);
    return found ? found.patientId : null;
  }
}

