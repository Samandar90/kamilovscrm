import type {
  Invoice,
  InvoiceCreateInput,
  InvoiceFilters,
  InvoiceItemInput,
  InvoiceSummary,
  InvoiceUpdateInput,
} from "./billingTypes";

export interface IInvoicesRepository {
  findAll(filters?: InvoiceFilters): Promise<InvoiceSummary[]>;
  findByAppointmentId(appointmentId: number): Promise<InvoiceSummary | null>;
  findById(id: number): Promise<Invoice | null>;
  /** Persists header and line items in one transaction (Postgres) or equivalent (mock). */
  create(input: InvoiceCreateInput, items: InvoiceItemInput[]): Promise<InvoiceSummary>;
  /**
   * Updates invoice header. When `replaceLineItems` is set, replaces all line items in the same transaction as the header update.
   */
  update(
    id: number,
    input: InvoiceUpdateInput,
    replaceLineItems?: InvoiceItemInput[]
  ): Promise<InvoiceSummary | null>;
  delete(id: number): Promise<boolean>;
  replaceItems(invoiceId: number, items: InvoiceItemInput[]): Promise<void>;
  patientExists(id: number): Promise<boolean>;
  appointmentExists(id: number): Promise<boolean>;
  getAppointmentPatientId(appointmentId: number): Promise<number | null>;
}
