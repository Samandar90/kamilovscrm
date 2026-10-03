import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Plus, Search, Zap } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import {
  canCreateAppointmentWithPatientPicker,
  canCreatePatients,
  canIssueQueue,
  canReadBilling,
  canReadPatients,
  canReadQueue,
  canSetAppointmentCommercialPrice,
  canUpdateAppointments,
} from "../../../auth/roleGroups";
import { Modal } from "../../../components/ui/Modal";
import {
  appointmentsFlowApi,
  type Appointment,
  type InvoiceSummary,
  type Patient,
  type Service,
} from "../api/appointmentsFlowApi";
import { AppointmentActionPanel } from "../components/AppointmentActionPanel";
import { AppointmentCard } from "../components/AppointmentCard";
import { AppointmentMobileCard } from "../components/AppointmentMobileCard";
import { AppointmentCreateModal, type FullFormFields } from "../components/AppointmentCreateModal";
import { AppointmentServicesModal } from "../components/AppointmentServicesModal";
import { AppointmentQuickCreateModal } from "../features/quick-create/AppointmentQuickCreateModal";
import { useDebouncedAppointmentSlotAvailability } from "../hooks/useDebouncedAppointmentSlotAvailability";
import { CreatePatientModal } from "../components/CreatePatientModal";
import {
  dateToYmd,
  normalizeDateTimeForApi,
  todayYmd,
  uiDateToYmd,
} from "../utils/appointmentFormUtils";
import {
  appointmentsLoadRange,
  loadAppointmentsPageData,
  loadSuggestedTimes,
  type DayRange,
} from "../utils/appointmentsPageData";
import { summarizeAppointments } from "../utils/appointmentSummary";
import {
  canChangeAppointmentServices,
  toServiceLineInputs,
  totalDurationMinutes,
} from "../utils/serviceLines";
import {
  AppContainer,
  EmptyState,
  MoneyInput,
  PageHeader,
  PageLoader,
  SectionCard,
  StatusBadge,
} from "../../../shared/ui";
import { primaryActionButtonClass } from "../../../shared/ui/buttonStyles";
import { Button } from "../../../ui/Button";
import { coercePriceToNumber } from "../../../shared/lib/money";
import { getAllServices } from "../../../shared/lib/appointments/getAllServices";
import { formatSum } from "../../../utils/formatMoney";
import { queueApi } from "../../queue/api/queueApi";
import { QueueCodeBadge } from "../../queue/components/QueueCodeBadge";
import { printQueueTicket } from "../../queue/print/printTicket";
import { issueQueueNumber, withIssuedQueueNumber } from "../utils/queueIssue";

const secondaryActionButtonClass =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2 " +
  "text-sm font-medium tracking-tight text-gray-700 shadow-sm transition-all duration-150 ease-out " +
  "hover:scale-[1.02] hover:bg-gray-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const MOBILE_WINDOW_INITIAL = 40;
const MOBILE_WINDOW_STEP = 40;
/** «Выдан номер К-05» stays long enough to press «Печать талона» (the plain toast hides after 2.5 s). */
const ISSUED_TICKET_VISIBLE_MS = 30_000;

type IssuedTicketState = { appointmentId: number; code: string };

type AppointmentDetailsModalState = {
  open: boolean;
  appointment: Appointment | null;
};
type CancelModalState = {
  open: boolean;
  appointment: Appointment | null;
  reason: string;
};
type PriceModalState = {
  open: boolean;
  appointment: Appointment | null;
  price: number;
};
type ConflictHintState = {
  message: string | null;
  suggestedTimes: string[];
};

function parseAppointmentStartMs(iso: string): number {
  const normalized = iso.includes(" ") ? iso.replace(" ", "T") : iso;
  return new Date(normalized).getTime();
}

