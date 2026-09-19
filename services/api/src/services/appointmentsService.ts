import {
  type IAppointmentsRepository,
} from "../repositories/interfaces/IAppointmentsRepository";
import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentServiceAssignment,
  AppointmentServiceLineCreateInput,
  AppointmentServiceLineReplacement,
  AppointmentStatus,
  AppointmentUpdateInput,
} from "../repositories/interfaces/coreTypes";
import type { AuthTokenPayload, UserRole } from "../repositories/interfaces/userTypes";
import { invalidateClinicFactsCache } from "../ai/aiCacheService";
import { canSetAppointmentCommercialPrice, roleHasPermissionKey } from "../auth/permissions";
import { ApiError } from "../middleware/errorHandler";
import {
  assertAppointmentClinicalWriteAllowed,
  canReadAppointment,
  getEffectiveDoctorId,
  isDoctorScopedRole,
  mergeAppointmentFiltersForUser,
  redactAppointmentClinicalFields,
  shouldRedactAppointmentClinicalFields,
} from "./clinicalDataScope";
import {
  assertAppointmentTimestampForDb,
  assertOptionalAppointmentTimestampForDb,
  tryParseAppointmentTimestampForDb,
} from "../utils/appointmentTimestamps";
import {
  formatLocalDateTime,
  parseLocalDateTime,
} from "../utils/localDateTime";
import { parseNumericInput, roundMoney2 } from "../utils/numbers";

const ACTIVE_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "scheduled",
  "confirmed",
  "arrived",
  "in_consultation",
]);

/** Before the visit starts the booked slot follows the services; afterwards the time is history. */
const RESCHEDULABLE_STATUSES = new Set<AppointmentStatus>(["scheduled", "confirmed"]);

/** Roles that may change an appointment's services (doctors only within their own schedule). */
const SERVICE_EDITOR_ROLES = new Set<UserRole>([
  "superadmin",
  "reception",
  "manager",
  "operator",
  "doctor",
]);

/** Statuses a doctor may cancel (soft cancel); other roles follow legacy rules in cancel(). */
const DOCTOR_CANCELLABLE_STATUSES = new Set<AppointmentStatus>([
  "scheduled",
  "confirmed",
  "arrived",
]);

const ALLOWED_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "in_consultation", "completed", "cancelled", "no_show"],
  arrived: ["in_consultation", "completed", "cancelled", "no_show"],
  in_consultation: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

const normalizeOptionalString = (
  value: unknown
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const normalizeOptionalPrice = (
  value: unknown
): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = parseNumericInput(value);
  if (parsed === null || parsed < 0) {
    throw new ApiError(400, "Поле «цена» должно быть числом не меньше 0");
  }
  return Math.round(parsed);
};

/** A calendar date, never an instant: use the appointment's wall-clock date. */
const validateRecommendedReturnDate = (value: unknown, startAt: string): void => {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    throw new ApiError(400, "Дата повторного приёма должна иметь формат YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value <= startAt.slice(0, 10)) {
    throw new ApiError(400, "Дата повторного приёма должна существовать и быть позже даты визита");
  }
};

const normalizeOptionalQuantity = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = parseNumericInput(value);
  if (parsed === null || parsed <= 0) {
    throw new ApiError(400, "Поле quantity должно быть числом больше 0");
  }
  return roundMoney2(parsed);
};

const normalizeServiceLinesPayload = (
  raw: unknown
): AppointmentServiceLineCreateInput[] | undefined => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const out: AppointmentServiceLineCreateInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const sidRaw = o.serviceId ?? o.service_id;
    const sidParsed = parseNumericInput(sidRaw);
    const sid = sidParsed != null ? Math.trunc(sidParsed) : NaN;
    if (!Number.isInteger(sid) || sid <= 0) continue;
    const qtyRaw = o.quantity ?? o.qty;
    const priceRaw = o.price ?? o.unitPrice;
    out.push({
      serviceId: sid,
      price:
        priceRaw === undefined || priceRaw === null
          ? undefined
          : normalizeOptionalPrice(priceRaw),
      quantity:
        qtyRaw === undefined || qtyRaw === null
          ? undefined
          : normalizeOptionalQuantity(qtyRaw),
    });
  }
  return out.length > 0 ? out : undefined;
};

