import { requestJson } from "../../../api/http";

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "refunded";

export type InvoiceSummary = {
  id: number;
  number: string;
  patientId: number;
  appointmentId: number | null;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceItem = {
  id: number;
  invoiceId: number;
  serviceId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoiceDetail = InvoiceSummary & {
  items: InvoiceItem[];
};

export type PaymentMethod = "cash" | "card";

export type Payment = {
  id: number;
  invoiceId: number;
  amount: number;
  refundedAmount?: number;
  method: PaymentMethod;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  voidReason: string | null;
};

export type CashRegisterShift = {
  id: number;
  openedBy: number | null;
  closedBy: number | null;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CashEntryType = "payment" | "refund" | "manual_in" | "manual_out";

export type CashRegisterEntry = {
  id: number;
  shiftId: number;
  paymentId: number | null;
  type: CashEntryType;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  createdAt: string;
  invoiceId: number | null;
  patientId: number | null;
  /** Строка оплаты: исходный платёж возвращён */
  isPaymentRefunded?: boolean;
  /** Для оплаты: сколько ещё можно вернуть по исходному платежу */
  paymentRemainingRefundable?: number;
};

export type ClinicMeta = {
  clinicName: string;
  receiptFooter: string;
  reportsTimezone: string;
};

export type CashRegisterShiftSummary = {
  shiftId: number;
  openingBalance: number;
  totalIncome: number;
  totalCash: number;
  totalCard: number;
  operationsCount: number;
  closingBalancePreview: number;
};

export type Patient = { id: number; fullName: string };
export type Doctor = { id: number; name: string };
export type Service = { id: number; name: string };
export type BillingStatus = "draft" | "ready_for_payment" | "paid";
export type AppointmentReadyForPayment = {
  id: number;
  patientId: number;
  doctorId: number;
  billingStatus: BillingStatus;
  services?: Array<{
    serviceId: number;
    name: string;
    price: number;
  }>;
};
export type AppointmentAssignedService = {
  id: number;
  appointmentId: number;
  serviceId: number;
  price: number;
  quantity: number;
  createdAt: string;
};

export const cashDeskApi = {
  listInvoices: (token: string) =>
    requestJson<InvoiceSummary[]>("/api/invoices", { token }),

  getInvoiceById: (token: string, id: number) =>
    requestJson<InvoiceDetail>(`/api/invoices/${id}`, { token }),

  listPayments: (token: string, limitRecent?: number) =>
    requestJson<Payment[]>("/api/payments", { token }).then((rows) => {
      const sorted = [...rows]
        .filter((p) => !p.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return limitRecent ? sorted.slice(0, limitRecent) : sorted;
    }),

  createPayment: (
    token: string,
    body: { invoiceId: number; amount: number; method: PaymentMethod }
  ) =>
    requestJson<Payment>("/api/payments", {
      method: "POST",
      token,
      body,
    }),

  refundPayment: (token: string, paymentId: number, body: { reason: string; amount?: number }) =>
    requestJson<{ success: boolean; id: number }>(`/api/payments/${paymentId}/refund`, {
      method: "POST",
      token,
      body,
    }),

  getClinicMeta: (token: string) =>
    requestJson<ClinicMeta>("/api/meta/clinic", { token }),

  /** Активная смена или `null` */
  getCurrentShift: (token: string) =>
    requestJson<CashRegisterShift | null>("/api/cash-register/shift/current", { token }),

  /** Сводка по активной смене или `null`, если смены нет */
  getSummaryCurrent: (token: string) =>
    requestJson<CashRegisterShiftSummary | null>("/api/cash-register/summary/current", { token }),

  getActiveShift: (token: string) =>
    requestJson<CashRegisterShift | null>("/api/cash-register/shifts/active", { token }),

  openShift: (
    token: string,
    body: { openingBalance?: number; notes?: string | null; openedBy?: number | null }
  ) =>
    requestJson<CashRegisterShift>("/api/cash-register/shift/open", {
      method: "POST",
      token,
      body,
    }),

  /** Закрыть текущую активную смену (итог считается по движениям). */
  closeCurrentShift: (token: string, body?: { notes?: string | null; closedBy?: number | null }) =>
    requestJson<CashRegisterShift>("/api/cash-register/shift/close", {
      method: "POST",
      token,
      body: body ?? {},
    }),

  closeShift: (token: string, shiftId: number, body: { notes?: string | null; closedBy?: number | null }) =>
    requestJson<CashRegisterShift>(`/api/cash-register/shifts/${shiftId}/close`, {
      method: "POST",
      token,
      body,
    }),

  shiftHistory: (token: string) =>
    requestJson<CashRegisterShift[]>("/api/cash-register/shifts/history", { token }),

  getShiftById: (token: string, shiftId: number) =>
    requestJson<CashRegisterShift>(`/api/cash-register/shifts/${shiftId}`, { token }),

  listEntries: (
    token: string,
    opts?: { shiftId?: number; dateFrom?: string; dateTo?: string }
  ) => {
    const q = new URLSearchParams();
    if (opts?.shiftId != null) q.set("shiftId", String(opts.shiftId));
    if (opts?.dateFrom) q.set("dateFrom", opts.dateFrom);
    if (opts?.dateTo) q.set("dateTo", opts.dateTo);
    const qs = q.toString();
    return requestJson<CashRegisterEntry[]>(
      `/api/cash-register/entries${qs ? `?${qs}` : ""}`,
      { token }
    );
  },

  listPatients: (token: string) =>
    requestJson<Patient[]>("/api/patients", { token }),

  listDoctors: (token: string) => requestJson<Doctor[]>("/api/doctors", { token }),

  listServices: (token: string) => requestJson<Service[]>("/api/services", { token }),

  listAppointmentsReadyForPayment: (token: string) =>
    requestJson<AppointmentReadyForPayment[]>(
      "/api/appointments?billing_status=ready_for_payment",
      { token }
    ),

  listAppointmentServices: (token: string, appointmentId: number) =>
    requestJson<AppointmentAssignedService[]>(
      `/api/appointments/${appointmentId}/services`,
      { token }
    ),

  createInvoiceFromAppointment: (token: string, appointmentId: number) =>
    requestJson<InvoiceSummary>("/api/invoices/from-appointment", {
      method: "POST",
      token,
      body: { appointment_id: appointmentId },
    }),

  clearFinancialData: (token: string) =>
    requestJson<{ success: boolean }>("/api/cash-register/clear", {
      method: "POST",
      token,
      body: {},
    }),
};
