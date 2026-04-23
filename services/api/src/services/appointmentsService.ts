import {
  type IAppointmentsRepository,
} from "../repositories/interfaces/IAppointmentsRepository";
import type {
  Appointment,
  AppointmentBillingStatus,
  AppointmentCreateInput,
  AppointmentFilters,
  AppointmentServiceAssignment,
  AppointmentStatus,
  AppointmentUpdateInput,
} from "../repositories/interfaces/coreTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
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
import { parseNumericInput } from "../utils/numbers";

const ACTIVE_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "scheduled",
  "confirmed",
  "arrived",
  "in_consultation",
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

const ensureRelatedEntitiesExist = async (
  appointmentsRepository: IAppointmentsRepository,
  patientId: number,
  doctorId: number,
  serviceId: number,
  options: { requireActiveService: boolean }
): Promise<void> => {
  const [patientFound, doctorFound, serviceFound] = await Promise.all([
    appointmentsRepository.patientExists(patientId),
    appointmentsRepository.doctorExists(doctorId),
    appointmentsRepository.serviceExists(serviceId),
  ]);

  if (!patientFound) {
    throw new ApiError(404, "Patient not found");
  }
  if (!doctorFound) {
    throw new ApiError(404, "Doctor not found");
  }
  if (!serviceFound) {
    throw new ApiError(404, "Service not found");
  }

  if (options.requireActiveService) {
    const active = await appointmentsRepository.isServiceActive(serviceId);
    if (!active) {
      throw new ApiError(400, "Service is inactive or not available for booking");
    }
  }

  const serviceAssigned = await appointmentsRepository.isServiceAssignedToDoctor(
    serviceId,
    doctorId
  );
  if (!serviceAssigned) {
    throw new ApiError(400, "Selected service is not assigned to selected doctor");
  }
};

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
    throw new ApiError(409, "Doctor already has an appointment in this time slot");
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
  return {
    ...payload,
    billingStatus: payload.billingStatus ?? "draft",
    price: normalizeOptionalPrice(payload.price),
    diagnosis: normalizeOptionalString(payload.diagnosis) ?? null,
    treatment: normalizeOptionalString(payload.treatment) ?? null,
    notes: normalizeOptionalString(payload.notes) ?? null,
  };
};