const ensureServiceBookableForDoctor = async (
  appointmentsRepository: IAppointmentsRepository,
  serviceId: number,
  doctorId: number,
  options: { requireActiveService: boolean }
): Promise<void> => {
  if (!(await appointmentsRepository.serviceExists(serviceId))) {
    throw new ApiError(404, "Service not found");
  }
  if (options.requireActiveService && !(await appointmentsRepository.isServiceActive(serviceId))) {
    throw new ApiError(400, "Service is inactive or not available for booking");
  }
  if (!(await appointmentsRepository.isServiceAssignedToDoctor(serviceId, doctorId))) {
    throw new ApiError(400, "Selected service is not assigned to selected doctor");
  }
};

const ensureRelatedEntitiesExist = async (
  appointmentsRepository: IAppointmentsRepository,
  patientId: number,
  doctorId: number,
  serviceIds: number[],
  options: { requireActiveService: boolean }
): Promise<void> => {
  const [patientFound, doctorFound] = await Promise.all([
    appointmentsRepository.patientExists(patientId),
    appointmentsRepository.doctorExists(doctorId),
  ]);
  if (!patientFound) {
    throw new ApiError(404, "Patient not found");
  }
  if (!doctorFound) {
    throw new ApiError(404, "Doctor not found");
  }
  for (const serviceId of serviceIds) {
    await ensureServiceBookableForDoctor(appointmentsRepository, serviceId, doctorId, options);
  }
};

/** The booked slot covers every service of the visit, not only the primary one. */
const totalServicesDuration = async (
  appointmentsRepository: IAppointmentsRepository,
  serviceIds: number[]
): Promise<number> => {
  let total = 0;
  for (const serviceId of new Set(serviceIds)) {
    const duration = await appointmentsRepository.getServiceDuration(serviceId);
    if (!duration || duration <= 0) {
      throw new ApiError(400, "Service duration must be configured and greater than 0");
    }
    total += duration;
  }
  return total;
};

const catalogPrice = async (
  appointmentsRepository: IAppointmentsRepository,
  serviceId: number
): Promise<number> => {
  const price = await appointmentsRepository.getServicePrice(serviceId);
  if (price === null || price < 0) {
    throw new ApiError(400, "Service price is invalid");
  }
  return price;
};

const bookedServiceIds = (appointment: Appointment): number[] =>
  appointment.services?.length
    ? appointment.services.map((line) => line.serviceId)
    : [appointment.serviceId];

const ensureNoDoctorConflict = async (
  appointmentsRepository: IAppointmentsRepository,
  doctorId: number,
  startAt: string,
  endAt: string,
  excludeAppointmentId?: number
): Promise<void> => {
  const hasConflict = await appointmentsRepository.findConflicting(
    doctorId,
    startAt,
    endAt,
    excludeAppointmentId
  );

  if (hasConflict) {
    throw new ApiError(409, "У врача уже есть запись на это время");
  }
};

const ensureValidDateRange = (startAt: string, endAt: string): void => {
  const start = parseLocalDateTime(startAt);
  const end = parseLocalDateTime(endAt);
  if (!start || !end || end.getTime() <= start.getTime()) {
    throw new ApiError(400, "Field 'endAt' must be greater than 'startAt'");
  }
};

const ensureStartAtNotInPast = (startAt: string): void => {
  const start = parseLocalDateTime(startAt);
  if (!start) {
    throw new ApiError(400, "Field 'startAt' must be in format YYYY-MM-DD HH:mm:ss");
  }
  if (start.getTime() < Date.now()) {
    throw new ApiError(400, "Cannot create appointment in the past");
  }
};


const addMinutesToLocalDateTime = (
  localDateTime: string,
  durationMinutes: number
): string => {
  const start = parseLocalDateTime(localDateTime);
  if (!start) {
    throw new ApiError(400, "Field 'startAt' must be in format YYYY-MM-DD HH:mm:ss");
  }
  const end = new Date(start.getTime());
  end.setMinutes(end.getMinutes() + durationMinutes);
  return formatLocalDateTime(end);
};

const enforceDoctorSelfScopeOnWrite = (
  auth: AuthTokenPayload,
  doctorId: number
): void => {
  if (!isDoctorScopedRole(auth.role)) {
    return;
  }
  if (doctorId !== getEffectiveDoctorId(auth)) {
    throw new ApiError(403, "Можно работать только с записями своего врача");
  }
};

