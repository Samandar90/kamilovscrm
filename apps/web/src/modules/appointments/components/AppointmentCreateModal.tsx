import React from "react";
import { CalendarPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Patient, Service } from "../api/appointmentsFlowApi";
import { coercePriceToNumber } from "../../../shared/lib/money";
import { MoneyInput } from "../../../shared/ui/MoneyInput";
import { formatSum } from "../../../utils/formatMoney";
import { Modal } from "../../../components/ui/Modal";
import { PatientAutocompleteInput } from "./PatientAutocompleteInput";
import {
  modalHintClass,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
  modalSelectDisabledClass,
} from "../utils/modalFieldClasses";
import type { SlotAvailabilityPhase } from "../hooks/useDebouncedAppointmentSlotAvailability";

export type FullFormFields = {
  patientQuery: string;
  selectedPatient: Patient | null;
  doctorId: string;
  serviceId: string;
  price: number;
  /** false — цена подставляется из выбранной услуги; true — вручную */
  priceLocked: boolean;
  date: string;
  time: string;
  notes: string;
};

type Props = {
  open: boolean;
  form: FullFormFields;
  onChange: React.Dispatch<React.SetStateAction<FullFormFields>>;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  token: string | null;
  patientsMap: Record<number, string>;
  doctorsMap: Record<number, string>;
  availableServices: Service[];
  servicesLoading: boolean;
  onDoctorChange: (doctorId: string) => void;
  patientInputRef: React.Ref<HTMLInputElement>;
  slotAvailabilityPhase: SlotAvailabilityPhase;
  suggestedTimes?: string[];
  onPickSuggestedTime?: (time: string) => void;
  /** Server / validation message shown inside the modal */
  inlineError?: string | null;
  onCreatePatientRequest: (query: string) => void;
  /** Если false — скрываем создание новой карточки пациента из автодополнения (согласовано с RBAC). */
  canCreateNewPatient?: boolean;
  /** Запись только на себя (врач): имя для отображения вместо выпадающего списка врачей. */
  lockedDoctorDisplayName?: string | null;
};

