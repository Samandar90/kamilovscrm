import { invalidateClinicFactsCache } from "../ai/aiCacheService";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import {
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceCreateInput,
  type InvoiceFilters,
  type InvoiceItemInput,
  type InvoiceStatus,
  type InvoiceSummary,
  type InvoiceUpdateInput,
} from "../repositories/interfaces/billingTypes";
import type { IInvoicesRepository } from "../repositories/interfaces/IInvoicesRepository";
import type { IAppointmentsRepository } from "../repositories/interfaces/IAppointmentsRepository";
import type { IServicesRepository } from "../repositories/interfaces/IServicesRepository";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { parseNumericInput, parseRequiredMoney, roundMoney2 } from "../utils/numbers";

const TERMINAL_STATUSES = new Set<InvoiceStatus>(["paid", "cancelled", "refunded"]);

const ALLOWED_STATUS_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["partially_paid", "paid", "cancelled"],
  partially_paid: ["paid", "cancelled", "refunded"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

/** Raw line из HTTP (кнопка «Счёт» может прислать price/unitPrice строкой с пробелами). */
type RawInvoiceLineInput = {
  serviceId?: unknown;
  quantity?: unknown;
  description?: unknown;
  unitPrice?: unknown;
  price?: unknown;
};

type CreateInvoicePayload = {
  number?: string;
  patientId: number;
  appointmentId?: number | null;
  status?: InvoiceStatus;
  discount?: number;
  /** Ignored — use payments API only */
  paidAmount?: number;
  items: RawInvoiceLineInput[];
};

type UpdateInvoicePayload = {
  number?: string;
  patientId?: number;
  appointmentId?: number | null;
  status?: InvoiceStatus;
  discount?: number;
  /** Not accepted — paid amount is managed via payments */
  paidAmount?: number;
  items?: RawInvoiceLineInput[];
};

const roundMoney = (value: unknown): number => {
  const n = parseNumericInput(value);
  if (n === null) {
    throw new ApiError(400, "Некорректная денежная сумма");
  }
  return roundMoney2(n);
};

const normalizeInvoiceNumber = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return value.trim();
};

/**
 * Количество — не денежная сумма: нельзя округлять до 2 знаков (иначе 0.847 → 0.85 и падают проверки / 400).
 */
const parseLineQuantity = (value: unknown, index: number): number => {
  const n = parseNumericInput(value);
  if (n === null || n <= 0) {
    throw new ApiError(400, `Item at index ${index}: 'quantity' must be greater than 0`);
  }
  return n;
};

const parseServiceId = (value: unknown, index: number): number => {
  const n = parseNumericInput(value);
  const parsed = n != null ? Math.trunc(n) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `Item at index ${index}: 'serviceId' must be a positive integer`);
  }
  return parsed;
};

const resolveLineItemsFromServices = async (
  servicesRepository: IServicesRepository,
  rawItems: RawInvoiceLineInput[]
): Promise<InvoiceItemInput[]> => {
  const result: InvoiceItemInput[] = [];

  for (let index = 0; index < rawItems.length; index++) {
    const line = rawItems[index];
    const serviceId = parseServiceId(line.serviceId, index);
    const quantity = parseLineQuantity(line.quantity, index);

    const service = await servicesRepository.findById(serviceId);
    if (!service) {
      throw new ApiError(404, `Service ${serviceId} not found`);
    }

    const rawPrice: unknown =
      line.price !== undefined && line.price !== null
        ? line.price
        : line.unitPrice !== undefined && line.unitPrice !== null
          ? line.unitPrice
          : service.price;

    const unitPrice = roundMoney2(parseRequiredMoney(rawPrice, "price"));

    if (!Number.isFinite(unitPrice)) {
      throw new ApiError(400, `Item at index ${index}: invalid unit price before insert`);
    }

    if (unitPrice < 0) {
      throw new ApiError(400, `Service ${serviceId} has invalid price`);
    }

    const description =
      typeof line.description === "string" && line.description.trim() !== ""
        ? line.description.trim()
        : service.name;

    const lineTotal = roundMoney(quantity * unitPrice);

    result.push({
      serviceId,
      description,
      quantity,
      unitPrice,
      lineTotal,
    });
  }

  // eslint-disable-next-line no-console
  console.log("FINAL INVOICE ITEMS:", result);

  return result;
};

const computeTotals = (
  items: InvoiceItemInput[],
  discountInput: number | undefined
): { subtotal: number; discount: number; total: number } => {
  const subtotal = roundMoney(
    items.reduce((acc, item) => acc + roundMoney(item.lineTotal), 0)
  );
  const discount = roundMoney(discountInput ?? 0);
  const total = roundMoney(subtotal - discount);

  if (discount < 0) {
    throw new ApiError(400, "Field 'discount' must be greater than or equal to 0");
  }

  if (discount > subtotal + 1e-6) {
    throw new ApiError(400, "Скидка не может превышать сумму позиций (subtotal)");
  }

  if (total < 0) {
    throw new ApiError(400, "Invoice total cannot be negative");
  }

  return { subtotal, discount, total };
};