const ensureStatusTransitionAllowed = (
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus
): void => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  if (!allowedNextStatuses.includes(nextStatus)) {
    throw new ApiError(
      400,
      `Invalid status transition: '${currentStatus}' -> '${nextStatus}'`
    );
  }
};

const normalizeCreateInput = (
  payload: AppointmentCreateInput
): AppointmentCreateInput => {
  const extended = payload as AppointmentCreateInput & {
    serviceLines?: unknown;
    services?: unknown;
  };
  const serviceLinesRaw = extended.serviceLines ?? extended.services;
  return {
    ...payload,
    billingStatus: payload.billingStatus ?? "draft",
    price: normalizeOptionalPrice(payload.price),
    quantity: normalizeOptionalQuantity(payload.quantity),
    serviceLines: normalizeServiceLinesPayload(serviceLinesRaw),
    diagnosis: normalizeOptionalString(payload.diagnosis) ?? null,
    treatment: normalizeOptionalString(payload.treatment) ?? null,
    notes: normalizeOptionalString(payload.notes) ?? null,
  };
};

const normalizeUpdateInput = (
  payload: AppointmentUpdateInput
): AppointmentUpdateInput => {
  const normalized: AppointmentUpdateInput = { ...payload };
  // Complete-route payloads may carry an explicit undefined; preserve saved dates
  // consistently with SQL, whose optional column updates already ignore it.
  if (payload.recommendedReturnDate === undefined) delete normalized.recommendedReturnDate;
  if (payload.price !== undefined) {
    normalized.price = normalizeOptionalPrice(payload.price);
  }
  if (payload.diagnosis !== undefined) {
    normalized.diagnosis = normalizeOptionalString(payload.diagnosis);
  }
  if (payload.treatment !== undefined) {
    normalized.treatment = normalizeOptionalString(payload.treatment);
  }
  if (payload.notes !== undefined) {
    normalized.notes = normalizeOptionalString(payload.notes);
  }
  return normalized;
};

export class AppointmentsService {
  constructor(private readonly appointmentsRepository: IAppointmentsRepository) {}

  async list(
    auth: AuthTokenPayload,
    filters: AppointmentFilters = {}
  ): Promise<Appointment[]> {
    const scoped = mergeAppointmentFiltersForUser(auth, filters);
    const safeFilters: AppointmentFilters = { ...scoped };
    const from = assertOptionalAppointmentTimestampForDb(
      scoped.startFrom,
      "startFrom"
    );
    const rawUpper = scoped.startTo ?? scoped.endTo;
    const to = assertOptionalAppointmentTimestampForDb(rawUpper, "startTo");
    if (from != null) {
      safeFilters.startFrom = from;
    } else {
      delete safeFilters.startFrom;
    }
    if (to != null) {
      safeFilters.startTo = to;
    } else {
      delete safeFilters.startTo;
    }
    delete safeFilters.endTo;

    const rows = await this.appointmentsRepository.findAll(safeFilters);
    if (!shouldRedactAppointmentClinicalFields(auth.role)) {
      return rows;
    }
    return rows.map(redactAppointmentClinicalFields);
  }

  async getById(auth: AuthTokenPayload, id: number): Promise<Appointment | null> {
    const row = await this.appointmentsRepository.findById(id);
    if (!row) {
      return null;
    }
    if (!canReadAppointment(auth, row)) {
      return null;
    }
    if (shouldRedactAppointmentClinicalFields(auth.role)) {
      return redactAppointmentClinicalFields(row);
    }
    return row;
  }

