import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestJson } from "../../../../api/http";
import { Modal } from "../../../../components/ui/Modal";
import type { Doctor, Patient, Service } from "../../api/appointmentsFlowApi";
import { appointmentsFlowApi } from "../../api/appointmentsFlowApi";
import { PatientAutocompleteInput } from "../../components/PatientAutocompleteInput";
import { formatSum } from "../../../../utils/formatMoney";
import { coercePriceToNumber } from "../../../../shared/lib/money";
import { MoneyInput } from "../../../../shared/ui/MoneyInput";
import { PhoneInput } from "../../../../shared/ui/PhoneInput";
import { phoneToApiValue } from "../../../../utils/phoneInput";
import { normalizeDateTimeForApi, nextQuarterHourTimeHm, todayYmd } from "../../utils/appointmentFormUtils";
import {
  quickModalComboboxInputClass,
  quickModalInputClass,
  quickModalLabelClass,
  quickModalSelectClass,
} from "../../utils/modalFieldClasses";
import { useDebouncedAppointmentSlotAvailability } from "../../hooks/useDebouncedAppointmentSlotAvailability";

export type AppointmentQuickCreateModalProps = {
  open: boolean;
  onClose: () => void;
  /** Вызывается после успешного POST записи — обновить списки на странице */
  onCreated: () => void | Promise<void>;
  token: string | null;
  /** После создания пациента из общей модалки — подставить в форму */
  resumePatient?: Patient | null;
  onResumePatientConsumed?: () => void;
  /** Если false — нет UI «новый пациент» (роль без patients:create). */
  canCreateNewPatient?: boolean;
};

