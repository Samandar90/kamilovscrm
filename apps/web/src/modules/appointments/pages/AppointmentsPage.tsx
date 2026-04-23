import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDays, Plus, Search, Zap } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import {
  canCreateAppointmentWithPatientPicker,
  canCreatePatients,
  canReadBilling,
  canReadPatients,
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
import { AppointmentCreateModal, type FullFormFields } from "../components/AppointmentCreateModal";
import { AppointmentQuickCreateModal } from "../features/quick-create/AppointmentQuickCreateModal";
import { useDebouncedAppointmentSlotAvailability } from "../hooks/useDebouncedAppointmentSlotAvailability";
import { CreatePatientModal } from "../components/CreatePatientModal";
import { PrescriptionTemplate } from "../components/PrescriptionTemplate";
import {
  normalizeDateTimeForApi,
  todayYmd,
  uiDateToYmd,
} from "../utils/appointmentFormUtils";
import { summarizeAppointments } from "../utils/appointmentSummary";
import { AppContainer, EmptyState, MoneyInput, PageHeader, PageLoader, SectionCard } from "../../../shared/ui";
import { primaryActionButtonClass } from "../../../shared/ui/buttonStyles";
import { Button } from "../../../ui/Button";
import { coercePriceToNumber, normalizeMoneyInput } from "../../../shared/lib/money";
import { formatSum } from "../../../utils/formatMoney";

const secondaryActionButtonClass =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2 " +
  "text-sm font-medium tracking-tight text-gray-700 shadow-sm transition-all duration-150 ease-out " +
  "hover:scale-[1.02] hover:bg-gray-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

type InvoiceModalState = { open: boolean; appointment: Appointment | null };
type ConsultationModalState = {
  open: boolean;
  appointment: Appointment | null;
  diagnosis: string;
  treatment: string;
  notes: string;
  assignedServiceIds: number[];
  selectedServiceId: string;
};
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

function emptyRangeMessage(tab: RangeTab): string {
  switch (tab) {
    case "today":
      return "Сегодня нет записей";
    case "tomorrow":
      return "Завтра нет записей";
    case "week":
      return "На этой неделе нет записей";
    default:
      return "Нет записей на выбранную дату";
  }
}


const emptyFullForm = (): FullFormFields => ({
  patientQuery: "",
  selectedPatient: null,
  doctorId: "",
  serviceId: "",
  price: 0,
  priceLocked: false,
  date: todayYmd(),
  time: "",
  notes: "",
});

export const AppointmentsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
  const ur = user?.role;
  const canReadPatientsList = canReadPatients(ur);
  const canOpenAppointmentCreateModals = canCreateAppointmentWithPatientPicker(ur);
  const canEditAppointmentPrice = canSetAppointmentCommercialPrice(ur);
  const canUpdateApptStatus = canUpdateAppointments(ur);
  const readBilling = canReadBilling(ur);
  const canDoClinical = ur === "doctor" || ur === "nurse";
  const canCreateInvoice = !!ur && hasPermission(ur, "invoices", "create");

  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [invoicesByAppointmentId, setInvoicesByAppointmentId] = React.useState<
    Record<number, InvoiceSummary | null>
  >({});
  const [patientsList, setPatientsList] = React.useState<Patient[]>([]);
  const patientsMap = React.useMemo(
    () => Object.fromEntries(patientsList.map((p) => [p.id, p.fullName])),
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
  const [rangeTab, setRangeTab] = React.useState<RangeTab>("today");
  const [customDate, setCustomDate] = React.useState(() => todayYmd());
  const [searchQuery, setSearchQuery] = React.useState("");

  const [quickModalOpen, setQuickModalOpen] = React.useState(false);
  const [quickResumePatient, setQuickResumePatient] = React.useState<Patient | null>(null);
  const [fullModalOpen, setFullModalOpen] = React.useState(false);
  const [fullForm, setFullForm] = React.useState<FullFormFields>(emptyFullForm);
  const [createPatientModalOpen, setCreatePatientModalOpen] = React.useState(false);
  const [createPatientInitialName, setCreatePatientInitialName] = React.useState("");

  const fullPatientRef = React.useRef<HTMLInputElement>(null);

  const [invoiceModal, setInvoiceModal] = React.useState<InvoiceModalState>({
    open: false,
    appointment: null,
  });
  const [consultationModal, setConsultationModal] = React.useState<ConsultationModalState>({
    open: false,
    appointment: null,
    diagnosis: "",
    treatment: "",
    notes: "",
    assignedServiceIds: [],
    selectedServiceId: "",
  });
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
  const [fullConflictHint, setFullConflictHint] = React.useState<ConflictHintState>({
    message: null,
    suggestedTimes: [],
  });

  const fullSlotAvailabilityPhase = useDebouncedAppointmentSlotAvailability(
    token,
    {
      doctorId: fullForm.doctorId,
      serviceId: fullForm.serviceId,
      date: fullForm.date,
      time: fullForm.time,
    },
    fullModalOpen && !createPatientModalOpen && Boolean(token)
  );
  const fullSlotAvailabilityPhaseRef = React.useRef(fullSlotAvailabilityPhase);
  fullSlotAvailabilityPhaseRef.current = fullSlotAvailabilityPhase;
  const canCompleteConsultation =
    consultationModal.diagnosis.trim().length > 0 &&
    consultationModal.treatment.trim().length > 0;

  const loadData = React.useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [appointmentRows, patients, doctors, services] = await Promise.all([
        appointmentsFlowApi.listAppointments(token),
        canReadPatientsList ? appointmentsFlowApi.listPatients(token) : Promise.resolve([]),
        appointmentsFlowApi.listDoctors(token),
        appointmentsFlowApi.listServices(token),
      ]);
      const invoicePairs = readBilling
        ? await Promise.all(
            appointmentRows.map(async (row) => {
              try {
                const rows = await appointmentsFlowApi.listInvoicesByAppointment(token, row.id);
                return [row.id, rows[0] ?? null] as const;
              } catch (_error) {
                return [row.id, null] as const;
              }
            })
          )
        : appointmentRows.map((row) => [row.id, null] as const);
      setAppointments(appointmentRows);
      setInvoicesByAppointmentId(Object.fromEntries(invoicePairs));
      setPatientsList(patients);
      setDoctorsMap(Object.fromEntries(doctors.map((item) => [item.id, item.name])));
      setServicesMap(Object.fromEntries(services.map((item) => [item.id, item])));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка загрузки");
    } finally {
      setIsLoading(false);
    }
  }, [token, readBilling, canReadPatientsList]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
        setError("Не удалось загрузить услуги врача");
      } finally {
        setServicesLoading(false);
      }
    },
    [token]
  );

  React.useEffect(() => {
    if (!fullModalOpen || !fullForm.doctorId || servicesLoading) return;
    if (!fullForm.serviceId) return;
    const sid = Number(fullForm.serviceId);
    if (!Number.isInteger(sid) || sid <= 0) return;
    if (availableServices.length === 0 || !availableServices.some((s) => s.id === sid)) {
      setFullForm((f) => ({ ...f, serviceId: "" }));
    }
  }, [
    fullModalOpen,
    fullForm.doctorId,
    fullForm.serviceId,
    availableServices,
    servicesLoading,
  ]);

  React.useEffect(() => {
    if (!fullModalOpen || !fullForm.serviceId) return;
    const sid = Number(fullForm.serviceId);
    if (!Number.isInteger(sid) || sid <= 0) return;
    const selectedService = availableServices.find((service) => service.id === sid);
    if (!selectedService) return;
    setFullForm((prev) => {
      if (prev.priceLocked) return prev;
      return { ...prev, price: Math.round(coercePriceToNumber(selectedService.price)) };
    });
  }, [fullModalOpen, fullForm.serviceId, availableServices]);

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
    setFullForm(emptyFullForm());
    setFullConflictHint({ message: null, suggestedTimes: [] });
    setFullModalOpen(true);
    void loadServicesByDoctor(undefined);
  };

  React.useEffect(() => {
    const doctorId = Number(fullForm.doctorId);
    const serviceId = Number(fullForm.serviceId);
    if (
      fullSlotAvailabilityPhase !== "busy" ||
      !doctorId ||
      !serviceId ||
      !fullForm.date ||
      !fullForm.time
    ) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }

    const duration = servicesMap[serviceId]?.duration ?? 0;
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
    if (Number.isNaN(selectedStart.getTime())) {
      setFullConflictHint({ message: null, suggestedTimes: [] });
      return;
    }
    const selectedEnd = new Date(selectedStart.getTime() + duration * 60_000);

    const activeStatuses = new Set(["scheduled", "confirmed", "arrived", "in_consultation"]);

    const suggestions: string[] = [];
    for (let hour = 8; hour <= 19; hour += 1) {
      for (const minute of [0, 30]) {
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        const slot = `${hh}:${mm}`;
        const start = new Date(`${dateYmd}T${slot}:00`);
        const end = new Date(start.getTime() + duration * 60_000);
        if (end.getHours() > 20 || (end.getHours() === 20 && end.getMinutes() > 0)) continue;
        const busy = appointments.some((row) => {
          if (row.doctorId !== doctorId) return false;
          if (!activeStatuses.has(row.status)) return false;
          const rowStart = new Date(row.startAt.includes(" ") ? row.startAt.replace(" ", "T") : row.startAt);
          const rowEnd = new Date(row.endAt.includes(" ") ? row.endAt.replace(" ", "T") : row.endAt);
          return start < rowEnd && end > rowStart;
        });
        if (!busy) suggestions.push(slot);
        if (suggestions.length >= 3) break;
      }
      if (suggestions.length >= 3) break;
    }

    setFullConflictHint({
      message: null,
      suggestedTimes: suggestions,
    });
  }, [
    appointments,
    fullForm.date,
    fullForm.doctorId,
    fullForm.serviceId,
    fullForm.time,
    fullSlotAvailabilityPhase,
    servicesMap,
  ]);

  const submitFullAppointment = async (form: FullFormFields) => {
    if (!token || !canOpenAppointmentCreateModals) return;
    const doctorId = Number(form.doctorId);
    const serviceId = Number(form.serviceId);
    const patientId = Number(form.selectedPatient?.id);
    if (
      !form.selectedPatient ||
      !Number.isInteger(patientId) ||
      patientId <= 0 ||
      !doctorId ||
      !serviceId ||
      !form.date ||
      !form.time
    ) {
      setError("Заполните все обязательные поля");
      return;
    }
    const startAt = normalizeDateTimeForApi(form.date, form.time);
    if (!startAt) {
      setError("Неверная дата или время");
      return;
    }
    if (!availableServices.some((s) => s.id === serviceId)) {
      setError("Выберите услугу из списка выбранного врача");
      return;
    }
    const servicePrice = coercePriceToNumber(servicesMap[serviceId]?.price ?? 0);
    const parsedPrice = form.priceLocked ? form.price : servicePrice;
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("Цена должна быть числом больше или равна 0");
      return;
    }
    const serviceDuration = servicesMap[serviceId]?.duration ?? 0;
    if (!serviceDuration) {
      setError("Не удалось определить длительность услуги");
      return;
    }
    const slotPhase = fullSlotAvailabilityPhaseRef.current;
    if (slotPhase !== "free") {
      if (slotPhase === "busy") {
        setError("Это время уже занято");
      } else if (slotPhase === "error") {
        setError("Не удалось проверить занятость. Повторите попытку.");
      } else {
        setError("Дождитесь проверки времени");
      }
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.createAppointment(token, {
        patientId,
        doctorId,
        serviceId,
        price: Math.round(parsedPrice),
        startAt,
        status: "scheduled",
        diagnosis: null,
        treatment: null,
        notes: form.notes.trim() || null,
      });
      setFullModalOpen(false);
      setFullForm(emptyFullForm());
      await loadData();
      setToast("Запись создана");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка создания записи");
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
      await appointmentsFlowApi.updateAppointmentStatus(token, appointment.id, nextStatus);
      await loadData();
      setToast("Статус записи обновлен");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка обновления");
    } finally {
      setIsSubmitting(false);
    }
  };

  const createInvoice = async () => {
    if (!token || !invoiceModal.appointment || !canCreateInvoice) return;
    const appointment = invoiceModal.appointment;
    const service = servicesMap[appointment.serviceId];
    if (!service) {
      setError("Не удалось найти услугу для создания счета");
      return;
    }
    const targetPrice = normalizeMoneyInput(appointment.price ?? service.price);
    const servicePrice = normalizeMoneyInput(service.price);
    if (
      targetPrice === null ||
      servicePrice === null ||
      targetPrice < 0 ||
      servicePrice < 0
    ) {
      setError("Некорректная цена записи");
      return;
    }
    const quantity = Number(
      servicePrice > 0 ? Number((targetPrice / servicePrice).toFixed(4)) : 1
    );
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Не удалось рассчитать позицию счета");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.createInvoice(
        token,
        {
          patientId: appointment.patientId,
          appointmentId: appointment.id,
          status: "issued",
          discount: 0,
          items: [{ serviceId: service.id, quantity }],
        },
        {
          servicePrice: service.price,
          appointmentPriceOverride: appointment.price,
        }
      );
      setInvoiceModal({ open: false, appointment: null });
      await loadData();
      setToast("Счет успешно создан");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка создания счета");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openConsultation = (appointment: Appointment) => {
    void loadServicesByDoctor(appointment.doctorId);
    setConsultationModal({
      open: true,
      appointment,
      diagnosis: appointment.diagnosis ?? "",
      treatment: appointment.treatment ?? "",
      notes: appointment.notes ?? "",
      assignedServiceIds: [],
      selectedServiceId: "",
    });
    if (!token) return;
    void appointmentsFlowApi
      .listAppointmentAssignedServices(token, appointment.id)
      .then((rows) => {
        setConsultationModal((prev) => ({
          ...prev,
          assignedServiceIds: rows.map((row) => row.serviceId),
        }));
      })
      .catch(() => undefined);
  };

  const closeConsultation = () => {
    setConsultationModal({
      open: false,
      appointment: null,
      diagnosis: "",
      treatment: "",
      notes: "",
      assignedServiceIds: [],
      selectedServiceId: "",
    });
  };

  const printPrescription = () => {
    if (!consultationModal.appointment) return;
    const row = consultationModal.appointment;
    const popup = window.open("", "_blank");
    if (!popup) return;
    const html = renderToStaticMarkup(
      <PrescriptionTemplate
        clinicName="Kamilovs clinic"
        patientName={patientsMap[row.patientId] ?? `#${row.patientId}`}
        doctorName={doctorsMap[row.doctorId] ?? `#${row.doctorId}`}
        visitDate={formatDateTime(row.startAt)}
        diagnosis={consultationModal.diagnosis || row.diagnosis || "Не указан"}
        treatment={consultationModal.treatment || row.treatment || "Не указано"}
        notes={consultationModal.notes || row.notes}
      />
    );
    popup.document.write(`<!doctype html><html><body>${html}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const completeConsultation = async () => {
    if (!token || !consultationModal.appointment || !canDoClinical) return;
    const diagnosis = consultationModal.diagnosis.trim();
    const treatment = consultationModal.treatment.trim();
    if (!diagnosis || !treatment) {
      setError("Заполните diagnosis и treatment перед завершением приема");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.completeAppointment(token, consultationModal.appointment.id, {
        diagnosis,
        treatment,
        notes: consultationModal.notes.trim() || null,
      });
      closeConsultation();
      await loadData();
      setToast("Пациент готов к оплате");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка завершения приема");
    } finally {
      setIsSubmitting(false);
    }
  };

  const addServiceToConsultation = async () => {
    if (!token || !consultationModal.appointment) return;
    const serviceId = Number(consultationModal.selectedServiceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.addAppointmentService(
        token,
        consultationModal.appointment.id,
        serviceId
      );
      setConsultationModal((prev) => ({
        ...prev,
        selectedServiceId: "",
        assignedServiceIds: [...prev.assignedServiceIds, serviceId],
      }));
      setToast("Услуга назначена");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось назначить услугу");
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelAppointment = async () => {
    if (!token || !cancelModal.appointment || !canUpdateApptStatus) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await appointmentsFlowApi.cancelAppointment(
        token,
        cancelModal.appointment.id,
        cancelModal.reason
      );
      setCancelModal({ open: false, appointment: null, reason: "" });
      await loadData();
      setToast("Запись отменена");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка отмены записи");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateAppointmentPrice = async () => {
    if (!token || !priceModal.appointment || !canEditAppointmentPrice) return;
    const price = priceModal.price;
    if (!Number.isFinite(price) || price < 0) {
      setError("Цена должна быть числом больше или равна 0");
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
      setToast("Цена записи обновлена");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка обновления цены"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const { start: rangeStart, end: rangeEnd } = React.useMemo(
    () => getFilterRange(rangeTab, customDate),
    [rangeTab, customDate]
  );

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

  const tabList: { id: RangeTab; label: string }[] = [
    { id: "today", label: "Сегодня" },
    { id: "tomorrow", label: "Завтра" },
    { id: "week", label: "Неделя" },
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
    <div className="min-h-full bg-[#f8fafc] text-[#334155]">
      <AppContainer className="page-enter">
        <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 space-y-6 lg:col-span-8">
        <PageHeader
          title="Записи"
          subtitle="Управление расписанием пациентов"
          actions={
            canOpenAppointmentCreateModals ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={openQuickModal}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all duration-150"
                >
                  <Zap className="h-4 w-4" />
                  Быстрая запись
                </Button>
                <Button
                  type="button"
                  onClick={openFullModal}
                  disabled={isSubmitting}
                  className={primaryActionButtonClass}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  Новая запись
                </Button>
              </div>
            ) : null
          }
        />

        <SectionCard className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">Дата</label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setRangeTab("custom");
                }}
                className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-sm text-[#111827] outline-none transition hover:border-[#d1d5db] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/25"
              />
            </div>
            <div className="relative flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#64748b]">Поиск</label>
              <Search className="pointer-events-none absolute left-3 top-[34px] h-4 w-4 text-[#9ca3af]" />
              <input
                type="search"
                placeholder="Поиск пациента…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2 pl-10 pr-3 text-sm text-[#111827] placeholder:text-[#9ca3af] outline-none transition hover:border-[#d1d5db] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/25"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Период</label>
            {tabList.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRangeTab(tab.id)}
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
              onClick={() => setRangeTab("custom")}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                rangeTab === "custom"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              Календарь
            </button>
          </div>
        </SectionCard>

        {toast && (
          <SectionCard className="border-[#bbf7d0] bg-[#f0fdf4] p-4 text-sm text-[#166534]">
            {toast}
          </SectionCard>
        )}
        {error && !fullModalOpen && !quickModalOpen && (
          <SectionCard className="border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#991b1b]">
            {error}
          </SectionCard>
        )}

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280]">Расписание</h2>

          {isLoading ? (
            <PageLoader label="Загрузка записей..." />
          ) : appointments.length === 0 ? (
            <SectionCard>
              <EmptyState title="Нет записей" subtitle="Добавьте первую запись" />
            </SectionCard>
          ) : filteredAppointments.length === 0 ? (
            <SectionCard>
              <EmptyState title={emptyRangeMessage(rangeTab)} subtitle="Добавьте первую запись" />
            </SectionCard>
          ) : (
            <ul className="space-y-3">
              {filteredAppointments.map((appointment) => {
                const invoice = invoicesByAppointmentId[appointment.id] ?? null;
                const service = servicesMap[appointment.serviceId];
                return (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    invoice={invoice}
                    patientName={patientsMap[appointment.patientId] ?? `Пациент #${appointment.patientId}`}
                    doctorName={doctorsMap[appointment.doctorId] ?? `#${appointment.doctorId}`}
                    service={service}
                    timeLabel={formatTimeOnly(appointment.startAt)}
                    glassPanelClass={glassPanel}
                    isSubmitting={isSubmitting}
                    canManageAppointmentFlow={canUpdateApptStatus}
                    showFinancialDetails={readBilling}
                    canDoClinical={canDoClinical}
                    canCreateInvoice={canCreateInvoice}
                    onMarkArrived={() => void updateStatus(appointment)}
                    onStartConsultation={() => void updateStatus(appointment)}
                    onCompleteConsultation={() => void updateStatus(appointment)}
                    onCreateInvoice={() => setInvoiceModal({ open: true, appointment })}
                    onCancelAppointment={() =>
                      setCancelModal({ open: true, appointment, reason: appointment.cancelReason ?? "" })
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
                    onOpenDoctorWorkspace={() => openConsultation(appointment)}
                    onCardClick={() => setDetailsModal({ open: true, appointment })}
                  />
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="col-span-12 lg:col-span-4">
        <AppointmentActionPanel
          filterSummary={filteredSummary}
          isLoading={isLoading}
        />
      </div>
        </div>
      </AppContainer>

      {canOpenAppointmentCreateModals && quickModalOpen && !createPatientModalOpen ? (
        <AppointmentQuickCreateModal
          open
          onClose={() => {
            setQuickModalOpen(false);
            setQuickResumePatient(null);
          }}
          onCreated={async () => {
            await loadData();
            setToast("Запись создана");
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
          onDoctorChange={handleDoctorChangeForFull}
          patientInputRef={fullPatientRef}
          slotAvailabilityPhase={fullSlotAvailabilityPhase}
          suggestedTimes={fullConflictHint.suggestedTimes}
          onPickSuggestedTime={(time) => setFullForm((prev) => ({ ...prev, time }))}
          inlineError={fullModalOpen ? error : null}
          onCreatePatientRequest={(query) => openCreatePatientFromAutocomplete(query)}
          canCreateNewPatient={ur ? canCreatePatients(ur) : false}
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
          className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
            <h3 className="text-lg font-semibold text-[#111827]">Детали записи</h3>
            <div className="mt-3 space-y-2 text-sm text-[#374151]">
              <p>
                <span className="text-[#6b7280]">Время:</span> {formatDateTime(detailsModal.appointment.startAt)}
              </p>
              <p>
                <span className="text-[#6b7280]">Пациент:</span>{" "}
                {patientsMap[detailsModal.appointment.patientId] ?? `#${detailsModal.appointment.patientId}`}
              </p>
              <p>
                <span className="text-[#6b7280]">Врач:</span>{" "}
                {doctorsMap[detailsModal.appointment.doctorId] ?? `#${detailsModal.appointment.doctorId}`}
              </p>
              <p>
                <span className="text-[#6b7280]">Услуга:</span>{" "}
                {servicesMap[detailsModal.appointment.serviceId]?.name ??
                  `#${detailsModal.appointment.serviceId}`}
              </p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6]"
                onClick={() => setDetailsModal({ open: false, appointment: null })}
              >
                Закрыть
              </button>
            </div>
        </Modal>
      )}

      {canUpdateApptStatus && cancelModal.open && cancelModal.appointment ? (
        <Modal
          isOpen={cancelModal.open}
          onClose={() => setCancelModal({ open: false, appointment: null, reason: "" })}
          className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
          <h3 className="text-lg font-semibold text-[#111827]">Отменить запись</h3>
          <p className="mt-2 text-sm text-[#6b7280]">
            Пациент: {patientsMap[cancelModal.appointment.patientId] ?? `#${cancelModal.appointment.patientId}`}
          </p>
          <div className="mt-4">
            <label className="mb-1 block text-xs uppercase tracking-wide text-[#6b7280]">
              Причина отмены
            </label>
            <textarea
              value={cancelModal.reason}
              onChange={(event) =>
                setCancelModal((prev) => ({ ...prev, reason: event.target.value }))
              }
              className="min-h-24 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
              placeholder="Например: пациент не пришел"
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
              Закрыть
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
              Закрыть
            </button>
            <button
              type="button"
              className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#16a34a] active:scale-[0.97] disabled:opacity-50"
              onClick={() => void updateAppointmentPrice()}
              disabled={isSubmitting}
            >
              Сохранить
            </button>
          </div>
        </Modal>
      ) : null}

      {canCreateInvoice && invoiceModal.open && invoiceModal.appointment && (
        <Modal
          isOpen={invoiceModal.open}
          onClose={() => setInvoiceModal({ open: false, appointment: null })}
          className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
            <h3 className="text-lg font-semibold text-[#111827]">Создать счет</h3>
            <p className="mt-2 text-sm text-[#6b7280]">
              Услуга: {servicesMap[invoiceModal.appointment.serviceId]?.name ?? "—"}
            </p>
            <p className="text-sm text-[#6b7280]">
              Цена:{" "}
              {formatSum(
                coercePriceToNumber(
                  invoiceModal.appointment.price ?? servicesMap[invoiceModal.appointment.serviceId]?.price ?? 0
                )
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] active:scale-[0.97]"
                onClick={() => setInvoiceModal({ open: false, appointment: null })}
                disabled={isSubmitting}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:scale-[1.03] hover:bg-[#16a34a] active:scale-[0.97] disabled:opacity-50"
                onClick={() => void createInvoice()}
                disabled={isSubmitting}
              >
                Создать счет
              </button>
            </div>
        </Modal>
      )}

      {canDoClinical && consultationModal.open && consultationModal.appointment && (
        <Modal
          isOpen={consultationModal.open}
          onClose={closeConsultation}
          className="w-full max-w-2xl rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.2)]"
        >
            <h3 className="text-lg font-semibold text-[#111827]">Рабочее место врача</h3>
            <p className="mt-1 text-sm text-[#6b7280]">
              Пациент: {patientsMap[consultationModal.appointment.patientId] ?? `#${consultationModal.appointment.patientId}`}
            </p>
            <p className="text-xs text-[#9ca3af]">
              История визитов:{" "}
              {appointments.filter((row) => row.patientId === consultationModal.appointment?.patientId).length}
            </p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-3">
                <p className="text-sm font-medium text-[#111827]">Назначенные услуги</p>
                <ul className="mt-2 space-y-1 text-sm text-[#334155]">
                  {consultationModal.assignedServiceIds.length === 0 ? (
                    <li className="text-[#6b7280]">Пока не назначены</li>
                  ) : (
                    consultationModal.assignedServiceIds.map((serviceId, idx) => (
                      <li key={`${serviceId}-${idx}`}>
                        {servicesMap[serviceId]?.name ?? `Услуга #${serviceId}`}
                      </li>
                    ))
                  )}
                </ul>
                <div className="mt-3 flex gap-2">
                  <select
                    value={consultationModal.selectedServiceId}
                    onChange={(event) =>
                      setConsultationModal((prev) => ({
                        ...prev,
                        selectedServiceId: event.target.value,
                      }))
                    }
                    className="h-10 flex-1 rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-sm text-[#111827]"
                    disabled={isSubmitting}
                  >
                    <option value="">Выберите услугу</option>
                    {availableServices.map((service) => (
                      <option key={service.id} value={String(service.id)}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-xl border border-[#e5e7eb] bg-white px-3 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6]"
                    onClick={() => void addServiceToConsultation()}
                    disabled={isSubmitting || !consultationModal.selectedServiceId}
                  >
                    + Добавить услугу
                  </button>
                </div>
              </div>
              <label className="text-sm text-[#111827]">
                Diagnosis
                <input
                  value={consultationModal.diagnosis}
                  onChange={(event) => setConsultationModal((prev) => ({ ...prev, diagnosis: event.target.value }))}
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
                  aria-label="diagnosis"
                  disabled={isSubmitting}
                />
              </label>
              <label className="text-sm text-[#111827]">
                Treatment
                <textarea
                  value={consultationModal.treatment}
                  onChange={(event) => setConsultationModal((prev) => ({ ...prev, treatment: event.target.value }))}
                  className="mt-1 min-h-20 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
                  aria-label="treatment"
                  disabled={isSubmitting}
                />
              </label>
              <label className="text-sm text-[#111827]">
                Notes
                <textarea
                  value={consultationModal.notes}
                  onChange={(event) => setConsultationModal((prev) => ({ ...prev, notes: event.target.value }))}
                  className="mt-1 min-h-20 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#22c55e] focus:bg-white focus:ring-1 focus:ring-[#22c55e]/25"
                  aria-label="notes"
                  disabled={isSubmitting}
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] active:scale-[0.97]"
                onClick={() => printPrescription()}
                disabled={isSubmitting}
              >
                Печать назначения
              </button>
              <button
                type="button"
                className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2 text-sm font-medium text-[#111827] transition hover:bg-[#f3f4f6] active:scale-[0.97]"
                onClick={closeConsultation}
                disabled={isSubmitting}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#22c55e] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:scale-[1.03] hover:bg-[#16a34a] active:scale-[0.97] disabled:opacity-50"
                onClick={() => void completeConsultation()}
                disabled={isSubmitting || !canCompleteConsultation}
              >
                {isSubmitting ? "Сохранение..." : "Завершить приём"}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
};

const formatDateTime = (value: string): string => {
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
};