  async create(
    auth: AuthTokenPayload,
    payload: AppointmentCreateInput
  ): Promise<Appointment> {
    if (!roleHasPermissionKey(auth.role, "APPOINTMENT_CREATE")) {
      throw new ApiError(403, "Недостаточно прав для этого действия");
    }
    const rawIn = payload as AppointmentCreateInput;
    const mergedForNormalize: AppointmentCreateInput =
      auth.role === "doctor"
        ? {
            ...rawIn,
            doctorId: getEffectiveDoctorId(auth),
          }
        : rawIn;
    const normalizedPayload = normalizeCreateInput(mergedForNormalize);
    normalizedPayload.startAt = assertAppointmentTimestampForDb(
      normalizedPayload.startAt,
      "startAt"
    );
    assertAppointmentClinicalWriteAllowed(auth, {
      diagnosis: normalizedPayload.diagnosis ?? undefined,
      treatment: normalizedPayload.treatment ?? undefined,
      recommendedReturnDate: normalizedPayload.recommendedReturnDate,
      notes: normalizedPayload.notes ?? undefined,
    });
    validateRecommendedReturnDate(normalizedPayload.recommendedReturnDate, normalizedPayload.startAt);
    enforceDoctorSelfScopeOnWrite(auth, normalizedPayload.doctorId);

    if (auth.role === "doctor") {
      const okPatient = await this.appointmentsRepository.isPatientEligibleForDoctorBooking(
        normalizedPayload.patientId,
        normalizedPayload.doctorId
      );
      if (!okPatient) {
        throw new ApiError(403, "Patient cannot be booked by this doctor");
      }
      normalizedPayload.createdByDoctorId = auth.doctorId ?? null;
      normalizedPayload.createdByUserId = auth.userId;
    }
    ensureStartAtNotInPast(normalizedPayload.startAt);

    const serviceIds = Array.from(
      new Set([
        normalizedPayload.serviceId,
        ...(normalizedPayload.serviceLines ?? []).map((line) => line.serviceId),
      ])
    );
    await ensureRelatedEntitiesExist(
      this.appointmentsRepository,
      normalizedPayload.patientId,
      normalizedPayload.doctorId,
      serviceIds,
      { requireActiveService: true }
    );

    const duration = await totalServicesDuration(this.appointmentsRepository, serviceIds);
    const computedEndAt = addMinutesToLocalDateTime(normalizedPayload.startAt, duration);
    ensureValidDateRange(normalizedPayload.startAt, computedEndAt);
    const servicePrice = await catalogPrice(this.appointmentsRepository, normalizedPayload.serviceId);

    if (!canSetAppointmentCommercialPrice(auth.role)) {
      // Booking access does not grant commercial-price access. Ignore client prices
      // (including normal catalog values sent by the form) and derive every fee.
      normalizedPayload.price = Math.round(servicePrice);
      if (normalizedPayload.serviceLines?.length) {
        normalizedPayload.serviceLines = await Promise.all(
          normalizedPayload.serviceLines.map(async (line) => ({
            ...line,
            price: Math.round(await catalogPrice(this.appointmentsRepository, line.serviceId)),
          }))
        );
      }
    }

    const payloadToCreate: AppointmentCreateInput = {
      ...normalizedPayload,
      price: normalizedPayload.price ?? Math.round(servicePrice),
      endAt: computedEndAt,
    };

    if (ACTIVE_APPOINTMENT_STATUSES.has(payloadToCreate.status)) {
      await ensureNoDoctorConflict(
        this.appointmentsRepository,
        payloadToCreate.doctorId,
        payloadToCreate.startAt,
        payloadToCreate.endAt
      );
    }

    const created = await this.appointmentsRepository.create(payloadToCreate);
    invalidateClinicFactsCache();
    if (shouldRedactAppointmentClinicalFields(auth.role)) {
      return redactAppointmentClinicalFields(created);
    }
    return created;
  }