const ensurePatientExists = async (
  invoicesRepository: IInvoicesRepository,
  patientId: number
): Promise<void> => {
  const exists = await invoicesRepository.patientExists(patientId);
  if (!exists) {
    throw new ApiError(404, "Patient not found");
  }
};

const ensureAppointmentForInvoice = async (
  invoicesRepository: IInvoicesRepository,
  appointmentId: number | null | undefined,
  patientId: number
): Promise<void> => {
  if (appointmentId === undefined || appointmentId === null) {
    throw new ApiError(400, "Field 'appointmentId' is required");
  }

  const appointmentFound = await invoicesRepository.appointmentExists(appointmentId);
  if (!appointmentFound) {
    throw new ApiError(404, "Appointment not found");
  }

  const appointmentPatientId = await invoicesRepository.getAppointmentPatientId(appointmentId);
  if (appointmentPatientId === null) {
    throw new ApiError(404, "Appointment not found");
  }

  if (appointmentPatientId !== patientId) {
    throw new ApiError(400, "Invoice patient must match appointment patient");
  }
};

const ensureStatusTransitionAllowed = (
  currentStatus: InvoiceStatus,
  nextStatus: InvoiceStatus
): void => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      400,
      `Invalid invoice status transition: '${currentStatus}' -> '${nextStatus}'`
    );
  }
};

export class InvoicesService {
  constructor(
    private readonly invoicesRepository: IInvoicesRepository,
    private readonly servicesRepository: IServicesRepository,
    private readonly appointmentsRepository: IAppointmentsRepository
  ) {}

  async list(
    _auth: AuthTokenPayload,
    filters: InvoiceFilters = {}
  ): Promise<InvoiceSummary[]> {
    return this.invoicesRepository.findAll(filters);
  }

  async getById(_auth: AuthTokenPayload, id: number): Promise<Invoice | null> {
    return this.invoicesRepository.findById(id);
  }

  async create(_auth: AuthTokenPayload, payload: CreateInvoicePayload): Promise<Invoice> {
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ApiError(400, "Field 'items' must contain at least one line with a service");
    }

    if (payload.paidAmount !== undefined) {
      throw new ApiError(400, "Field 'paidAmount' cannot be set when creating an invoice — use payments");
    }

    const status = payload.status ?? "draft";
    if (!INVOICE_STATUSES.includes(status)) {
      throw new ApiError(400, "Invalid invoice status");
    }

