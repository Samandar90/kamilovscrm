import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  CalendarPlus,
  Pencil,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { requestJson } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import {
  canCreatePatients,
  canReadBilling,
  canUpdatePatients,
  canViewPatientVisitClinical,
} from "../../../auth/roleGroups";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { Modal } from "../../../components/ui/Modal";
import type { Appointment } from "../../appointments/api/appointmentsFlowApi";
import type { InvoiceSummary } from "../../billing/api/cashDeskApi";
import { formatSum } from "../../../utils/formatMoney";
import { PhoneInput } from "../../../shared/ui/PhoneInput";
import { phoneToApiValue, storedPhoneToNormalized } from "../../../utils/phoneInput";
import { PatientCard } from "../components/PatientCard";
import { cn } from "../../../ui/utils/cn";

type PatientSource = "instagram" | "telegram" | "advertising" | "referral" | "other";

type Patient = {
  id: number;
  fullName: string;
  phone: string;
  birthDate: string;
  gender: "male" | "female" | "other" | "unknown";
  source: PatientSource | null;
  notes: string | null;
  createdAt: string;
};

type PatientFormState = {
  fullName: string;
  phone: string;
  birthDate: string;
  gender: "male" | "female";
  source: PatientSource | "";
  notes: string;
};

type PatientVisit = {
  id: number;
  doctorId: number;
  serviceId: number;
  startAt: string;
  status: string;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
};

type DoctorRef = { id: number; name: string };
type ServiceRef = { id: number; name: string };

const PATIENT_SOURCE_OPTIONS: { value: PatientSource; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "advertising", label: "Реклама" },
  { value: "referral", label: "По рекомендации" },
  { value: "other", label: "Другое" },
];

const initialFormState: PatientFormState = {
  fullName: "",
  phone: "",
  birthDate: "",
  gender: "male",
  source: "",
  notes: "",
};

const isPatientSource = (v: string | null | undefined): v is PatientSource =>
  v === "instagram" || v === "telegram" || v === "advertising" || v === "referral" || v === "other";

const phoneAllowedCharsRe = /^[+()\-\s\d]+$/;

function getPatientFormValidationError(state: PatientFormState): string | null {
  const fullName = state.fullName.trim();
  const apiPhone = phoneToApiValue(state.phone);
  const birthDate = state.birthDate.trim();
  const notesTrim = state.notes.trim();

  if (!fullName) return "Укажите ФИО пациента.";
  if (fullName.length < 2) return "ФИО слишком короткое.";
  if (!apiPhone) return "Укажите номер телефона.";
  if (!phoneAllowedCharsRe.test(apiPhone)) return "Телефон содержит недопустимые символы.";
  if (apiPhone.includes("+") && !apiPhone.startsWith("+")) return "Символ «+» допустим только в начале номера.";
  const digits = apiPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "В номере должно быть от 10 до 15 цифр.";

  if (birthDate) {
    const date = new Date(birthDate);
    if (Number.isNaN(date.getTime())) return "Проверьте дату рождения.";
    if (date > new Date()) return "Дата рождения не может быть в будущем.";
  }

  if (notesTrim.length > 2000) return "Комментарий не длиннее 2000 символов.";

  return null;
}

const DEBOUNCE_MS = 300;
const LIST_WINDOW_INITIAL = 40;
const LIST_WINDOW_STEP = 40;

function buildLastVisitMap(appointments: Appointment[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const a of appointments) {
    const cur = map.get(a.patientId);
    if (!cur || a.startAt > cur) {
      map.set(a.patientId, a.startAt);
    }
  }
  return map;
}

function buildDebtByPatient(invoices: InvoiceSummary[]): Map<number, number> {
  const map = new Map<number, number>();
  const debtStatuses = new Set<InvoiceSummary["status"]>([
    "draft",
    "issued",
    "partially_paid",
  ]);
  for (const inv of invoices) {
    if (!debtStatuses.has(inv.status)) continue;
    const debt = Math.max(0, inv.total - inv.paidAmount);
    if (debt <= 0) continue;
    map.set(inv.patientId, (map.get(inv.patientId) ?? 0) + debt);
  }
  return map;
}