export const AppointmentQuickCreateModal: React.FC<AppointmentQuickCreateModalProps> = ({
  open,
  onClose,
  onCreated,
  token,
  resumePatient,
  onResumePatientConsumed,
  canCreateNewPatient = true,
}) => {
  const { t } = useTranslation();
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [doctorId, setDoctorId] = useState<number | "">("");
  const [doctorOptions, setDoctorOptions] = useState<Doctor[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [serviceId, setServiceId] = useState<number | "">("");
  const [price, setPrice] = useState(0);

  const [date, setDate] = useState(todayYmd());
  const [time, setTime] = useState(nextQuarterHourTimeHm());

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [doctorsLoadError, setDoctorsLoadError] = useState<string | null>(null);

  const [miniPatientOpen, setMiniPatientOpen] = useState(false);
  const [miniName, setMiniName] = useState("");
  const [miniPhone, setMiniPhone] = useState("");
  const [miniSaving, setMiniSaving] = useState(false);
  const [miniError, setMiniError] = useState<string | null>(null);

  const patientInputRef = useRef<HTMLInputElement>(null);
  const miniNameInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setPatientQuery("");
    setSelectedPatient(null);
    setDoctorId("");
    setServices([]);
    setServiceId("");
    setPrice(0);
    setDate(todayYmd());
    setTime(nextQuarterHourTimeHm());
    setFormError(null);
    setDoctorsLoadError(null);
    setMiniPatientOpen(false);
    setMiniName("");
    setMiniPhone("");
    setMiniSaving(false);
    setMiniError(null);
  }, []);

  const openMiniPatient = useCallback((prefillName?: string) => {
    setMiniError(null);
    const name = (prefillName !== undefined ? prefillName : patientQuery).trim();
    setMiniName(name);
    setMiniPhone("");
    setMiniPatientOpen(true);
    window.setTimeout(() => miniNameInputRef.current?.focus(), 0);
  }, [patientQuery]);

  const closeMiniPatient = useCallback(() => {
    if (miniSaving) return;
    setMiniPatientOpen(false);
    setMiniError(null);
    window.setTimeout(() => patientInputRef.current?.focus(), 0);
  }, [miniSaving]);

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    const id = window.setTimeout(() => patientInputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [open, resetForm]);

  useEffect(() => {
    if (!canCreateNewPatient && miniPatientOpen) {
      setMiniPatientOpen(false);
    }
  }, [canCreateNewPatient, miniPatientOpen]);

  useEffect(() => {
    if (!open || !resumePatient) return;
    setMiniPatientOpen(false);
    setSelectedPatient(resumePatient);
    setPatientQuery(resumePatient.fullName);
    onResumePatientConsumed?.();
  }, [open, resumePatient, onResumePatientConsumed]);

  useEffect(() => {
    if (!open || !token) return;
    setLoadingDoctors(true);
    setDoctorsLoadError(null);
    void appointmentsFlowApi
      .listDoctors(token)
      .then((rows) => {
        setDoctorOptions(rows);
        setDoctorsLoadError(null);
      })
      .catch(() => {
        setDoctorOptions([]);
        setDoctorsLoadError(t("appointments.doctorsLoadError"));
      })
      .finally(() => setLoadingDoctors(false));
  }, [open, token]);

  useEffect(() => {
    if (!open || !token) return;

    if (doctorId === "") {
      setServices([]);
      setServiceId("");
      setLoadingServices(false);
      return;
    }

    let cancelled = false;
    setLoadingServices(true);
    setServices([]);
    setServiceId("");

    const loadServicesByDoctor = async (id: number) => {
      try {
        const data = await requestJson<Service[]>(`/api/services?doctorId=${encodeURIComponent(String(id))}`, {
          token,
        });
        if (cancelled) return;
        setServices(data);
        if (data.length === 1) {
          setServiceId(data[0].id);
        } else {
          setServiceId("");
        }
      } catch (e) {
        console.error(t("appointments.servicesLoadError"), e);
        if (!cancelled) {
          setServices([]);
          setServiceId("");
        }
      } finally {
        if (!cancelled) setLoadingServices(false);
      }
    };

    void loadServicesByDoctor(doctorId);
    return () => {
      cancelled = true;
    };
  }, [open, token, doctorId]);

  useEffect(() => {
    const selectedService =
      typeof serviceId === "number"
        ? services.find((service) => service.id === serviceId)
        : services.length === 1
          ? services[0]
          : null;
    if (!selectedService) {
      setPrice(0);
      return;
    }
    setPrice(Math.round(coercePriceToNumber(selectedService.price)));
  }, [serviceId, services]);

  const resolvedServiceId: number | null =
    typeof serviceId === "number"
      ? serviceId
      : services.length === 1
        ? services[0].id
        : null;

  const slotAvailabilityPhase = useDebouncedAppointmentSlotAvailability(
    token,
    {
      doctorId: typeof doctorId === "number" ? String(doctorId) : "",
      serviceId: resolvedServiceId != null ? String(resolvedServiceId) : "",
      date,
      time,
    },
    open && Boolean(token)
  );
  const slotAvailabilityPhaseRef = useRef(slotAvailabilityPhase);
  slotAvailabilityPhaseRef.current = slotAvailabilityPhase;

  const submitMiniPatient = async () => {
    if (!token || miniSaving) return;
    const name = miniName.trim();
    if (name.length < 2) {
      setMiniError(t("appointments.minNameError"));
      return;
    }
    const apiPhone = phoneToApiValue(miniPhone);
    const digits = apiPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      setMiniError(t("appointments.invalidPhoneError"));
      return;
    }

    setMiniSaving(true);
    setMiniError(null);
    try {
      const created = await appointmentsFlowApi.createPatient(token, {
        fullName: name,
        phone: apiPhone,
        birthDate: null,
        gender: null,
      });
      setSelectedPatient(created);
      setPatientQuery(created.fullName);
      setMiniPatientOpen(false);
      setMiniName("");
      setMiniPhone("");
    } catch (err) {
      setMiniError(err instanceof Error ? err.message : t("appointments.createPatientError"));
    } finally {
      setMiniSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!token) {
      setFormError(t("appointments.invalidSession"));
      return;
    }
    if (!selectedPatient) {
      setFormError(t("appointments.selectPatientOrCreate"));
      return;
    }
    if (doctorId === "") {
      setFormError(t("appointments.selectDoctorError"));
      return;
    }
    const sid = resolvedServiceId;
    if (!sid) {
      setFormError(t("appointments.noDoctorServices"));
      return;
    }
    if (!services.some((s) => s.id === sid)) {
      setFormError(t("appointments.selectServiceError"));
      return;
    }
    if (!date || !time) {
      setFormError(t("appointments.selectDateTimeError"));
      return;
    }
    const startAt = normalizeDateTimeForApi(date, time);
    if (!startAt) {
      setFormError(t("appointments.invalidDateTimeError"));
      return;
    }

    const phase = slotAvailabilityPhaseRef.current;
    if (phase !== "free") {
      if (phase === "busy") {
        setFormError(t("appointments.slotBusyError"));
      } else if (phase === "error") {
        setFormError(t("appointments.checkAvailabilityError"));
      } else {
        setFormError(t("appointments.waitingForAvailability"));
      }
      return;
    }

    const payload = {
      patientId: selectedPatient.id,
      doctorId,
      serviceId: sid,
      price: Math.max(0, Math.round(price)),
      startAt,
      status: "scheduled" as const,
      diagnosis: null,
      treatment: null,
      notes: null,
    };

    setSubmitting(true);
    try {
      await requestJson("/api/appointments", { method: "POST", token, body: payload });
      onClose();
      resetForm();
      await onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("appointments.createAppointmentError"));
    } finally {
      setSubmitting(false);
    }
  };

  const noDoctors = !loadingDoctors && doctorOptions.length === 0;
  const allSlotFields =
    doctorId !== "" && resolvedServiceId != null && Boolean(date) && Boolean(time);
  const slotOk = !allSlotFields || slotAvailabilityPhase === "free";
  const canSubmit =
    Boolean(selectedPatient && doctorId !== "" && date && time && resolvedServiceId) &&
    slotOk &&
    !submitting &&
    !loadingServices;

  const qSel = quickModalSelectClass.replace("mt-2", "mt-1.5");
  const qInp = quickModalInputClass.replace("mt-2", "mt-1.5");

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      className="crm-quick-modal flex max-h-[min(88vh,600px)] w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.16)]"
    >
      <form
        autoComplete="off"
        onSubmit={(e) => void handleSubmit(e)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-[#e5e7eb] pb-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f9fafb] text-[#111827]">
              <CalendarPlus className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight text-[#111827]">{t("appointments.quickCreate")}</h2>
              <p className="mt-0.5 text-xs leading-snug text-[#6b7280]">
                {t("appointments.createSteps")}
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3">
          <div className="space-y-3">
            <div>
              <label htmlFor="quick-patient" className={quickModalLabelClass}>
                {t("common.patient")}
              </label>
              {selectedPatient ? (
                <div className="mt-1.5">
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-1 text-sm font-medium text-[#166534]">
                    <span className="truncate" title={selectedPatient.fullName}>
                      [{selectedPatient.fullName}]
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#166534] transition hover:bg-[#dcfce7]"
                      onClick={() => {
                        setSelectedPatient(null);
                        setPatientQuery("");
                        window.setTimeout(() => patientInputRef.current?.focus(), 0);
                      }}
                      aria-label={t("appointments.removePatient")}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : miniPatientOpen && canCreateNewPatient ? (
                <div className="mt-1.5 space-y-2.5 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] p-3">
                  <p className="text-sm font-medium text-[#111827]">{t("appointments.newPatient")}</p>
                  <label className="block text-sm text-[#374151]">
                    {t("appointments.name")}
                    <input
                      ref={miniNameInputRef}
                      id="quick-mini-name"
                      type="text"
                      autoComplete="name"
                      value={miniName}
                      onChange={(e) => setMiniName(e.target.value)}
                      disabled={submitting || miniSaving}
                      className={`${quickModalComboboxInputClass} mt-1 block w-full bg-white`}
                    />
                  </label>
                  <label className="block text-sm text-[#374151]">
                    {t("appointments.phone")}
                    <PhoneInput
                      id="quick-mini-phone"
                      value={miniPhone}
                      onChange={setMiniPhone}
                      disabled={submitting || miniSaving}
                      className={`${quickModalComboboxInputClass} mt-1 block w-full bg-white`}
                    />
                  </label>
                  {miniError ? (
                    <p className="text-sm text-rose-700" role="alert">
                      {miniError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="h-10 rounded-xl border border-[#e5e7eb] bg-white px-4 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:opacity-50"
                      onClick={closeMiniPatient}
                      disabled={submitting || miniSaving}
                    >
                      {t("appointments.backToSearch")}
                    </button>
                    <button
                      type="button"
                      className="h-10 rounded-xl bg-[#22c55e] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#16a34a] disabled:opacity-50"
                      onClick={() => void submitMiniPatient()}
                      disabled={submitting || miniSaving}
                    >
                      {miniSaving ? `${t("common.save")}…` : t("appointments.createPatient")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <PatientAutocompleteInput
                    id="quick-patient"
                    inputRef={patientInputRef}
                    query={patientQuery}
                    selectedPatient={selectedPatient}
                    token={token}
                    disabled={submitting}
                    onQueryChange={setPatientQuery}
                    onSelectPatient={setSelectedPatient}
                    onCreateRequested={canCreateNewPatient ? (q) => openMiniPatient(q) : undefined}
                    placeholder={t("appointments.patientSearchPlaceholder")}
                    inputClassName={quickModalComboboxInputClass}
                    wrapperClassName="relative mt-1.5"
                  />
                  {canCreateNewPatient ? (
                    <button
                      type="button"
                      className="mt-1.5 h-9 w-full rounded-xl border border-dashed border-emerald-400/70 bg-emerald-50/50 px-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:opacity-50"
                      onClick={() => openMiniPatient()}
                      disabled={submitting}
                    >
                      {t("appointments.createPatient")}
                    </button>
                  ) : null}
                </>
              )}
            </div>

            <div>
              <label htmlFor="quick-doctor" className={quickModalLabelClass}>
                {t("appointments.doctor")}
              </label>
              <select
                id="quick-doctor"
                className={qSel}
                value={doctorId === "" ? "" : String(doctorId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDoctorId(v === "" ? "" : Number(v));
                }}
                disabled={submitting || loadingDoctors || noDoctors}
              >
                <option value="">{noDoctors ? t("appointments.noDoctors") : loadingDoctors ? t("appointments.loadingDoctors") : t("appointments.selectDoctorOption")}</option>
                {doctorOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {doctorsLoadError ? (
                <p className="mt-1.5 text-xs text-rose-700" role="alert">
                  {doctorsLoadError}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor={
                  typeof doctorId === "number" && !loadingServices && services.length > 1
                    ? "quick-service"
                    : undefined
                }
                className={quickModalLabelClass}
              >
                {t("common.service")}
              </label>
              {typeof doctorId === "number" ? (
                <>
                  {loadingServices ? (
                    <p className="mt-1.5 text-xs text-[#6b7280]">{t("appointments.loadingServices")}</p>
                  ) : null}
                  {!loadingServices && services.length === 0 ? (
                    <p className="mt-1.5 text-xs text-amber-700">{t("appointments.noServices")}</p>
                  ) : null}
                  {!loadingServices && services.length === 1 ? (
                    <p className="mt-1.5 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5 text-sm text-[#111827]">
                      {services[0].name} — {formatSum(services[0].price)}
                    </p>
                  ) : null}
                  {!loadingServices && services.length > 1 ? (
                    <select
                      id="quick-service"
                      className={qSel}
                      value={serviceId === "" ? "" : String(serviceId)}
                      onChange={(e) => setServiceId(e.target.value === "" ? "" : Number(e.target.value))}
                      disabled={submitting}
                    >
                      <option value="">{t("appointments.selectServiceOption")}</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {formatSum(s.price)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </>
              ) : (
                <p className="mt-1.5 text-xs text-[#6b7280]">{t("appointments.selectDoctorFirst")}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label htmlFor="quick-price" className={quickModalLabelClass}>
                  {t("appointments.price")}
                </label>
                <MoneyInput
                  id="quick-price"
                  mode="integer"
                  className={qInp}
                  value={price}
                  onChange={setPrice}
                  disabled={submitting || loadingServices || services.length === 0}
                />
              </div>
              <div>
                <label htmlFor="quick-date" className={quickModalLabelClass}>
                  {t("appointments.date")}
                </label>
                <input
                  id="quick-date"
                  type="date"
                  className={qInp}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="quick-time" className={quickModalLabelClass}>
                  {t("appointments.time")}
                </label>
                <input
                  id="quick-time"
                  type="time"
                  step={60}
                  className={qInp}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
            {allSlotFields && (slotAvailabilityPhase === "pending" || slotAvailabilityPhase === "loading") ? (
              <p className="text-xs text-[#6b7280]">{t("appointments.checkingSlot")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "free" ? (
              <p className="text-xs font-medium text-emerald-700">{t("appointments.slotFree")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "busy" ? (
              <p className="text-xs font-medium text-rose-700">{t("appointments.slotBusyLabel")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "error" ? (
              <p className="text-xs font-medium text-amber-800">{t("appointments.checkSlotError")}</p>
            ) : null}
          </div>

          {formError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {formError}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[#e5e7eb] pt-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2.5">
            <button
              type="button"
              className="h-10 rounded-xl border border-[#e5e7eb] bg-white px-4 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="h-10 rounded-xl bg-[#22c55e] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit}
            >
              {submitting ? t("appointments.creating") : t("appointments.create")}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
};