function formatTimeOnly(iso: string): string {
  const normalized = iso.includes(" ") ? iso.replace(" ", "T") : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatRangeDateLabel(tab: RangeTab, customDateYmd: string, t: any): string {
  const now = new Date();
  const toRu = (d: Date) =>
    d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  if (tab === "today") return `${t("appointments.range.today")}, ${toRu(now)}`;
  if (tab === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return `${t("appointments.range.tomorrow")}, ${toRu(d)}`;
  }
  if (customDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(customDateYmd)) {
    const [y, m, d] = customDateYmd.split("-").map(Number);
    return toRu(new Date(y, m - 1, d));
  }
  return toRu(now);
}

type RangeTab = "today" | "tomorrow" | "week" | "custom";

function getFilterRange(
  tab: RangeTab,
  customDateYmd: string
): { start: Date; end: Date } {
  const startOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const now = new Date();

  if (tab === "today") {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (tab === "tomorrow") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return { start: startOfDay(t), end: endOfDay(t) };
  }
  if (tab === "week") {
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return { start: startOfDay(now), end };
  }
  if (customDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(customDateYmd)) {
    const [y, m, d] = customDateYmd.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    return { start: startOfDay(day), end: endOfDay(day) };
  }
  return { start: startOfDay(now), end: endOfDay(now) };
}

const daysKey = (range: DayRange): string => `${range.from}/${range.to}`;

function emptyRangeMessage(tab: RangeTab, t: any): string {
  switch (tab) {
    case "today":
      return t("appointments.emptyState.today");
    case "tomorrow":
      return t("appointments.emptyState.tomorrow");
    case "week":
      return t("appointments.emptyState.week");
    default:
      return t("appointments.emptyState.custom");
  }
}

const RESCHEDULABLE_APPOINTMENT_STATUSES = new Set<Appointment["status"]>([
  "scheduled",
  "confirmed",
  "arrived",
  "in_consultation",
]);

function parseStartAtToDateAndTimeInputs(startAt: string): { date: string; time: string } {
  const s = startAt.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (m?.[1] && m[2] != null && m[3] != null) {
    return { date: m[1], time: `${m[2]}:${m[3]}` };
  }
  return { date: todayYmd(), time: "" };
}

function formatAppointmentDateOnlyRu(startAt: string): string {
  const s = startAt.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m?.[1] || !m[2] || !m[3]) return "—";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatAppointmentCreatedAtRu(value: string | undefined): string {
  if (!value) return "—";
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appointmentStatusDetailedRu(status: Appointment["status"], t: any): string {
  const map: Record<Appointment["status"], string> = {
    scheduled: t("appointments.statusLabels.scheduled") ?? "Запланирован",
    confirmed: t("appointments.statusLabels.confirmed") ?? "Подтверждён",
    arrived: t("appointments.statusLabels.arrived") ?? "Пришёл",
    in_consultation: t("appointments.statusLabels.in_consultation") ?? "На приёме",
    completed: t("appointments.statusLabels.completed") ?? "Завершён",
    cancelled: t("appointments.statusLabels.cancelled") ?? "Отменён",
    no_show: t("appointments.statusLabels.no_show") ?? "Неявка",
  };
  return map[status] ?? status;
}

function patientSourceLabelRu(source: Patient["source"], t: any): string {
  switch (source) {
    case "doctor":
      return t("patients.source.doctor") ?? "Врач";
    case "reception":
      return t("patients.source.reception") ?? "Регистратура";
    case "instagram":
      return t("patients.source.instagram") ?? "Instagram";
    case "telegram":
      return t("patients.source.telegram") ?? "Telegram";
    case "advertising":
      return t("patients.source.advertising") ?? "Реклама";
    case "referral":
      return t("patients.source.referral") ?? "Рекомендация";
    case "other":
      return t("patients.source.other") ?? "Другое";
    default:
      return "—";
  }
}

function formatBirthDateRu(ymd: string | null | undefined): string | null {
  if (!ymd?.trim()) return null;
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function appointmentStatusToneForBadge(
  status: Appointment["status"]
): "success" | "danger" | "info" | "warning" | "neutral" {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "arrived") return "info";
  if (status === "in_consultation") return "warning";
  return "neutral";
}

const emptyFullForm = (): FullFormFields => ({
  patientQuery: "",
  selectedPatient: null,
  doctorId: "",
  serviceLines: [],
  date: todayYmd(),
  time: "",
  notes: "",
});

export const AppointmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const ur = user?.role;
  const isDoctorUser = ur === "doctor";
  const canReadPatientsList = canReadPatients(ur);
  const showQuickScheduleUi = canCreateAppointmentWithPatientPicker(ur) && !isDoctorUser;
  const canOpenAppointmentCreateModals = canCreateAppointmentWithPatientPicker(ur);
  const canEditAppointmentPrice = canSetAppointmentCommercialPrice(ur);
  const canUpdateApptStatus = canUpdateAppointments(ur);
  const readBilling = canReadBilling(ur);
  const canHardDeleteAppointment = ur === "superadmin";
  const canCreateInvoice = !!ur && hasPermission(ur, "invoices", "create");
  const canPrintQueueTicket = canReadQueue(ur);
  const canIssueQueueNumber = canIssueQueue(ur);

  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [invoicesByAppointmentId, setInvoicesByAppointmentId] = React.useState<
    Record<number, InvoiceSummary | null>
  >({});
  const [patientsList, setPatientsList] = React.useState<Patient[]>([]);
  const patientsMap = React.useMemo(
    () => Object.fromEntries(patientsList.map((p) => [p.id, p.fullName])),
    [patientsList]
  );
  const patientPhoneMap = React.useMemo(
    () => Object.fromEntries(patientsList.map((p) => [p.id, p.phone ?? null])),
    [patientsList]
  );
  const patientsById = React.useMemo(
    () => Object.fromEntries(patientsList.map((p) => [p.id, p])) as Record<number, Patient>,
    [patientsList]
  );
  const [doctorsMap, setDoctorsMap] = React.useState<Record<number, string>>({});
  const [servicesMap, setServicesMap] = React.useState<Record<number, Service>>({});
  const [availableServices, setAvailableServices] = React.useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [issuedTicket, setIssuedTicket] = React.useState<IssuedTicketState | null>(null);
  const [printingTicketId, setPrintingTicketId] = React.useState<number | null>(null);
  const [issuingQueueId, setIssuingQueueId] = React.useState<number | null>(null);
  const [rangeTab, setRangeTab] = React.useState<RangeTab>("today");
  const [customDate, setCustomDate] = React.useState(() => todayYmd());
  const [searchQuery, setSearchQuery] = React.useState("");
  const [mobileWindow, setMobileWindow] = React.useState(MOBILE_WINDOW_INITIAL);

  const [quickModalOpen, setQuickModalOpen] = React.useState(false);
  const [quickResumePatient, setQuickResumePatient] = React.useState<Patient | null>(null);
  const [fullModalOpen, setFullModalOpen] = React.useState(false);
  const [fullForm, setFullForm] = React.useState<FullFormFields>(emptyFullForm);
  const [createPatientModalOpen, setCreatePatientModalOpen] = React.useState(false);
  const [createPatientInitialName, setCreatePatientInitialName] = React.useState("");

  const fullPatientRef = React.useRef<HTMLInputElement>(null);

  const [detailsModal, setDetailsModal] = React.useState<AppointmentDetailsModalState>({
    open: false,
    appointment: null,
  });
  const [cancelModal, setCancelModal] = React.useState<CancelModalState>({
    open: false,
    appointment: null,
    reason: "",
  });
  const [priceModal, setPriceModal] = React.useState<PriceModalState>({
    open: false,
    appointment: null,
    price: 0,
  });
  const [rescheduleModal, setRescheduleModal] = React.useState<{
    open: boolean;
    appointment: Appointment | null;
    date: string;
    time: string;
    error: string;
  }>({ open: false, appointment: null, date: "", time: "", error: "" });
  const [fullConflictHint, setFullConflictHint] = React.useState<ConflictHintState>({
    message: null,
    suggestedTimes: [],
  });
  const [servicesModalAppointment, setServicesModalAppointment] = React.useState<Appointment | null>(null);

  const fullSlotAvailabilityPhase = useDebouncedAppointmentSlotAvailability(
    token,
    {
      doctorId: fullForm.doctorId,
      serviceIds: fullForm.serviceLines.map((line) => line.serviceId),
      date: fullForm.date,
      time: fullForm.time,
    },
    fullModalOpen && !createPatientModalOpen && Boolean(token)
  );
  const fullSlotAvailabilityPhaseRef = React.useRef(fullSlotAvailabilityPhase);
  fullSlotAvailabilityPhaseRef.current = fullSlotAvailabilityPhase;

  const { start: rangeStart, end: rangeEnd } = React.useMemo(
    () => getFilterRange(rangeTab, customDate),
    [rangeTab, customDate]
  );
  /** Days asked from the API: the visible period, widened so that Today, Tomorrow and Week share one request. */
  const loadRange = React.useMemo(
    () => appointmentsLoadRange({ from: dateToYmd(rangeStart), to: dateToYmd(rangeEnd) }, todayYmd()),
    [rangeStart, rangeEnd]
  );
  const loadRangeRef = React.useRef(loadRange);
  loadRangeRef.current = loadRange;
  const wantedDays = daysKey(loadRange);
  /** Days the rows in `appointments` were loaded for (always set together with them); null before the first load. */
  const [loadedDays, setLoadedDays] = React.useState<string | null>(null);
  /** Days whose request failed last. They are asked for again on "retry" and on any period button or date. */
  const [failedDays, setFailedDays] = React.useState<string | null>(null);
  const rangeFailed = loadedDays !== null && loadedDays !== wantedDays && failedDays === wantedDays;
  const rangePending = loadedDays !== null && loadedDays !== wantedDays && !rangeFailed;
  const showRange = (tab: RangeTab) => {
    setRangeTab(tab);
    setFailedDays(null);
  };

  const loadData = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!token) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const range = loadRangeRef.current;
      const { appointments: appointmentRows, patients, doctors, services, invoicesByAppointmentId: invoices } =
        await loadAppointmentsPageData(
          appointmentsFlowApi,
          token,
          { readBilling, readPatients: canReadPatientsList },
          range
        );
      setAppointments(appointmentRows);
      setLoadedDays(daysKey(range));
      setFailedDays(null);
      setInvoicesByAppointmentId(invoices);
      setPatientsList(patients);
      setDoctorsMap(Object.fromEntries(doctors.map((item) => [item.id, item.name])));
      setServicesMap(Object.fromEntries(services.map((item) => [item.id, item])));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.loadingError"));
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [token, readBilling, canReadPatientsList]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  // The visible period left the loaded days (a calendar date outside this week, or the way back): only the
  // appointments are asked for again, the other lists do not depend on the period.
  React.useEffect(() => {
    if (!token || loadedDays === null || loadedDays === wantedDays || failedDays === wantedDays) return;
    let active = true;
    setError(null);
    appointmentsFlowApi
      .listAppointments(token, loadRangeRef.current)
      .then((rows) => {
        if (!active) return;
        setAppointments(rows);
        setLoadedDays(wantedDays);
        setFailedDays(null);
      })
      .catch((requestError) => {
        if (!active) return;
        // Not stored as loaded: an empty list would read as "no appointments on these days".
        setFailedDays(wantedDays);
        setError(requestError instanceof Error ? requestError.message : t("appointments.errors.loadingError"));
      });
    return () => {
      active = false;
    };
  }, [token, loadedDays, wantedDays, failedDays]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!issuedTicket) return;
    const timer = window.setTimeout(() => setIssuedTicket(null), ISSUED_TICKET_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [issuedTicket]);

  React.useEffect(() => {
    if (!fullModalOpen) return;
    const id = window.setTimeout(() => fullPatientRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [fullModalOpen]);

  const loadServicesByDoctor = React.useCallback(
    async (doctorId?: number) => {
      if (!token) return;
      if (!doctorId) {
        setAvailableServices([]);
        return;
      }
      setServicesLoading(true);
      setAvailableServices([]);
      try {
        const rows = await appointmentsFlowApi.listServices(token, doctorId);
        setAvailableServices(rows);
      } catch (_error) {
        setAvailableServices([]);
        setError(t("appointments.errors.serviceNotFound"));
      } finally {
        setServicesLoading(false);
      }
    },
    [token]
  );

  React.useEffect(() => {
    if (!fullModalOpen || !fullForm.doctorId || servicesLoading) return;
    const offered = new Set(availableServices.map((service) => service.id));
    setFullForm((prev) => {
      const kept = prev.serviceLines.filter((line) => offered.has(line.serviceId));
      return kept.length === prev.serviceLines.length ? prev : { ...prev, serviceLines: kept };
    });
  }, [fullModalOpen, fullForm.doctorId, availableServices, servicesLoading]);

  React.useEffect(() => {
    const patientIdParam = searchParams.get("patientId");
    if (!patientIdParam || !canOpenAppointmentCreateModals) return;
    const patientId = Number(patientIdParam);
    if (!Number.isInteger(patientId) || patientId <= 0 || isLoading) return;

    const exists = patientsList.some((patient) => patient.id === patientId);
    if (!exists) {
      const next = new URLSearchParams(searchParams);
      next.delete("patientId");
      setSearchParams(next, { replace: true });
      return;
    }

    const found = patientsList.find((p) => p.id === patientId) ?? null;
    setQuickModalOpen(false);
    setFullForm({
      ...emptyFullForm(),
      selectedPatient: found,
      patientQuery: found?.fullName ?? "",
    });
    setFullModalOpen(true);
    void loadServicesByDoctor(undefined);

    const next = new URLSearchParams(searchParams);
    next.delete("patientId");
    setSearchParams(next, { replace: true });
  }, [
    canOpenAppointmentCreateModals,
    isLoading,
    loadServicesByDoctor,
    patientsList,
    searchParams,
    setSearchParams,
  ]);

  const openQuickModal = () => {
    setFullModalOpen(false);
    setQuickModalOpen(true);
  };

  const openFullModal = () => {
    setQuickModalOpen(false);
    const nextForm = emptyFullForm();
    if (isDoctorUser && user?.doctorId != null) {
      nextForm.doctorId = String(user.doctorId);
      void loadServicesByDoctor(user.doctorId);
    } else {
      void loadServicesByDoctor(undefined);
    }
    setFullForm(nextForm);
    setFullConflictHint({ message: null, suggestedTimes: [] });
    setFullModalOpen(true);
  };

  React.useEffect(() => {
    const doctorId = Number(fullForm.doctorId);
    if (
      fullSlotAvailabilityPhase !== "busy" ||
      !doctorId ||
      fullForm.serviceLines.length === 0 ||
      !fullForm.date ||
      !fullForm.time
    ) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }

    const duration = totalDurationMinutes(fullForm.serviceLines, servicesMap);
    if (!duration) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }
    const dateYmd = uiDateToYmd(fullForm.date);
    if (!dateYmd) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }
    const selectedStart = new Date(`${dateYmd}T${fullForm.time}:00`);
    if (!token || Number.isNaN(selectedStart.getTime())) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }

    // The page holds only the visible days and the form may be on any day, so that day's visits are asked for.
    let active = true;
    loadSuggestedTimes(appointmentsFlowApi, token, { doctorId, dateYmd, durationMinutes: duration })
      .then((suggestedTimes) => {
        if (active) setFullConflictHint({ message: null, suggestedTimes });
      })
      .catch(() => {
        if (active) setFullConflictHint({ message: null, suggestedTimes: [] });
      });
    return () => {
      active = false;
    };
    // Only the outcome of the availability check starts this: "busy" belongs to the form values of that moment.
    // With the form fields listed too, every edit after a busy slot would send a request for a slot not checked yet.
  }, [token, fullSlotAvailabilityPhase]);

  const submitFullAppointment = async (form: FullFormFields) => {
    if (!token || !canOpenAppointmentCreateModals) return;
    const doctorId = isDoctorUser ? Number(user?.doctorId ?? 0) : Number(form.doctorId);
    const patientId = Number(form.selectedPatient?.id);
    const [primary] = form.serviceLines;
    if (
      !form.selectedPatient ||
      !Number.isInteger(patientId) ||
      patientId <= 0 ||
      !doctorId ||
      !primary ||
      !form.date ||
      !form.time
    ) {
      setError(t("appointments.errors.fillAllFields"));
      return;
    }
    const startAt = normalizeDateTimeForApi(form.date, form.time);
    if (!startAt) {
      setError(t("appointments.errors.invalidDateTime"));
      return;
    }
    const offered = new Set(availableServices.map((service) => service.id));
    if (form.serviceLines.some((line) => !offered.has(line.serviceId))) {
      setError(t("appointments.errors.selectServiceFromList"));
      return;
    }
    if (form.serviceLines.some((line) => !Number.isFinite(line.price) || line.price < 0)) {
      setError(t("appointments.errors.priceError"));
      return;
    }
    const slotPhase = fullSlotAvailabilityPhaseRef.current;
    if (slotPhase !== "free") {
      if (slotPhase === "busy") {
        setError(t("appointments.errors.slotBusy"));
      } else if (slotPhase === "error") {
        setError(t("appointments.errors.checkingSlotError"));
      } else {
        setError(t("appointments.errors.waitingForCheck"));
      }
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const basePayload = {
        patientId,
        serviceId: primary.serviceId,
        ...(canEditAppointmentPrice ? { price: Math.round(primary.price) } : {}),
        serviceLines: toServiceLineInputs(form.serviceLines, canEditAppointmentPrice),
        startAt,
        status: "scheduled" as const,
        diagnosis: null,
        treatment: null,
        notes: form.notes.trim() || null,
      };
      const created = await appointmentsFlowApi.createAppointment(
        token,
        isDoctorUser ? basePayload : { ...basePayload, doctorId }
      );
      setAppointments((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setInvoicesByAppointmentId((prev) => ({ ...prev, [created.id]: null }));
      setFullModalOpen(false);
      setFullForm(emptyFullForm());
      setToast(t("appointments.messages.appointmentCreated"));
      void loadData({ silent: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.creationError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (appointment: Appointment) => {
    if (!token || !canUpdateApptStatus) return;
    const statusTransitionMap: Partial<Record<Appointment["status"], Appointment["status"]>> = {
      scheduled: "arrived",
      confirmed: "arrived",
      arrived: "in_consultation",
      in_consultation: "completed",
    };
    const nextStatus = statusTransitionMap[appointment.status];
    if (!nextStatus) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const updated = await appointmentsFlowApi.updateAppointmentStatus(
        token,
        appointment.id,
        nextStatus
      );
      setAppointments((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setDetailsModal((d) =>
        d.appointment?.id === updated.id ? { open: d.open, appointment: updated } : d
      );
      if (nextStatus === "arrived" && updated.queueCode) {
        // The server issued today's queue number in the same request (records for another day get none).
        setIssuedTicket({ appointmentId: updated.id, code: updated.queueCode });
      } else {
        setToast(t("appointments.messages.statusUpdated"));
      }
      void loadData({ silent: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.updateError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openOrCreateInvoice = async (appointment: Appointment) => {
    if (!token || !canCreateInvoice) return;
    const existing = invoicesByAppointmentId[appointment.id];
    if (existing?.id) {
      navigate(`/billing/invoices/${existing.id}`);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await appointmentsFlowApi.createInvoiceFromAppointment(token, appointment.id);
      await loadData();
      navigate(`/billing/invoices/${created.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.invoiceCreationError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openConsultation = (appointment: Appointment) => {
    navigate(`/doctor-workspace/${appointment.id}`);
  };

  const printTicket = async (appointmentId: number) => {
    if (!canPrintQueueTicket) return;
    setPrintingTicketId(appointmentId);
    setError(null);
    try {
      const ticket = await queueApi.ticket(appointmentId);
      printQueueTicket(ticket);
    } catch {
      setError(t("appointments.queue.printFailed"));
    } finally {
      setPrintingTicketId(null);
    }
  };

  const handleIssueQueueNumber = async (appointment: Appointment) => {
    if (!canIssueQueueNumber) return;
    setIssuingQueueId(appointment.id);
    setError(null);
    const result = await issueQueueNumber(appointment.id, t("appointments.queue.issueFailed"));
    setIssuingQueueId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const { code, entry } = result;
    const patch = (row: Appointment) => (row.id === appointment.id ? withIssuedQueueNumber(row, entry) : row);
    setAppointments((prev) => prev.map(patch));
    setDetailsModal((d) => (d.appointment ? { open: d.open, appointment: patch(d.appointment) } : d));
    setIssuedTicket({ appointmentId: appointment.id, code });
    void loadData({ silent: true });
  };

  const handleServicesSaved = (updated: Appointment) => {
    setServicesModalAppointment(null);
    setAppointments((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setDetailsModal({ open: true, appointment: updated });
    setToast(t("serviceLines.saved"));
    void loadData({ silent: true });
  };

  const cancelAppointment = async () => {
    if (!token || !cancelModal.appointment || !canUpdateApptStatus) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const updated = await appointmentsFlowApi.cancelAppointment(
        token,
        cancelModal.appointment.id,
        cancelModal.reason
      );
      setCancelModal({ open: false, appointment: null, reason: "" });
      setAppointments((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setDetailsModal((d) =>
        d.appointment?.id === updated.id ? { open: d.open, appointment: updated } : d
      );
      setToast(t("appointments.messages.appointmentCancelled"));
      void loadData({ silent: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.cancellationError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitRescheduleTime = async () => {
    if (!token || !rescheduleModal.appointment) return;
    const startAt = normalizeDateTimeForApi(rescheduleModal.date, rescheduleModal.time);
    if (!startAt) {
      setRescheduleModal((s) => ({ ...s, error: t("appointments.messages.invalidRecheduleDate") }));
      return;
    }
    setIsSubmitting(true);
    setRescheduleModal((s) => ({ ...s, error: "" }));
    setError(null);
    try {
      const updated = await appointmentsFlowApi.updateAppointment(
        token,
        rescheduleModal.appointment.id,
        { startAt }
      );
      setAppointments((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setDetailsModal((d) =>
        d.appointment?.id === updated.id ? { open: true, appointment: updated } : d
      );
      setRescheduleModal({ open: false, appointment: null, date: "", time: "", error: "" });
      setToast(t("appointments.messages.appointmentRescheduled"));
      void loadData({ silent: true });
    } catch (requestError) {
      const msg =
        requestError instanceof Error ? requestError.message : t("appointments.errors.rescheduleError");
      setRescheduleModal((s) => ({ ...s, error: msg }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteAppointment = async (appointment: Appointment) => {
    if (!token || !canHardDeleteAppointment) return;
    const confirmed = window.confirm(t("appointments.errors.confirmDelete"));
    if (!confirmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.deleteAppointment(token, appointment.id);
      await loadData();
      setToast(t("appointments.messages.appointmentDeleted"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("appointments.errors.deletionError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateAppointmentPrice = async () => {
    if (!token || !priceModal.appointment || !canEditAppointmentPrice) return;
    const price = priceModal.price;
    if (!Number.isFinite(price) || price < 0) {
      setError(t("appointments.errors.priceError"));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.updateAppointmentPrice(
        token,
        priceModal.appointment.id,
        Math.round(price)
      );
      setPriceModal({ open: false, appointment: null, price: 0 });
      await loadData();
      setToast(t("appointments.messages.priceUpdated"));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : t("appointments.errors.priceUpdateError")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAppointments = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...appointments]
      .filter((a) => {
        const t = parseAppointmentStartMs(a.startAt);
        return t >= rangeStart.getTime() && t <= rangeEnd.getTime();
      })
      .filter((a) => {
        if (!q) return true;
        const name = patientsMap[a.patientId]?.toLowerCase() ?? "";
        if (name.includes(q)) return true;
        const idQuery = q.trim();
        if (/^\d+$/.test(idQuery) && a.patientId === Number(idQuery)) return true;
        return false;
      })
      .sort((a, b) => parseAppointmentStartMs(a.startAt) - parseAppointmentStartMs(b.startAt));
  }, [appointments, rangeStart, rangeEnd, searchQuery, patientsMap]);

  const filteredSummary = React.useMemo(
    () => summarizeAppointments(filteredAppointments),
    [filteredAppointments]
  );

  const shouldOfferCancel = React.useCallback(
    (a: Appointment) => {
      if (!canUpdateApptStatus) return false;
      if (a.status === "completed" || a.status === "cancelled") return false;
      if (isDoctorUser) {
        return (
          a.status === "scheduled" || a.status === "confirmed" || a.status === "arrived"
        );
      }
      return true;
    },
    [canUpdateApptStatus, isDoctorUser]
  );

  const copyPatientPhone = React.useCallback(async (phone: string) => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) return;
    try {
      await navigator.clipboard.writeText(trimmedPhone);
      setToast(t("appointments.messages.phoneCopied"));
    } catch {
      setToast(trimmedPhone);
    }
  }, [t]);

  const canManageAppointmentDetailsActions = React.useCallback(
    (a: Appointment) => {
      if (!canUpdateApptStatus) return false;
      if (ur === "doctor") {
        return user?.doctorId != null && a.doctorId === user.doctorId;
      }
      return true;
    },
    [canUpdateApptStatus, ur, user?.doctorId]
  );

  const mobileAppointments = React.useMemo(
    () => filteredAppointments.slice(0, mobileWindow),
    [filteredAppointments, mobileWindow]
  );
  const hasMoreMobileAppointments = filteredAppointments.length > mobileAppointments.length;
  const mobileDateLabel = React.useMemo(
    () => formatRangeDateLabel(rangeTab, customDate, t),
    [rangeTab, customDate, t]
  );

  React.useEffect(() => {
    setMobileWindow(MOBILE_WINDOW_INITIAL);
  }, [rangeTab, customDate, searchQuery, appointments.length]);

  const tabList: { id: RangeTab; label: string }[] = [
    { id: "today", label: t("appointments.today") },
    { id: "tomorrow", label: t("appointments.tomorrow") },
    { id: "week", label: t("appointments.week") },
  ];

  const glassPanel = "";

  const handleDoctorChangeForFull = (doctorId: string) => {
    void loadServicesByDoctor(doctorId ? Number(doctorId) : undefined);
  };

  const openCreatePatientFromAutocomplete = (query: string) => {
    if (!ur || !canCreatePatients(ur)) return;
    setCreatePatientInitialName(query.trim());
    setFullModalOpen(false);
    setCreatePatientModalOpen(true);
  };

  const handlePatientCreated = (patient: Patient) => {
    setPatientsList((prev) => [patient, ...prev]);
    setFullForm((prev: FullFormFields) => ({
      ...prev,
      selectedPatient: patient,
      patientQuery: patient.fullName,
    }));
    setFullModalOpen(true);
    setCreatePatientModalOpen(false);
  };

  const consumeQuickResumePatient = React.useCallback(() => {
    setQuickResumePatient(null);
  }, []);

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f8fafc] pb-[100px] text-[#334155] max-md:[&_button]:min-h-[44px] md:pb-0">
      <AppContainer className="page-enter">
        <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 space-y-6 lg:col-span-8">
        <PageHeader
          title={t("appointments.title")}
          subtitle={t("appointments.subtitle")}
          actions={
            canOpenAppointmentCreateModals ? (
              <div className="hidden items-center gap-2 md:flex">
                {showQuickScheduleUi ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={openQuickModal}
                    className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all duration-150"
                  >
                    <Zap className="h-4 w-4" />
                    {t("appointments.quickCreate")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={openFullModal}
                  disabled={isSubmitting}
                  className={primaryActionButtonClass}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  {isDoctorUser ? t("appointments.createAppointment") : t("appointments.newAppointment")}
                </Button>
              </div>
            ) : null
          }
        />

        <div className="sticky top-0 z-[70] -mx-4 border-b border-slate-200/70 bg-white px-4 pb-2 pt-2 shadow-[0_6px_16px_-10px_rgba(15,23,42,0.16)] md:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{mobileDateLabel}</p>
            <div className="flex items-center gap-1.5">
              {(["today", "tomorrow"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => showRange(tab)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    rangeTab === tab
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab === "today" ? t("appointments.today") : t("appointments.tomorrow")}
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder={t("appointments.search") || "Поиск пациента…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        <SectionCard className="hidden p-4 md:block">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("appointments.date")}</label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  showRange("custom");
                }}
                className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-sm text-[#111827] outline-none transition hover:border-[#d1d5db] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/25"
              />
            </div>
            <div className="relative flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("appointments.search")}</label>
              <Search className="pointer-events-none absolute left-3 top-[34px] h-4 w-4 text-[#9ca3af]" />
              <input
                type="search"
                placeholder={t("appointments.search") || "Поиск пациента…"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2 pl-10 pr-3 text-sm text-[#111827] placeholder:text-[#9ca3af] outline-none transition hover:border-[#d1d5db] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/25"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{t("appointments.period")}</label>
            {tabList.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => showRange(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                  rangeTab === tab.id
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => showRange("custom")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                rangeTab === "custom"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              {t("appointments.calendar")}
            </button>
          </div>
        </SectionCard>

        {toast && (
          <SectionCard className="border-[#bbf7d0] bg-[#f0fdf4] p-4 text-sm text-[#166534]">
            {toast}
          </SectionCard>
        )}
        {issuedTicket && (
          <SectionCard className="flex flex-wrap items-center gap-3 border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a8a]">
            <span className="font-semibold">{t("appointments.queue.issued", { code: issuedTicket.code })}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {canPrintQueueTicket ? (
                <button
                  type="button"
                  disabled={printingTicketId === issuedTicket.appointmentId}
                  onClick={() => void printTicket(issuedTicket.appointmentId)}
                  className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50"
                >
                  {t("appointments.queue.printTicket")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIssuedTicket(null)}
                className="rounded-lg border border-[#bfdbfe] bg-white px-3 py-1.5 text-xs font-medium text-[#1e3a8a] shadow-sm transition hover:bg-[#dbeafe]"
              >
                {t("appointments.queue.dismiss")}
              </button>
            </div>
          </SectionCard>
        )}
        {error && !fullModalOpen && !quickModalOpen && (
          <SectionCard className="border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#991b1b]">
            {error}
          </SectionCard>
        )}

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280]">{t("appointments.schedule")}</h2>

          {isLoading || rangePending ? (
            <PageLoader label={t("common.loading")} />
          ) : rangeFailed ? (
            <SectionCard>
              <EmptyState
                title={t("appointments.errors.loadingError")}
                subtitle=""
                action={
                  <button
                    type="button"
                    onClick={() => setFailedDays(null)}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    {t("errors.tryAgain")}
                  </button>
                }
              />
            </SectionCard>
          ) : filteredAppointments.length === 0 ? (
            <>
            <SectionCard className="md:hidden border-slate-100 bg-white py-8 shadow-sm">
              <EmptyState title={t("appointments.emptyToday")} subtitle="" />
              {canOpenAppointmentCreateModals ? (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={isDoctorUser ? openFullModal : openQuickModal}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    + {t("appointments.create")}
                  </button>
                </div>
              ) : null}
            </SectionCard>
            <SectionCard className="hidden md:block">
              <EmptyState title={emptyRangeMessage(rangeTab, t)} subtitle={t("appointments.addFirst")} />
            </SectionCard>
            </>
          ) : (
            <>
            <ul className="space-y-2.5 md:hidden">
              {mobileAppointments.map((appointment) => {
                const service = servicesMap[appointment.serviceId];
                return (
                  <AppointmentMobileCard
                    key={appointment.id}
                    appointment={appointment}
                    patientName={patientsMap[appointment.patientId] ?? `${t("appointments.patient")} #${appointment.patientId}`}
                    patientPhone={patientPhoneMap[appointment.patientId]}
                    service={service}
                    timeLabel={formatTimeOnly(appointment.startAt)}
                    isSubmitting={isSubmitting}
                    canManageAppointmentFlow={canUpdateApptStatus}
                    canCreateInvoice={canCreateInvoice}
                    hasInvoice={Boolean(invoicesByAppointmentId[appointment.id])}
                    onStart={() => void updateStatus(appointment)}
                    onComplete={() => void updateStatus(appointment)}
                    onOpenWorkspace={() => openConsultation(appointment)}
                    onCreateInvoice={() => void openOrCreateInvoice(appointment)}
                    onOpenDetails={() => setDetailsModal({ open: true, appointment })}
                    showCancelButton={shouldOfferCancel(appointment)}
                    onCancelAppointment={() =>
                      setCancelModal({ open: true, appointment, reason: "" })
                    }
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                    canIssueQueueNumber={canIssueQueueNumber}
                    isIssuingQueueNumber={issuingQueueId === appointment.id}
                    onIssueQueueNumber={() => void handleIssueQueueNumber(appointment)}
                    canPrintQueueTicket={canPrintQueueTicket}
                    isPrintingTicket={printingTicketId === appointment.id}
                    onPrintTicket={() => void printTicket(appointment.id)}
                  />
                );
              })}
            </ul>
            {hasMoreMobileAppointments ? (
              <div className="flex justify-center md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileWindow((n) => n + MOBILE_WINDOW_STEP)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                >
                  {t("appointments.showMore")} ({filteredAppointments.length - mobileAppointments.length})
                </button>
              </div>
            ) : null}
            <ul className="hidden space-y-3 md:block">
              {filteredAppointments.map((appointment) => {
                const invoice = invoicesByAppointmentId[appointment.id] ?? null;
                const service = servicesMap[appointment.serviceId];
                return (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    invoice={invoice}
                    patientName={patientsMap[appointment.patientId] ?? `${t("appointments.patient")} #${appointment.patientId}`}
                    patientPhone={patientPhoneMap[appointment.patientId]}
                    onCopyPatientPhone={(phone) => void copyPatientPhone(phone)}
                    doctorName={doctorsMap[appointment.doctorId] ?? `#${appointment.doctorId}`}
                    service={service}
                    timeLabel={formatTimeOnly(appointment.startAt)}
                    glassPanelClass={glassPanel}
                    isSubmitting={isSubmitting}
                    canManageAppointmentFlow={canUpdateApptStatus}
                    showFinancialDetails={readBilling}
                    canCreateInvoice={canCreateInvoice}
                    onMarkArrived={() => void updateStatus(appointment)}
                    onCompleteConsultation={() => void updateStatus(appointment)}
                    onCreateInvoice={() => void openOrCreateInvoice(appointment)}
                    onCancelAppointment={() =>
                      setCancelModal({ open: true, appointment, reason: "" })
                    }
                    onEditPrice={() =>
                      setPriceModal({
                        open: true,
                        appointment,
                        price: Math.round(
                          coercePriceToNumber(
                            appointment.price ?? servicesMap[appointment.serviceId]?.price ?? 0
                          )
                        ),
                      })
                    }
                    canEditAppointmentPrice={canEditAppointmentPrice}
                    canHardDeleteAppointment={canHardDeleteAppointment}
                    onDeleteAppointment={() => void deleteAppointment(appointment)}
                    showCancelButton={shouldOfferCancel(appointment)}
                    onOpenDoctorWorkspace={() => openConsultation(appointment)}
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
                    canIssueQueueNumber={canIssueQueueNumber}
                    isIssuingQueueNumber={issuingQueueId === appointment.id}
                    onIssueQueueNumber={() => void handleIssueQueueNumber(appointment)}
                    canPrintQueueTicket={canPrintQueueTicket}
                    isPrintingTicket={printingTicketId === appointment.id}
                    onPrintTicket={() => void printTicket(appointment.id)}
                  />
                );
              })}
            </ul>
            </>
          )}
        </section>
      </div>

      <div className="col-span-12 hidden lg:col-span-4 lg:block">
        <AppointmentActionPanel
          filterSummary={filteredSummary}
          isLoading={isLoading || rangePending || rangeFailed}
        />
      </div>
        </div>
      </AppContainer>
      {canOpenAppointmentCreateModals ? (
        <button
          type="button"
          onClick={isDoctorUser ? openFullModal : openQuickModal}
          className="fixed bottom-16 left-0 right-0 z-[90] flex justify-center px-4 transition-transform duration-150 ease-out active:scale-[0.98] md:hidden"
          aria-label={isDoctorUser ? t("appointments.createAppointment") : t("appointments.quickCreate")}
        >
          <span className="flex min-h-[48px] w-full items-center justify-center rounded-[14px] bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(5,150,105,0.45)]">
            {isDoctorUser ? `+ ${t("appointments.createAppointment")}` : `+ ${t("appointments.appointment")}`}
          </span>
        </button>
      ) : null}

      {showQuickScheduleUi && quickModalOpen && !createPatientModalOpen ? (
        <AppointmentQuickCreateModal
          open
          onClose={() => {
            setQuickModalOpen(false);
            setQuickResumePatient(null);
          }}
          onCreated={async () => {
            await loadData();
            setToast(t("appointments.messages.appointmentCreated"));
          }}
          token={token ?? null}
          resumePatient={quickResumePatient}
          onResumePatientConsumed={consumeQuickResumePatient}
          canCreateNewPatient={ur ? canCreatePatients(ur) : false}
        />
      ) : null}

      {canOpenAppointmentCreateModals && fullModalOpen && !createPatientModalOpen ? (
        <AppointmentCreateModal
          open
          form={fullForm}
          onChange={setFullForm}
          onClose={() => {
            setFullModalOpen(false);
            setFullForm(emptyFullForm());
            setFullConflictHint({ message: null, suggestedTimes: [] });
          }}
          onSubmit={() => void submitFullAppointment(fullForm)}
          submitting={isSubmitting}
          token={token ?? null}
          patientsMap={patientsMap}
          doctorsMap={doctorsMap}
          availableServices={availableServices}
          servicesLoading={servicesLoading}
          canEditPrices={canEditAppointmentPrice}
          onDoctorChange={handleDoctorChangeForFull}
          patientInputRef={fullPatientRef}
          slotAvailabilityPhase={fullSlotAvailabilityPhase}
          suggestedTimes={fullConflictHint.suggestedTimes}
          onPickSuggestedTime={(time) => setFullForm((prev) => ({ ...prev, time }))}
          inlineError={fullModalOpen ? error : null}
          onCreatePatientRequest={(query) => openCreatePatientFromAutocomplete(query)}
          canCreateNewPatient={ur ? canCreatePatients(ur) : false}
          lockedDoctorDisplayName={
            isDoctorUser && user?.doctorId != null
              ? doctorsMap[user.doctorId] ?? user.fullName ?? "Вы"
              : null
          }
        />
      ) : null}

      {createPatientModalOpen && ur && canCreatePatients(ur) ? (
        <CreatePatientModal
          open
          token={token ?? null}
          initialName={createPatientInitialName}
          submitting={isSubmitting}
          onClose={() => {
            setCreatePatientModalOpen(false);
            setFullModalOpen(true);
          }}
          onCreated={handlePatientCreated}
          onError={setError}
        />
      ) : null}

      {detailsModal.open && detailsModal.appointment && (
        <Modal
          isOpen={detailsModal.open}
          onClose={() => setDetailsModal({ open: false, appointment: null })}
          backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
          className="flex max-h-[min(88dvh,720px)] w-[min(520px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)] transition-transform duration-200 ease-out"
        >
          {(() => {
            const ap = detailsModal.appointment;
            if (!ap) return null;
            const fallbackService = servicesMap[ap.serviceId];
            const services = getAllServices(ap, {
              fallbackBase: fallbackService
                ? {
                    id: fallbackService.id,
                    name: fallbackService.name,
                    price: ap.price ?? fallbackService.price,
                  }
                : undefined,
            });
            const patient = patientsById[ap.patientId];
            const phoneRaw = patient?.phone?.trim() ?? "";
            const birthLabel = formatBirthDateRu(patient?.birthDate);
            const showActions = canManageAppointmentDetailsActions(ap);
            const showReschedule = showActions && RESCHEDULABLE_APPOINTMENT_STATUSES.has(ap.status);
            const showStart =
              showActions &&
              (ap.status === "scheduled" || ap.status === "confirmed" || ap.status === "arrived");
            const showCancelBtn = showActions && shouldOfferCancel(ap);
            const showTicketBtn = canPrintQueueTicket && ap.status === "arrived" && Boolean(ap.queueCode);
            const showIssueBtn = canIssueQueueNumber && ap.status === "arrived" && !ap.queueCode;
            const showEditServices = canChangeAppointmentServices(user, ap);
            const rowClass = "flex flex-col gap-0.5 border-b border-slate-100 py-3 last:border-b-0";
            const labelClass = "text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";
            const valueClass = "text-sm font-medium text-slate-900";
            return (
              <>
                <div className="shrink-0 border-b border-slate-100 px-6 pb-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-slate-900">{t("appointments.detailsTitle")}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">{t("appointments.visitCard")}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <QueueCodeBadge code={ap.queueCode} />
                      <StatusBadge tone={appointmentStatusToneForBadge(ap.status)} className="shrink-0">
                        {appointmentStatusDetailedRu(ap.status, t)}
                      </StatusBadge>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2">
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.patient")}</span>
                    <span className={valueClass}>
                      {patientsMap[ap.patientId] ?? `${t("appointments.patient")} #${ap.patientId}`}
                    </span>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.phone")}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={valueClass}>{phoneRaw || "—"}</span>
                      {phoneRaw ? (
                        <button
                          type="button"
                          onClick={() => void copyPatientPhone(phoneRaw)}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                        >
                          {t("appointments.copy")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {birthLabel ? (
                    <div className={rowClass}>
                      <span className={labelClass}>{t("appointments.birthDate")}</span>
                      <span className={valueClass}>{birthLabel}</span>
                    </div>
                  ) : null}
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.patientSource")}</span>
                    <span className={valueClass}>{patientSourceLabelRu(patient?.source, t)}</span>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.doctor")}</span>
                    <span className={valueClass}>
                      {doctorsMap[ap.doctorId] ?? `${t("appointments.doctor")} #${ap.doctorId}`}
                    </span>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.service")}</span>
                    <div className={valueClass}>
                      {services.length > 0 ? (
                        <ul className="mt-1 list-none space-y-1">
                          {services.map((service) => (
                            <li key={`${service.serviceId}-${service.isBase ? "b" : "a"}`}>
                              {service.name}
                              {readBilling ? ` — ${formatSum(coercePriceToNumber(service.price))}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        fallbackService?.name ?? `${t("appointments.service")} #${ap.serviceId}`
                      )}
                    </div>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.date")}</span>
                    <span className={valueClass}>{formatAppointmentDateOnlyRu(ap.startAt)}</span>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.time")}</span>
                    <span className={valueClass}>{formatTimeOnly(ap.startAt)}</span>
                  </div>
                  <div className={rowClass}>
                    <span className={labelClass}>{t("appointments.createdAt")}</span>
                    <span className={valueClass}>{formatAppointmentCreatedAtRu(ap.createdAt)}</span>
                  </div>
                </div>
                <div className="sticky bottom-0 z-[1] flex shrink-0 flex-col gap-2 border-t border-slate-100 bg-white px-6 py-4">
                  {showActions ? (
                    <div className="flex flex-wrap gap-2">
                      {showEditServices ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setDetailsModal({ open: false, appointment: null });
                            setServicesModalAppointment(ap);
                          }}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t("serviceLines.editAction")}
                        </button>
                      ) : null}
                      {showReschedule ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            const { date, time } = parseStartAtToDateAndTimeInputs(ap.startAt);
                            setDetailsModal({ open: false, appointment: null });
                            setRescheduleModal({
                              open: true,
                              appointment: ap,
                              date,
                              time,
                              error: "",
                            });
                          }}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t("appointments.reschedule")}
                        </button>
                      ) : null}
                      {showStart ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void updateStatus(ap)}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {ap.status === "arrived"
                            ? t("appointments.startConsultation")
                            : t("appointment.markArrived")}
                        </button>
                      ) : null}
                      {showCancelBtn ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setDetailsModal({ open: false, appointment: null });
                            setCancelModal({ open: true, appointment: ap, reason: "" });
                          }}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          {t("appointments.cancelAppointment")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {showIssueBtn ? (
                      <button
                        type="button"
                        disabled={isSubmitting || issuingQueueId === ap.id}
                        onClick={() => void handleIssueQueueNumber(ap)}
                        className="mr-auto inline-flex min-h-[40px] items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                      >
                        {t("appointments.queue.issue")}
                      </button>
                    ) : null}
                    {showTicketBtn ? (
                      <button
                        type="button"
                        disabled={printingTicketId === ap.id}
                        onClick={() => void printTicket(ap.id)}
                        className="mr-auto inline-flex min-h-[40px] items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 shadow-sm transition hover:bg-sky-100 disabled:opacity-50"
                      >
                        {t("appointments.queue.ticket")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                      onClick={() => setDetailsModal({ open: false, appointment: null })}
                    >
                      {t("appointments.close")}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </Modal>
      )}

      {rescheduleModal.open && rescheduleModal.appointment ? (
        <Modal
          isOpen={rescheduleModal.open}
          backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
          onClose={() => {
            const id = rescheduleModal.appointment?.id;
            setRescheduleModal({
              open: false,
              appointment: null,
              date: "",
              time: "",
              error: "",
            });
            if (id != null) {
              const latest = appointments.find((x) => x.id === id);
              if (latest) setDetailsModal({ open: true, appointment: latest });
            }
          }}
          className="w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.2)]"
        >
          <h3 className="text-base font-semibold text-slate-900">{t("appointments.reschedule")}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {patientsMap[rescheduleModal.appointment.patientId] ?? "Пациент"} ·{" "}
            {formatTimeOnly(rescheduleModal.appointment.startAt)}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Дата
              </label>
              <input
                type="date"
                value={rescheduleModal.date}
                onChange={(e) =>
                  setRescheduleModal((s) => ({ ...s, date: e.target.value, error: "" }))
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Время
              </label>
              <input
                type="time"
                step={300}
                value={rescheduleModal.time}
                onChange={(e) =>
                  setRescheduleModal((s) => ({ ...s, time: e.target.value, error: "" }))
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
                disabled={isSubmitting}
              />
            </div>
          </div>
          {rescheduleModal.error ? (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {rescheduleModal.error}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                const id = rescheduleModal.appointment?.id;
                setRescheduleModal({
                  open: false,
                  appointment: null,
                  date: "",
                  time: "",
                  error: "",
                });
                if (id != null) {
                  const latest = appointments.find((x) => x.id === id);
                  if (latest) setDetailsModal({ open: true, appointment: latest });
                }
              }}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void submitRescheduleTime()}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("common.save")}
            </button>
          </div>
        </Modal>
      ) : null}

      {canUpdateApptStatus && cancelModal.open && cancelModal.appointment ? (
        <Modal
          isOpen={cancelModal.open}
          onClose={() => setCancelModal({ open: false, appointment: null, reason: "" })}
          className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
          <h3 className="text-lg font-semibold text-[#111827]">{t("appointments.cancelAppointment")}</h3>
          <p className="mt-2 text-sm text-[#6b7280]">
            {t("appointments.patient")}: {patientsMap[cancelModal.appointment.patientId] ?? `#${cancelModal.appointment.patientId}`}
          </p>
          <div className="mt-4">
            <label className="mb-1 block text-xs uppercase tracking-wide text-[#6b7280]">
              {t("appointments.cancelReason")}
            </label>
            <textarea
              value={cancelModal.reason}
              onChange={(event) =>
                setCancelModal((prev) => ({ ...prev, reason: event.target.value }))
              }
              className="min-h-24 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
              placeholder={isDoctorUser ? t("appointments.cancelReason") : t("appointments.cancelReasonPlaceholder")}
              maxLength={500}
              disabled={isSubmitting}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] active:scale-[0.97]"
              onClick={() => setCancelModal({ open: false, appointment: null, reason: "" })}
              disabled={isSubmitting}
            >
              {t("common.close")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.97] disabled:opacity-50"
              onClick={() => void cancelAppointment()}
              disabled={isSubmitting}
            >
              Подтвердить отмену
            </button>
          </div>
        </Modal>
      ) : null}

      {canEditAppointmentPrice && priceModal.open && priceModal.appointment ? (
        <Modal
          isOpen={priceModal.open}
          onClose={() => setPriceModal({ open: false, appointment: null, price: 0 })}
          className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
          <h3 className="text-lg font-semibold text-[#111827]">Изменить цену</h3>
          <p className="mt-2 text-sm text-[#6b7280]">
            Пациент: {patientsMap[priceModal.appointment.patientId] ?? `#${priceModal.appointment.patientId}`}
          </p>
          <div className="mt-4">
            <label className="mb-1 block text-xs uppercase tracking-wide text-[#6b7280]">
              Цена
            </label>
            <MoneyInput
              mode="integer"
              value={priceModal.price}
              onChange={(next) => setPriceModal((prev) => ({ ...prev, price: next }))}
              className="h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
              disabled={isSubmitting}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] active:scale-[0.97]"
              onClick={() => setPriceModal({ open: false, appointment: null, price: 0 })}
              disabled={isSubmitting}
            >
              {t("common.close")}
            </button>
            <button
              type="button"
              className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#16a34a] active:scale-[0.97] disabled:opacity-50"
              onClick={() => void updateAppointmentPrice()}
              disabled={isSubmitting}
            >
              {t("common.save")}
            </button>
          </div>
        </Modal>
      ) : null}

      {servicesModalAppointment && token ? (
        <AppointmentServicesModal
          appointment={servicesModalAppointment}
          token={token}
          canEditPrices={canEditAppointmentPrice}
          onClose={() => {
            const closed = servicesModalAppointment;
            setServicesModalAppointment(null);
            setDetailsModal({ open: true, appointment: closed });
          }}
          onSaved={handleServicesSaved}
        />
      ) : null}
    </div>
  );
};