  async update(
    auth: AuthTokenPayload,
    id: number,
    payload: AppointmentUpdateInput
  ): Promise<Appointment | null> {
    const current = await this.appointmentsRepository.findById(id);
    if (!current) {
      return null;
    }
    if (!canReadAppointment(auth, current)) {
      return null;
    }

    const normalizedPayload = normalizeUpdateInput(payload);
    // Services have one write path (replaceServices) that keeps lines, price and slot consistent.
    if (normalizedPayload.serviceId !== undefined && normalizedPayload.serviceId !== current.serviceId) {
      throw new ApiError(400, "Услуги записи меняются через PUT /appointments/:id/services");
    }
    delete normalizedPayload.serviceId;
    if (normalizedPayload.startAt !== undefined) {
      normalizedPayload.startAt = assertAppointmentTimestampForDb(
        normalizedPayload.startAt,
        "startAt"
      );
    }
    assertAppointmentClinicalWriteAllowed(auth, {
      diagnosis: normalizedPayload.diagnosis,
      treatment: normalizedPayload.treatment,
      recommendedReturnDate: normalizedPayload.recommendedReturnDate,
      notes: normalizedPayload.notes,
    });
    validateRecommendedReturnDate(
      normalizedPayload.recommendedReturnDate === undefined ? current.recommendedReturnDate : normalizedPayload.recommendedReturnDate,
      normalizedPayload.startAt ?? current.startAt
    );

    const isClinicalStaff = isDoctorScopedRole(auth.role);
    if (isClinicalStaff) {
      const strictSchedulingKeys: (keyof AppointmentUpdateInput)[] = [
        "patientId",
        "doctorId",
        "serviceId",
        "price",
      ];
      for (const key of strictSchedulingKeys) {
        if (normalizedPayload[key] === undefined) continue;
        const nextVal = normalizedPayload[key];
        const curVal = current[key as keyof Appointment] as unknown;
        if (nextVal !== curVal) {
          throw new ApiError(
            403,
            "Нельзя менять пациента, врача, услугу, время или цену записи для этой роли"
          );
        }
      }
      if (normalizedPayload.startAt !== undefined) {
        if (auth.role === "nurse") {
          throw new ApiError(
            403,
            "Нельзя менять пациента, врача, услугу, время или цену записи для этой роли"
          );
        }
        if (auth.role === "doctor") {
          if (current.doctorId !== getEffectiveDoctorId(auth)) {
            throw new ApiError(403, "Недостаточно прав для изменения времени записи");
          }
        }
      }
    } else if (
      normalizedPayload.price !== undefined &&
      !canSetAppointmentCommercialPrice(auth.role)
    ) {
      throw new ApiError(403, "Недостаточно прав для изменения цены записи");
    }

    if (Object.keys(normalizedPayload).length === 0) {
      throw new ApiError(400, "At least one field must be provided for update");
    }

    const mergedStatus = normalizedPayload.status ?? current.status;
    const nextBillingStatus: AppointmentBillingStatus | undefined =
      mergedStatus === "completed" && normalizedPayload.status !== undefined
        ? "ready_for_payment"
        : undefined;
    const mergedPatientId = normalizedPayload.patientId ?? current.patientId;
    const mergedDoctorId = normalizedPayload.doctorId ?? current.doctorId;
    enforceDoctorSelfScopeOnWrite(auth, mergedDoctorId);
    const mergedStartAt = normalizedPayload.startAt ?? current.startAt;
    let mergedEndAt = current.endAt;

    if (normalizedPayload.startAt !== undefined) {
      ensureStartAtNotInPast(mergedStartAt);
    }

    if (normalizedPayload.startAt !== undefined) {
      const duration = await totalServicesDuration(
        this.appointmentsRepository,
        bookedServiceIds(current)
      );
      const recalculatedEndAt = addMinutesToLocalDateTime(mergedStartAt, duration);
      ensureValidDateRange(mergedStartAt, recalculatedEndAt);
      normalizedPayload.endAt = recalculatedEndAt;
      mergedEndAt = recalculatedEndAt;
    }

    ensureValidDateRange(mergedStartAt, mergedEndAt);
    ensureStatusTransitionAllowed(current.status, mergedStatus);

    // Booked services were validated when added; recheck them only for a new doctor so that
    // later catalog changes do not block status updates of existing visits.
    const doctorChanged = mergedDoctorId !== current.doctorId;
    await ensureRelatedEntitiesExist(
      this.appointmentsRepository,
      mergedPatientId,
      mergedDoctorId,
      doctorChanged ? bookedServiceIds(current) : [],
      { requireActiveService: false }
    );

    if (ACTIVE_APPOINTMENT_STATUSES.has(mergedStatus)) {
      await ensureNoDoctorConflict(
        this.appointmentsRepository,
        mergedDoctorId,
        mergedStartAt,
        mergedEndAt,
        id
      );
    }

    const updatedPayload =
      nextBillingStatus === undefined
        ? normalizedPayload
        : { ...normalizedPayload, billingStatus: nextBillingStatus };
    const updated = await this.appointmentsRepository.update(id, updatedPayload);
    if (updated) invalidateClinicFactsCache();
    if (!updated) {
      return null;
    }
    if (shouldRedactAppointmentClinicalFields(auth.role)) {
      return redactAppointmentClinicalFields(updated);
    }
    return updated;
  }