const normalizeUpdateInput = (
  payload: AppointmentUpdateInput
): AppointmentUpdateInput => {
  const normalized: AppointmentUpdateInput = { ...payload };
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
    const normalizedPayload = normalizeCreateInput(payload);
    normalizedPayload.startAt = assertAppointmentTimestampForDb(
      normalizedPayload.startAt,
      "startAt"
    );
    assertAppointmentClinicalWriteAllowed(auth, {
      diagnosis: normalizedPayload.diagnosis ?? undefined,
      treatment: normalizedPayload.treatment ?? undefined,
      notes: normalizedPayload.notes ?? undefined,
    });
    enforceDoctorSelfScopeOnWrite(auth, normalizedPayload.doctorId);
    ensureStartAtNotInPast(normalizedPayload.startAt);

    await ensureRelatedEntitiesExist(
      this.appointmentsRepository,
      normalizedPayload.patientId,
      normalizedPayload.doctorId,
      normalizedPayload.serviceId,
      { requireActiveService: true }
    );

    const duration = await this.appointmentsRepository.getServiceDuration(
      normalizedPayload.serviceId
    );
    if (!duration || duration <= 0) {
      throw new ApiError(400, "Service duration must be configured and greater than 0");
    }
    const computedEndAt = addMinutesToLocalDateTime(normalizedPayload.startAt, duration);
    ensureValidDateRange(normalizedPayload.startAt, computedEndAt);
    const servicePrice = await this.appointmentsRepository.getServicePrice(
      normalizedPayload.serviceId
    );
    if (servicePrice === null || servicePrice < 0) {
      throw new ApiError(400, "Service price is invalid");
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
    if (normalizedPayload.startAt !== undefined) {
      normalizedPayload.startAt = assertAppointmentTimestampForDb(
        normalizedPayload.startAt,
        "startAt"
      );
    }
    assertAppointmentClinicalWriteAllowed(auth, {
      diagnosis: normalizedPayload.diagnosis,
      treatment: normalizedPayload.treatment,
      notes: normalizedPayload.notes,
    });

    const isClinicalStaff = isDoctorScopedRole(auth.role);
    if (isClinicalStaff) {
      const schedulingKeys: (keyof AppointmentUpdateInput)[] = [
        "patientId",
        "doctorId",
        "serviceId",
        "startAt",
        "price",
      ];
      for (const key of schedulingKeys) {
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
    const mergedServiceId = normalizedPayload.serviceId ?? current.serviceId;
    const mergedStartAt = normalizedPayload.startAt ?? current.startAt;
    let mergedEndAt = current.endAt;

    const shouldRecalculateEndAt =
      normalizedPayload.startAt !== undefined || normalizedPayload.serviceId !== undefined;

    if (shouldRecalculateEndAt) {
      const duration = await this.appointmentsRepository.getServiceDuration(mergedServiceId);
      if (!duration || duration <= 0) {
        throw new ApiError(400, "Service duration must be configured and greater than 0");
      }
      const recalculatedEndAt = addMinutesToLocalDateTime(mergedStartAt, duration);
      ensureValidDateRange(mergedStartAt, recalculatedEndAt);
      normalizedPayload.endAt = recalculatedEndAt;
      mergedEndAt = recalculatedEndAt;
    }

    ensureValidDateRange(mergedStartAt, mergedEndAt);
    ensureStatusTransitionAllowed(current.status, mergedStatus);

    await ensureRelatedEntitiesExist(
      this.appointmentsRepository,
      mergedPatientId,
      mergedDoctorId,
      mergedServiceId,
      { requireActiveService: normalizedPayload.serviceId !== undefined }
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
    if (current.status === "completed") {
      throw new ApiError(400, "Completed appointment cannot be cancelled");
    }
    if (current.status === "cancelled") {
      throw new ApiError(400, "Appointment already cancelled");
    }
    const cancelled = await this.appointmentsRepository.cancel(
      id,
      cancelReason ?? null,
      auth.userId
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
    const current = await this.appointmentsRepository.findById(id);
    if (!current) {
      return false;
    }
    if (!canReadAppointment(auth, current)) {
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
    params: { doctorId: number; serviceId: number; date: string; time: string }
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

    const duration = await this.appointmentsRepository.getServiceDuration(params.serviceId);
    if (!duration || duration <= 0) {
      throw new ApiError(400, "Service duration must be configured and greater than 0");
    }

    const endAt = addMinutesToLocalDateTime(startAt, duration);
    ensureValidDateRange(startAt, endAt);

    const hasConflict = await this.appointmentsRepository.findConflicting(
      params.doctorId,
      startAt,
      endAt
    );

    return { available: !hasConflict };
  }

  async assignService(
    auth: AuthTokenPayload,
    appointmentId: number,
    serviceId: number
  ): Promise<AppointmentServiceAssignment> {
    if (auth.role !== "doctor") {
      throw new ApiError(403, "Только врач может назначать услуги в приеме");
    }
    const appointment = await this.appointmentsRepository.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }
    enforceDoctorSelfScopeOnWrite(auth, appointment.doctorId);
    if (appointment.status !== "in_consultation" && appointment.status !== "arrived") {
      throw new ApiError(400, "Услуги можно назначать только во время приема");
    }
    const serviceExists = await this.appointmentsRepository.serviceExists(serviceId);
    if (!serviceExists) {
      throw new ApiError(404, "Service not found");
    }
    const isAssigned = await this.appointmentsRepository.isServiceAssignedToDoctor(
      serviceId,
      appointment.doctorId
    );
    if (!isAssigned) {
      throw new ApiError(400, "Selected service is not assigned to selected doctor");
    }
    return this.appointmentsRepository.createServiceAssignment(
      appointmentId,
      serviceId,
      auth.userId
    );
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
}