    const discount = roundMoney(payload.discount ?? 0);
    const number = normalizeInvoiceNumber(payload.number);
    const patientIdRaw = parseNumericInput(payload.patientId);
    const patientId = patientIdRaw != null ? Math.trunc(patientIdRaw) : NaN;
    const appointmentIdRaw = payload.appointmentId ?? null;
    const appointmentId =
      appointmentIdRaw === null || appointmentIdRaw === undefined
        ? null
        : (() => {
            const n = parseNumericInput(appointmentIdRaw);
            return n != null ? Math.trunc(n) : NaN;
          })();
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new ApiError(400, "Field 'patientId' must be a positive integer");
    }
    if (appointmentId === null || !Number.isInteger(appointmentId) || appointmentId <= 0) {
      throw new ApiError(400, "Field 'appointmentId' is required and must be a positive integer");
    }

    await ensurePatientExists(this.invoicesRepository, patientId);
    await ensureAppointmentForInvoice(this.invoicesRepository, appointmentId, patientId);

    const resolvedItems = await resolveLineItemsFromServices(this.servicesRepository, payload.items);
    const totals = computeTotals(resolvedItems, discount);

    const invoiceInput: InvoiceCreateInput = {
      number,
      patientId,
      appointmentId,
      status,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      paidAmount: 0,
    };

    if (env.debugInvoiceCreate) {
      // eslint-disable-next-line no-console
      console.log(
        "[InvoicesService.create] normalized invoiceInput + resolvedItems",
        JSON.stringify({ invoiceInput, resolvedItems })
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      "INVOICE INSERT DATA:",
      JSON.stringify({ items: resolvedItems }, null, 2)
    );

    try {
      const created = await this.invoicesRepository.create(invoiceInput, resolvedItems);
      const fullInvoice = await this.invoicesRepository.findById(created.id);
      if (!fullInvoice) {
        throw new ApiError(500, "Failed to load created invoice");
      }
      invalidateClinicFactsCache();
      return fullInvoice;
    } catch (err: unknown) {
      const pg = err as { code?: string; constraint?: string; detail?: string };
      if (pg.code === "23505") {
        const d = (pg.detail ?? "").toLowerCase();
        if (pg.constraint === "uq_invoices_active_appointment" || d.includes("appointment_id")) {
          throw new ApiError(
            409,
            "An open invoice already exists for this appointment (cancel it or complete payment first)"
          );
        }
        throw new ApiError(409, "Invoice number already exists");
      }
      throw err;
    }
  }

  async createFromAppointment(auth: AuthTokenPayload, appointmentId: number): Promise<Invoice> {
    const appointment = await this.appointmentsRepository.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }
    const assignedServices = await this.appointmentsRepository.listServiceAssignments(
      appointmentId
    );
    if (assignedServices.length === 0) {
      throw new ApiError(400, "No assigned services found for appointment");
    }
    const items = assignedServices.map((row) => ({
      serviceId: row.serviceId,
      quantity: 1,
    }));
    const created = await this.create(auth, {
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      status: "issued",
      discount: 0,
      items,
    });
    await this.appointmentsRepository.updateBillingStatus(appointment.id, "ready_for_payment");
    return created;
  }

  async update(
    auth: AuthTokenPayload,
    id: number,
    payload: UpdateInvoicePayload
  ): Promise<Invoice | null> {
    if (payload.paidAmount !== undefined) {
      throw new ApiError(400, "Field 'paidAmount' cannot be updated via invoices API — use payments");
    }

    if (auth.role === "cashier") {
      const restricted =
        payload.number !== undefined ||
        payload.patientId !== undefined ||
        payload.appointmentId !== undefined ||
        payload.discount !== undefined ||
        payload.items !== undefined;
      if (restricted) {
        throw new ApiError(
          403,
          "Кассир может менять только статус счёта; позиции и реквизиты недоступны"
        );
      }
      if (payload.status === undefined) {
        throw new ApiError(400, "Для кассира укажите поле status");
      }
    }

    const current = await this.invoicesRepository.findById(id);
    if (!current) {
      return null;
    }

    const hasAnyUpdateField =
      payload.number !== undefined ||
      payload.patientId !== undefined ||
      payload.appointmentId !== undefined ||
      payload.status !== undefined ||
      payload.discount !== undefined ||
      payload.items !== undefined;

    if (!hasAnyUpdateField) {
      throw new ApiError(400, "At least one field must be provided for update");
    }

    if (payload.items !== undefined && TERMINAL_STATUSES.has(current.status)) {
      throw new ApiError(
        400,
        "Cannot modify invoice items after paid, refunded, or cancelled status"
      );
    }

    const nextStatus = payload.status ?? current.status;
    ensureStatusTransitionAllowed(current.status, nextStatus);

    const nextPatientId = payload.patientId ?? current.patientId;
    const nextAppointmentId =
      payload.appointmentId !== undefined ? payload.appointmentId : current.appointmentId;

    if (payload.appointmentId !== undefined || payload.patientId !== undefined) {
      await ensurePatientExists(this.invoicesRepository, nextPatientId);
      await ensureAppointmentForInvoice(
        this.invoicesRepository,
        nextAppointmentId,
        nextPatientId
      );
    }

    let effectiveItems: InvoiceItemInput[];
    let replaceLineItems: InvoiceItemInput[] | undefined;

    if (payload.items !== undefined) {
      effectiveItems = await resolveLineItemsFromServices(this.servicesRepository, payload.items);
      replaceLineItems = effectiveItems;
    } else {
      effectiveItems = current.items.map((item) => ({
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      }));
    }

    if (effectiveItems.length === 0) {
      throw new ApiError(400, "Invoice must contain at least one item");
    }

    const nextDiscount = payload.discount ?? current.discount;
    const totals = computeTotals(effectiveItems, nextDiscount);

    const nextPaidAmount = roundMoney(current.paidAmount);
    if (nextPaidAmount > totals.total) {
      throw new ApiError(
        400,
        "Current payments exceed recomputed invoice total — void payments or adjust line items"
      );
    }

    const updatePayload: InvoiceUpdateInput = {
      number:
        payload.number !== undefined
          ? normalizeInvoiceNumber(payload.number)
          : undefined,
      patientId: payload.patientId !== undefined ? nextPatientId : undefined,
      appointmentId: payload.appointmentId !== undefined ? nextAppointmentId ?? null : undefined,
      status: nextStatus,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
    };

    try {
      const updated = await this.invoicesRepository.update(id, updatePayload, replaceLineItems);
      if (!updated) {
        return null;
      }

      const fullInvoice = await this.invoicesRepository.findById(id);
      if (!fullInvoice) {
        throw new ApiError(500, "Failed to load updated invoice");
      }
      invalidateClinicFactsCache();
      return fullInvoice;
    } catch (err: unknown) {
      const pg = err as { code?: string; constraint?: string; detail?: string };
      if (pg.code === "23505") {
        const d = (pg.detail ?? "").toLowerCase();
        if (pg.constraint === "uq_invoices_active_appointment" || d.includes("appointment_id")) {
          throw new ApiError(
            409,
            "An open invoice already exists for this appointment (cancel it or complete payment first)"
          );
        }
        throw new ApiError(409, "Invoice number already exists");
      }
      throw err;
    }
  }

  async delete(_auth: AuthTokenPayload, id: number): Promise<boolean> {
    const ok = await this.invoicesRepository.delete(id);
    if (ok) invalidateClinicFactsCache();
    return ok;
  }
}