  async cancel(
    auth: AuthTokenPayload,
    id: number,
    cancelReason?: string | null
  ): Promise<Appointment | null> {
    const current = await this.appointmentsRepository.findById(id);
    if (!current) {
      return null;
    }
    if (!canReadAppointment(auth, current)) {
      return null;
    }
    if (auth.role === "doctor") {
      if (!DOCTOR_CANCELLABLE_STATUSES.has(current.status)) {
        throw new ApiError(403, "Cannot cancel appointment in this status");
      }
      const trimmed = typeof cancelReason === "string" ? cancelReason.trim() : "";
      const reasonForDb = trimmed === "" ? "Отменено врачом" : trimmed;
      const cancelled = await this.appointmentsRepository.cancel(
        id,
        reasonForDb,
        auth.userId,
        "doctor"
      );
      if (cancelled) {
        invalidateClinicFactsCache();
      }
      if (!cancelled) {
        return null;
      }
      if (shouldRedactAppointmentClinicalFields(auth.role)) {
        return redactAppointmentClinicalFields(cancelled);
      }
      return cancelled;
    }
    if (current.status === "completed") {
      throw new ApiError(400, "Completed appointment cannot be cancelled");
    }
    if (current.status === "cancelled") {
      throw new ApiError(400, "Appointment already cancelled");
    }
    const cancelled = await this.appointmentsRepository.cancel(
      id,
      cancelReason ?? null,
      auth.userId,
      null
    );
    if (cancelled) {
      invalidateClinicFactsCache();
    }
    if (!cancelled) {
      return null;
    }
    if (shouldRedactAppointmentClinicalFields(auth.role)) {
      return redactAppointmentClinicalFields(cancelled);
    }
    return cancelled;
  }

  async updatePrice(
    auth: AuthTokenPayload,
    id: number,
    price: number
  ): Promise<Appointment | null> {
    if (!canSetAppointmentCommercialPrice(auth.role)) {
      throw new ApiError(403, "Недостаточно прав для изменения цены записи");
    }
    const current = await this.appointmentsRepository.findById(id);
    if (!current) {
      return null;
    }
    if (!canReadAppointment(auth, current)) {
      return null;
    }
    if (current.status === "cancelled") {
      throw new ApiError(400, "Нельзя менять цену у отмененной записи");
    }
    if (current.status === "completed") {
      throw new ApiError(400, "Нельзя менять цену у завершенной записи");
    }
    const normalizedPrice = normalizeOptionalPrice(price);
    if (normalizedPrice === null || normalizedPrice === undefined) {
      throw new ApiError(400, "Field 'price' must be a number greater than or equal to 0");
    }
    const updated = await this.appointmentsRepository.updatePrice(id, normalizedPrice);
    if (updated) {
      invalidateClinicFactsCache();
    }
    if (!updated) {
      return null;
    }
    if (shouldRedactAppointmentClinicalFields(auth.role)) {
      return redactAppointmentClinicalFields(updated);
    }
    return updated;
  }

  async delete(auth: AuthTokenPayload, id: number): Promise<boolean> {
    if (auth.role !== "superadmin") {
      throw new ApiError(403, "Только superadmin может полностью удалять записи");
    }
    const current = await this.appointmentsRepository.findById(id);
    if (!current) {
      return false;
    }
    const ok = await this.appointmentsRepository.delete(id);
    if (ok) invalidateClinicFactsCache();
    return ok;
  }

  /**
   * Проверка пересечения с активными записями врача для выбранного слота.
   * `date` — YYYY-MM-DD, `time` — HH:mm:ss (или HH:mm — нормализуйте на уровне контроллера).
   */
  async checkAvailability(
    auth: AuthTokenPayload,
    params: { doctorId: number; serviceIds: number[]; date: string; time: string }
  ): Promise<{ available: boolean }> {
    enforceDoctorSelfScopeOnWrite(auth, params.doctorId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      throw new ApiError(400, "Query param 'date' must be YYYY-MM-DD");
    }

    const normalizedTime =
      params.time.length === 5 ? `${params.time}:00` : params.time;
    if (!/^\d{2}:\d{2}:\d{2}$/.test(normalizedTime)) {
      throw new ApiError(400, "Query param 'time' must be HH:mm or HH:mm:ss");
    }

    const startAtRaw = `${params.date} ${normalizedTime}`;
    const startAt = tryParseAppointmentTimestampForDb(startAtRaw);
    if (!startAt) {
      throw new ApiError(400, "Invalid date or time");
    }

    const doctorFound = await this.appointmentsRepository.doctorExists(params.doctorId);
    if (!doctorFound) {
      throw new ApiError(404, "Doctor not found");
    }

    const duration = await totalServicesDuration(this.appointmentsRepository, params.serviceIds);
    const endAt = addMinutesToLocalDateTime(startAt, duration);
    ensureValidDateRange(startAt, endAt);

    const hasConflict = await this.appointmentsRepository.findConflicting(
      params.doctorId,
      startAt,
      endAt
    );

    return { available: !hasConflict };
  }