export const PatientsPage: React.FC = () => {
  const { user, token } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [lastVisitByPatientId, setLastVisitByPatientId] = useState<Map<number, string>>(
    () => new Map()
  );
  const [debtByPatientId, setDebtByPatientId] = useState<Map<number, number>>(() => new Map());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [formError, setFormError] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [archivingPatientId, setArchivingPatientId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [formState, setFormState] = useState<PatientFormState>(initialFormState);
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null);
  const [visitHistory, setVisitHistory] = useState<PatientVisit[]>([]);
  const [selectedVisitId, setSelectedVisitId] = useState<number | null>(null);
  const [doctorsMap, setDoctorsMap] = useState<Record<number, string>>({});
  const [servicesMap, setServicesMap] = useState<Record<number, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [relatedDataWarning, setRelatedDataWarning] = useState<string | null>(null);
  const [listWindow, setListWindow] = useState(LIST_WINDOW_INITIAL);

  const role = user?.role;
  const canCreatePatient = canCreatePatients(role);
  const canUpdatePatient = canUpdatePatients(role);
  const canArchive = !!role && hasPermission(role, "patients", "delete");
  const showPatientDebt = !!role && canReadBilling(role);
  const canBookAppointment = !!role && hasPermission(role, "appointments", "create");
  const showVisitClinical = canViewPatientVisitClinical(user?.role);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError("");
    setRelatedDataWarning(null);
    try {
      const patientRows = await requestJson<Patient[]>("/api/patients");

      const parts: string[] = [];
      let apptResult: Appointment[] = [];
      try {
        apptResult = await requestJson<Appointment[]>("/api/appointments");
      } catch {
        parts.push("записи визитов");
      }

      let invResult: InvoiceSummary[] = [];
      if (token && showPatientDebt) {
        try {
          invResult = await requestJson<InvoiceSummary[]>("/api/invoices", { token });
        } catch {
          parts.push("счета для расчёта долгов");
        }
      }

      if (parts.length > 0) {
        setRelatedDataWarning(
          `Не удалось загрузить через API: ${parts.join(" и ")}. Список пациентов — из API; блоки «последний визит» и «долг» могут быть неполными.`
        );
      }

      setPatients(patientRows);
      setLastVisitByPatientId(buildLastVisitMap(apptResult));
      setDebtByPatientId(buildDebtByPatient(invResult));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token, showPatientDebt]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const normalizedPatients = useMemo<Patient[]>(() => {
    if (!Array.isArray(patients)) return [];
    return patients.map((p) => {
      const raw = p as Partial<Patient> & { source?: string | null; notes?: string | null };
      const src = raw.source;
      return {
        id: Number(raw.id ?? 0),
        fullName: (raw.fullName || "").trim(),
        phone: (raw.phone ?? "").trim(),
        birthDate: raw.birthDate ?? "",
        gender: (raw.gender as Patient["gender"]) || "unknown",
        source: isPatientSource(src) ? src : null,
        notes: raw.notes != null && raw.notes !== "" ? String(raw.notes) : null,
        createdAt: raw.createdAt || "",
      };
    });
  }, [patients]);

  const filteredPatients = useMemo(() => {
    const value = (debouncedSearch || "").toLowerCase();
    if (!value) return normalizedPatients;
    return normalizedPatients.filter((patient) => {
      const fullName = (patient?.fullName || "").toLowerCase();
      const phone = (patient?.phone || "").toLowerCase();
      return fullName.includes(value) || phone.includes(value);
    });
  }, [normalizedPatients, debouncedSearch]);

  const windowedPatients = useMemo(
    () => filteredPatients.slice(0, listWindow),
    [filteredPatients, listWindow]
  );
  const hasMorePatients = filteredPatients.length > windowedPatients.length;

  useEffect(() => {
    setListWindow(LIST_WINDOW_INITIAL);
  }, [debouncedSearch, normalizedPatients.length]);

  const patientFormMeta = useMemo(() => {
    const validationError = getPatientFormValidationError(formState);
    const apiPhone = phoneToApiValue(formState.phone);
    const digits = apiPhone.replace(/\D/g, "");
    const duplicatePhone =
      digits.length >= 10 &&
      normalizedPatients.some(
        (p) =>
          (editingPatientId === null || p.id !== editingPatientId) &&
          (p.phone || "").replace(/\D/g, "") === digits
      );
    const permissionOk = editingPatientId === null ? canCreatePatient : canUpdatePatient;
    return {
      validationError,
      duplicatePhone,
      canSubmit: !validationError && !duplicatePhone && permissionOk,
    };
  }, [formState, editingPatientId, normalizedPatients, canCreatePatient, canUpdatePatient]);

  const openCreateModal = () => {
    setEditingPatientId(null);
    setFormState(initialFormState);
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (patient: Patient) => {
    setEditingPatientId(patient.id);
    setFormState({
      fullName: patient.fullName,
      phone: storedPhoneToNormalized(patient.phone),
      birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : "",
      gender: patient.gender === "female" ? "female" : "male",
      source: patient.source ?? "",
      notes: patient.notes ?? "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setFormState(initialFormState);
    setEditingPatientId(null);
    setFormError("");
  };

  const handleSavePatient = async () => {
    const validationError = getPatientFormValidationError(formState);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    const isEdit = Boolean(editingPatientId);
    if (isEdit && !canUpdatePatient) {
      setFormError("Недостаточно прав для изменения карточки.");
      return;
    }
    if (!isEdit && !canCreatePatient) {
      setFormError("Недостаточно прав для создания пациента.");
      return;
    }

    if (patientFormMeta.duplicatePhone) return;

    setFormError("");
    setIsSaving(true);
    setError("");
    try {
      const birth = formState.birthDate.trim();
      const payload = {
        fullName: formState.fullName.trim(),
        phone: phoneToApiValue(formState.phone),
        birthDate: birth || null,
        gender: formState.gender,
        source: formState.source === "" ? null : formState.source,
        notes: formState.notes.trim() || null,
      };

      const path = isEdit ? `/api/patients/${editingPatientId}` : "/api/patients";
      const method = isEdit ? "PUT" : "POST";
      await requestJson<Patient>(path, { method, body: payload });

      await loadPatients();
      closeModal();
      setToast(isEdit ? "Пациент успешно обновлён." : "Пациент успешно добавлен");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка сохранения";
      setFormError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchivePatient = async (patient: Patient, e: React.MouseEvent) => {
    e.stopPropagation();
    if (archivingPatientId !== null) return;
    const confirmed = window.confirm(
      `Архивировать пациента «${patient.fullName}»?\n\nПациент будет скрыт из списка, но сохранится в истории (записи и связи не затрагиваются).`
    );
    if (!confirmed) return;

    setError("");
    setArchivingPatientId(patient.id);
    try {
      await requestJson<{ success: true }>(`/api/patients/${patient.id}`, {
        method: "DELETE",
      });

      await loadPatients();
      setToast("Пациент архивирован.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка архивации");
    } finally {
      setArchivingPatientId(null);
    }
  };

  const openPatientHistory = async (patient: Patient) => {
    setHistoryPatient(patient);
    setHistoryLoading(true);
    setFormError("");
    try {
      const [visits, doctors, services] = await Promise.all([
        requestJson<PatientVisit[]>(
          `/api/appointments?patientId=${encodeURIComponent(String(patient.id))}`
        ),
        requestJson<DoctorRef[]>("/api/doctors"),
        requestJson<ServiceRef[]>("/api/services"),
      ]);
      setVisitHistory(visits);
      setSelectedVisitId(visits[0]?.id ?? null);
      setDoctorsMap(Object.fromEntries(doctors.map((d) => [d.id, d.name])));
      setServicesMap(Object.fromEntries(services.map((s) => [s.id, s.name])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки истории");
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistoryModal = useCallback(() => {
    setHistoryPatient(null);
    setSelectedVisitId(null);
  }, []);

  useEffect(() => {
    if (!historyPatient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHistoryModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyPatient, closeHistoryModal]);

  const fieldInputClass =
    "h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] shadow-sm outline-none transition placeholder:text-[#94a3b8] hover:border-[#cbd5e1] focus:border-[#16a34a] focus:bg-white focus:ring-2 focus:ring-[#16a34a]/20";
  const selectFieldClass =
    "crm-native-select h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] shadow-sm outline-none transition hover:border-[#cbd5e1] focus:border-[#16a34a] focus:bg-white focus:ring-2 focus:ring-[#16a34a]/20";
  const textareaFieldClass =
    "min-h-[104px] w-full resize-y rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-sm text-[#0f172a] shadow-sm outline-none transition placeholder:text-[#94a3b8] hover:border-[#cbd5e1] focus:border-[#16a34a] focus:bg-white focus:ring-2 focus:ring-[#16a34a]/20";

  const showEmptyNoData = !loading && normalizedPatients.length === 0;
  const showEmptyFilter =
    !loading && normalizedPatients.length > 0 && filteredPatients.length === 0;

  return (
    <div
      className={cn(
        "page-enter space-y-4 p-4 md:space-y-6 md:p-6",
        canCreatePatient && !loading && !showEmptyNoData && "max-md:pb-[100px]"
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-3 md:gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">Пациенты</h2>
          <p className="mt-0.5 hidden text-sm text-slate-500 sm:block">
            {role === "operator"
              ? "Поиск и создание новых пациентов."
              : "Карточки пациентов для ежедневной работы администратора."}
          </p>
        </div>
        {canCreatePatient && (
          <button
            type="button"
            onClick={openCreateModal}
            className="hidden h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-emerald-700 active:scale-[0.98] md:inline-flex"
          >
            Добавить пациента
          </button>
        )}
      </header>

      {!showEmptyNoData && (
        <div className="sticky top-0 z-20 -mx-4 border-b border-slate-200/60 bg-slate-50/95 px-4 py-2.5 backdrop-blur-md md:static md:z-0 md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="relative w-full md:max-w-xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`${fieldInputClass} h-11 w-full pl-10 pr-3`}
              aria-label="Поиск по имени и телефону"
              placeholder="Поиск пациента..."
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          {error}
        </div>
      )}
      {relatedDataWarning && !error ? (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          {relatedDataWarning}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#64748b] shadow-sm">
          Загрузка пациентов…
        </div>
      ) : showEmptyNoData ? (
        <ListEmptyState
          icon={UserRound}
          title="Пациентов пока нет"
          actionLabel="Добавить пациента"
          onAction={openCreateModal}
          showAction={canCreatePatient}
          actionDisabled={isSaving || archivingPatientId !== null}
        />
      ) : showEmptyFilter ? (
        <div className="rounded-xl border border-slate-100 bg-white px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
          <p className="font-medium text-slate-900">Никого не нашли</p>
          <p className="mt-1 text-slate-500">Измените запрос.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="flex flex-col gap-3 md:hidden" aria-label="Список пациентов">
            {windowedPatients.map((patient) => {
              const birthLabel = patient.birthDate?.trim() ? formatDate(patient.birthDate) : null;
              return (
                <li key={patient.id}>
                  <PatientCard
                    patient={patient}
                    birthLabel={birthLabel}
                    onOpen={() => void openPatientHistory(patient)}
                    onEdit={canUpdatePatient ? () => openEditModal(patient) : undefined}
                    onArchive={canArchive ? (e) => void handleArchivePatient(patient, e) : undefined}
                    canBookAppointment={canBookAppointment}
                    canEdit={canUpdatePatient}
                    canArchive={canArchive}
                    archivePending={archivingPatientId !== null}
                    savePending={isSaving}
                  />
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-100 bg-white shadow-sm md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-4 py-3">ФИО</th>
                  <th className="whitespace-nowrap px-4 py-3">Телефон</th>
                  <th className="whitespace-nowrap px-4 py-3">Дата рождения</th>
                  <th className="whitespace-nowrap px-4 py-3">Последний визит</th>
                  {showPatientDebt ? <th className="whitespace-nowrap px-4 py-3">Долг</th> : null}
                  <th className="whitespace-nowrap px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {windowedPatients.map((patient) => {
                  const lastVisit = lastVisitByPatientId.get(patient.id);
                  const debt = debtByPatientId.get(patient.id);
                  return (
                    <tr
                      key={patient.id}
                      className="cursor-pointer border-b border-slate-100/90 transition-colors last:border-0 hover:bg-slate-50/80"
                      onClick={() => void openPatientHistory(patient)}
                    >
                      <td className="max-w-[200px] truncate px-4 py-3 font-medium text-slate-900">{patient.fullName}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{patient.phone}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(patient.birthDate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {lastVisit ? formatDateTime(lastVisit) : "—"}
                      </td>
                      {showPatientDebt ? (
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                          {debt !== undefined && debt > 0 ? (
                            <span className="font-medium text-red-700">{formatSum(debt)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                            onClick={() => void openPatientHistory(patient)}
                          >
                            Открыть
                          </button>
                          {canBookAppointment ? (
                            <Link
                              to={`/appointments/new?patientId=${patient.id}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                              Запись
                            </Link>
                          ) : null}
                          {canUpdatePatient ? (
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                              title="Изменить"
                              disabled={isSaving || archivingPatientId !== null}
                              onClick={() => openEditModal(patient)}
                            >
                              <Pencil className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          ) : null}
                          {canArchive ? (
                            <button
                              type="button"
                              className="rounded-lg border border-red-100 bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                              title="Архивировать"
                              disabled={archivingPatientId !== null}
                              onClick={(e) => void handleArchivePatient(patient, e)}
                            >
                              <Archive className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMorePatients ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setListWindow((n) => n + LIST_WINDOW_STEP)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Показать ещё ({filteredPatients.length - windowedPatients.length})
              </button>
            </div>
          ) : null}
        </div>
      )}

      {canCreatePatient && !loading && !showEmptyNoData ? (
        <button
          type="button"
          onClick={openCreateModal}
          className="fixed bottom-16 left-0 right-0 z-[90] flex justify-center px-4 transition-transform duration-150 ease-out active:scale-[0.98] md:hidden"
          aria-label="Добавить пациента"
        >
          <span className="flex min-h-[48px] w-full max-w-none items-center justify-center gap-2 rounded-[14px] bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md">
            + Пациент
          </span>
        </button>
      ) : null}

      {modalOpen &&
        ((editingPatientId === null && canCreatePatient) ||
          (editingPatientId !== null && canUpdatePatient)) && (
        <Modal
          isOpen={modalOpen}
          onClose={closeModal}
          className="w-full max-w-2xl max-h-[min(92vh,880px)] overflow-y-auto rounded-[20px] border border-[#e2e8f0] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
          <h3 className="text-lg font-semibold tracking-tight text-[#0f172a]">
            {editingPatientId ? "Редактировать пациента" : "Добавить пациента"}
          </h3>
          <p className="mt-1 text-sm text-[#64748b]">Заполните карточку. Поля с * обязательны.</p>
          {formError ? (
            <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-sm text-[#991b1b]">
              {formError}
            </div>
          ) : null}

          <div className="mt-6 space-y-8">
            <section>
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">
                Основная информация
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ФИО" required>
                  <input
                    value={formState.fullName}
                    onChange={(e) => setFormState((prev) => ({ ...prev, fullName: e.target.value }))}
                    className={fieldInputClass}
                    placeholder="Иванов Иван Иванович"
                    autoComplete="name"
                  />
                </Field>
                <div>
                  <Field label="Телефон" required>
                    <PhoneInput
                      value={formState.phone}
                      onChange={(normalized) =>
                        setFormState((prev) => ({
                          ...prev,
                          phone: normalized,
                        }))
                      }
                      className={fieldInputClass}
                    />
                  </Field>
                  {patientFormMeta.duplicatePhone ? (
                    <p className="mt-2 text-xs font-medium text-[#b45309]" role="alert">
                      Пациент уже существует
                    </p>
                  ) : null}
                </div>
                <Field label="Пол">
                  <select
                    value={formState.gender}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        gender: e.target.value as PatientFormState["gender"],
                      }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="male">Мужской</option>
                    <option value="female">Женский</option>
                  </select>
                </Field>
                <Field label="Дата рождения">
                  <input
                    type="date"
                    value={formState.birthDate}
                    onChange={(e) => setFormState((prev) => ({ ...prev, birthDate: e.target.value }))}
                    className={fieldInputClass}
                    placeholder=""
                  />
                </Field>
              </div>
            </section>

            <section className="border-t border-[#f1f5f9] pt-8">
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">
                Дополнительно
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Источник обращения">
                  <select
                    value={formState.source}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        source: e.target.value as PatientFormState["source"],
                      }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Не выбрано</option>
                    {PATIENT_SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Комментарий">
                    <textarea
                      value={formState.notes}
                      onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                      className={textareaFieldClass}
                      placeholder="Комментарий или особенности пациента"
                      rows={4}
                    />
                  </Field>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-[#f1f5f9] pt-5">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] hover:border-[#cbd5e1]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSavePatient}
              disabled={isSaving || !patientFormMeta.canSubmit}
              className="rounded-xl bg-[#16a34a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#22c55e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={Boolean(historyPatient)}
        onClose={closeHistoryModal}
        className="w-[min(500px,calc(100vw-2rem))] animate-[modal-pop-in_0.2s_cubic-bezier(0.22,1,0.36,1)] rounded-[20px] border border-[#e2e8f0] bg-white p-6"
      >
        {historyPatient && (
          <div
              role="dialog"
              aria-modal="true"
              aria-label={`История пациента ${historyPatient.fullName}`}
              style={{
                boxShadow:
                  "0 42px 95px -30px rgba(15,23,42,0.45), 0 18px 40px -22px rgba(15,23,42,0.35)",
              }}
            >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-[#0f172a]">
                История пациента: {historyPatient.fullName}
              </h3>
              <button
                type="button"
                aria-label="Закрыть историю пациента"
                onClick={closeHistoryModal}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e2e8f0] bg-white text-[#64748b] transition hover:bg-[#f8fafc] hover:text-[#0f172a]"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-[#64748b]">Загрузка истории...</p>
            ) : visitHistory.length === 0 ? (
              <p className="text-sm text-[#64748b]">Визиты не найдены.</p>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
                {[...visitHistory]
                  .sort((a, b) => b.startAt.localeCompare(a.startAt))
                  .map((visit) => (
                    <button
                      key={visit.id}
                      type="button"
                      className={`relative w-full rounded-[14px] border px-3 py-3 text-left text-xs transition ${
                        selectedVisitId === visit.id
                          ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#0f172a] shadow-sm"
                          : "border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]"
                      }`}
                      onClick={() => setSelectedVisitId(visit.id)}
                    >
                      <span
                        className={`absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ${
                          selectedVisitId === visit.id ? "bg-[#16a34a]" : "bg-[#cbd5e1]"
                        }`}
                        aria-hidden
                      />
                      <div className="pl-4 font-medium">{formatDateTime(visit.startAt)}</div>
                      <div className="mt-1 pl-4 text-[#64748b]">
                        {doctorsMap[visit.doctorId] ?? `#${visit.doctorId}`}
                      </div>
                      <div className="mt-2 pl-4">
                        <span className="inline-flex items-center rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#166534]">
                          completed
                        </span>
                      </div>
                    </button>
                  ))}
                <div className="rounded-[14px] border border-[#e2e8f0] bg-white p-4 text-sm">
                  {(() => {
                    const activeVisit =
                      visitHistory.find((visit) => visit.id === selectedVisitId) ??
                      [...visitHistory].sort((a, b) => b.startAt.localeCompare(a.startAt))[0];
                    if (!activeVisit) return <div className="text-[#64748b]">Нет данных</div>;
                    return (
                      <div className="space-y-3">
                        <div className="text-[#0f172a]">
                          <span className="text-[#64748b]">Дата: </span>
                          {formatDateTime(activeVisit.startAt)}
                        </div>
                        <div className="text-[#0f172a]">
                          <span className="text-[#64748b]">Врач: </span>
                          {doctorsMap[activeVisit.doctorId] ?? `#${activeVisit.doctorId}`}
                        </div>
                        <div className="text-[#0f172a]">
                          <span className="text-[#64748b]">Услуга: </span>
                          {servicesMap[activeVisit.serviceId] ?? `#${activeVisit.serviceId}`}
                        </div>
                        {showVisitClinical ? (
                          <>
                            <div className="rounded-[14px] bg-[#f8fafc] p-4">
                              <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                                Diagnosis
                              </div>
                              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-[#0f172a]">
                                {activeVisit.diagnosis ?? "Не указан"}
                              </p>
                            </div>
                            <div className="rounded-[14px] bg-[#f8fafc] p-4">
                              <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                                Treatment
                              </div>
                              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-[#0f172a]">
                                {activeVisit.treatment ?? "Не указано"}
                              </p>
                            </div>
                            {activeVisit.notes && (
                              <div className="rounded-[14px] bg-[#f8fafc] p-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                                  Notes
                                </div>
                                <p className="mt-2 whitespace-pre-wrap leading-relaxed text-[#374151]">
                                  {activeVisit.notes}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-[#64748b]">
                            Клинические данные визита недоступны для вашей роли.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {toast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[120] max-w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-5 py-3 text-center text-sm font-medium text-[#166534] shadow-[0_10px_40px_-12px_rgba(22,163,74,0.35)]"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
};

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({
  label,
  required,
  children,
}) => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span className="text-xs font-medium text-[#64748b]">
      {label}
      {required ? <span className="text-[#dc2626]"> *</span> : null}
    </span>
    {children}
  </label>
);

const formatDate = (value: string): string => {
  if (!value?.trim()) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU");
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
};