export const AppointmentCreateModal: React.FC<Props> = ({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  submitting,
  token,
  patientsMap,
  doctorsMap,
  availableServices,
  servicesLoading,
  onDoctorChange,
  patientInputRef,
  slotAvailabilityPhase,
  suggestedTimes = [],
  onPickSuggestedTime,
  inlineError,
  onCreatePatientRequest,
  canCreateNewPatient = true,
  lockedDoctorDisplayName = null,
}) => {
  const { t } = useTranslation();
  const updateForm = React.useCallback(
    (patch: Partial<FullFormFields>) => {
      onChange((prev) => ({ ...prev, ...patch }));
    },
    [onChange]
  );

  const patientSelected = Boolean(form.selectedPatient);
  const allSlotFields = Boolean(form.doctorId && form.serviceId && form.date && form.time);
  const slotOk = !allSlotFields || slotAvailabilityPhase === "free";
  const canSubmit =
    Boolean(patientSelected && form.doctorId && form.serviceId && form.date && form.time) &&
    slotOk &&
    !submitting;

  const serviceLocked = !form.doctorId || servicesLoading;

  const sel = modalSelectClass.replace("mt-2", "mt-1.5");
  const selDis = modalSelectDisabledClass.replace("mt-2", "mt-1.5");
  const inp = modalInputClass.replace("mt-2", "mt-1.5");

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      className="appointment-modal-dialog flex max-h-[min(90vh,640px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_20px_50px_-24px_rgba(15,23,42,0.16)]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-appointment-title"
        aria-describedby="full-appointment-desc"
      >
        <header className="relative shrink-0 border-b border-[#e5e7eb] bg-white px-5 py-3.5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f9fafb] text-[#111827]">
              <CalendarPlus className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="full-appointment-title" className="text-base font-semibold tracking-tight text-[#111827]">
                {t("appointments.addAppointment")}
              </h2>
              <p id="full-appointment-desc" className="mt-0.5 text-xs leading-snug text-[#6b7280]">
                {t("appointments.createSteps")}
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-3">
            <div>
              <label htmlFor="create-patient" className={modalLabelClass}>
                {t("common.patient")}
              </label>
              {form.selectedPatient ? (
                <div className="mt-1.5">
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-1 text-sm font-medium text-[#166534]">
                    <span className="truncate" title={form.selectedPatient.fullName}>
                      [{form.selectedPatient.fullName}]
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#166534] transition hover:bg-[#dcfce7]"
                      onClick={() => updateForm({ selectedPatient: null, patientQuery: "" })}
                      aria-label={t("appointments.removePatient")}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <PatientAutocompleteInput
                  id="create-patient"
                  inputRef={patientInputRef}
                  query={form.patientQuery}
                  selectedPatient={form.selectedPatient}
                  token={token}
                  disabled={submitting}
                  onQueryChange={(patientQuery) => updateForm({ patientQuery })}
                  onSelectPatient={(selectedPatient) => updateForm({ selectedPatient: selectedPatient ?? null })}
                  onCreateRequested={canCreateNewPatient ? onCreatePatientRequest : undefined}
                  placeholder={t("appointments.patientSearchPlaceholder")}
                  wrapperClassName="relative mt-1.5"
                />
              )}
            </div>

            <div>
              <label htmlFor="create-doctor" className={modalLabelClass}>
                {t("appointments.doctor")}
              </label>
              {lockedDoctorDisplayName ? (
                <div
                  id="create-doctor"
                  className={`${sel} cursor-not-allowed bg-[#f9fafb] text-[#374151]`}
                  aria-readonly
                >
                  {lockedDoctorDisplayName}
                </div>
              ) : (
                <select
                  id="create-doctor"
                  className={sel}
                  value={form.doctorId}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateForm({ doctorId: v, serviceId: "" });
                    onDoctorChange(v);
                  }}
                >
                  <option value="">{t("appointments.selectDoctor")}</option>
                  {Object.entries(doctorsMap).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="create-service" className={modalLabelClass}>
                {t("common.service")}
              </label>
              <select
                id="create-service"
                className={serviceLocked ? selDis : sel}
                value={form.serviceId}
                onChange={(e) => updateForm({ serviceId: e.target.value, price: 0, priceLocked: false })}
                disabled={serviceLocked}
              >
                <option value="">
                  {servicesLoading
                    ? t("common.loading")
                    : form.doctorId
                      ? t("appointments.selectService")
                      : t("appointments.selectDoctorFirst")}
                </option>
                {form.doctorId && !servicesLoading
                  ? availableServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} · {formatSum(coercePriceToNumber(service.price))}
                      </option>
                    ))
                  : null}
              </select>
              {!form.doctorId ? (
                <p className={modalHintClass}>{t("appointments.selectDoctorFirst")}</p>
              ) : servicesLoading ? (
                <p className={modalHintClass}>{t("appointments.loadingServices")}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="create-price" className={modalLabelClass}>
                {t("billing.price")}
              </label>
              <MoneyInput
                id="create-price"
                mode="integer"
                className={inp}
                value={form.price}
                onChange={(next) => updateForm({ price: next, priceLocked: true })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="create-date" className={modalLabelClass}>
                  {t("appointments.date")}
                </label>
                <input
                  id="create-date"
                  type="date"
                  className={inp}
                  value={form.date}
                  onChange={(e) => updateForm({ date: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="create-time" className={modalLabelClass}>
                  {t("appointments.time")}
                </label>
                <input
                  id="create-time"
                  type="time"
                  step={1800}
                  className={inp}
                  value={form.time}
                  onChange={(e) => updateForm({ time: e.target.value })}
                />
              </div>
            </div>
            {allSlotFields && (slotAvailabilityPhase === "pending" || slotAvailabilityPhase === "loading") ? (
              <p className="text-xs text-[#6b7280]">{t("appointments.checkingTime")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "free" ? (
              <p className="text-xs font-medium text-emerald-700">{t("appointments.slotFree")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "busy" ? (
              <p className="text-xs font-medium text-rose-700">{t("appointments.slotBusy")}</p>
            ) : null}
            {allSlotFields && slotAvailabilityPhase === "error" ? (
              <p className="text-xs font-medium text-amber-800">{t("appointments.checkTimeError")}</p>
            ) : null}
            {suggestedTimes.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
                  {t("appointments.suggestedTimes")}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestedTimes.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => onPickSuggestedTime?.(time)}
                      className="rounded-md border border-[#d1d5db] bg-white px-2 py-0.5 text-[11px] font-medium text-[#111827] transition hover:bg-[#f3f4f6]"
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label htmlFor="create-notes" className={modalLabelClass}>
                {t("appointments.notes")}
              </label>
              <textarea
                id="create-notes"
                className={`${inp} min-h-[4.25rem] py-2`}
                placeholder={t("appointments.notesPlaceholder")}
                value={form.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
              />
            </div>
          </div>

          {inlineError ? (
            <div
              className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              role="alert"
            >
              {inlineError}
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-[#e5e7eb] bg-white px-5 py-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <button
              type="button"
              className="h-10 rounded-xl border border-[#e5e7eb] bg-white px-4 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="h-10 rounded-xl bg-[#22c55e] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onSubmit}
              disabled={!canSubmit}
            >
              {submitting ? `${t("appointments.creating")}…` : t("appointments.addAppointment")}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
};