  async listAssignedServices(
    auth: AuthTokenPayload,
    appointmentId: number
  ): Promise<AppointmentServiceAssignment[]> {
    const appointment = await this.appointmentsRepository.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }
    if (!canReadAppointment(auth, appointment)) {
      throw new ApiError(403, "Недостаточно прав");
    }
    return this.appointmentsRepository.listServiceAssignments(appointmentId);
  }

  /**
   * Replaces all services of a booked visit. The first line becomes the primary service.
   * Kept services keep their price and quantity; new ones take the catalog price unless the
   * role may set commercial prices. Before the visit starts the slot is resized to the services.
   */
  async replaceServices(
    auth: AuthTokenPayload,
    appointmentId: number,
    lines: AppointmentServiceLineCreateInput[]
  ): Promise<Appointment> {
    if (!SERVICE_EDITOR_ROLES.has(auth.role)) {
      throw new ApiError(403, "Недостаточно прав для изменения услуг записи");
    }
    const current = await this.appointmentsRepository.findById(appointmentId);
    if (!current || !canReadAppointment(auth, current)) {
      throw new ApiError(404, "Appointment not found");
    }
    enforceDoctorSelfScopeOnWrite(auth, current.doctorId);
    if (!ACTIVE_APPOINTMENT_STATUSES.has(current.status)) {
      throw new ApiError(400, "Услуги можно менять только до завершения приёма");
    }
    if (current.billingStatus === "paid") {
      throw new ApiError(409, "Нельзя изменять услуги после оплаты");
    }

    const kept = new Map(
      (await this.appointmentsRepository.listServiceAssignments(appointmentId)).map((line) => [
        line.serviceId,
        line,
      ])
    );
    const canSetPrice = canSetAppointmentCommercialPrice(auth.role);
    const resolved: AppointmentServiceLineReplacement[] = [];
    for (const line of lines) {
      if (resolved.some((row) => row.serviceId === line.serviceId)) continue;
      const previous = kept.get(line.serviceId);
      if (!previous) {
        await ensureServiceBookableForDoctor(
          this.appointmentsRepository,
          line.serviceId,
          current.doctorId,
          { requireActiveService: true }
        );
      }
      const price =
        canSetPrice && line.price != null
          ? line.price
          : previous?.price ?? (await catalogPrice(this.appointmentsRepository, line.serviceId));
      resolved.push({
        serviceId: line.serviceId,
        price: roundMoney2(price),
        quantity: line.quantity ?? previous?.quantity ?? 1,
      });
    }
    if (resolved.length === 0) {
      throw new ApiError(400, "Выберите хотя бы одну услугу");
    }

    let endAt: string | undefined;
    if (RESCHEDULABLE_STATUSES.has(current.status)) {
      const duration = await totalServicesDuration(
        this.appointmentsRepository,
        resolved.map((line) => line.serviceId)
      );
      endAt = addMinutesToLocalDateTime(current.startAt, duration);
      await ensureNoDoctorConflict(
        this.appointmentsRepository,
        current.doctorId,
        current.startAt,
        endAt,
        appointmentId
      );
    }

    const updated = await this.appointmentsRepository.replaceServiceLines(appointmentId, resolved, {
      endAt,
      updatedBy: auth.userId,
    });
    if (!updated) {
      throw new ApiError(404, "Appointment not found");
    }
    invalidateClinicFactsCache();
    return shouldRedactAppointmentClinicalFields(auth.role)
      ? redactAppointmentClinicalFields(updated)
      : updated;
  }
}

