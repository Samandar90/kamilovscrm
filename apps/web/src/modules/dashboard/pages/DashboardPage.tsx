import React from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  CalendarCheck2,
  CalendarClock,
  CalendarPlus,
  CreditCard,
  FileText,
  RefreshCw,
  Receipt,
  Store,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import type { UserRole } from "../../../auth/types";
import {
  canCreatePatients,
  canReadAi,
  canReadAppointments,
  canReadBilling,
  canReadPatients,
  canUseDashboardQuickPatientBooking,
  canWriteAppointments,
  canWriteBilling,
} from "../../../auth/roleGroups";
import { formatSum } from "../../../utils/formatMoney";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import type { Appointment, AppointmentStatus } from "../../appointments/api/appointmentsFlowApi";
import type { InvoiceStatus, InvoiceSummary, Payment } from "../../billing/api/cashDeskApi";
import { AppointmentQuickCreateModal } from "../../appointments/features/quick-create/AppointmentQuickCreateModal";
import { DashboardCard } from "../components/DashboardCard";
import { DashboardEmptyState } from "../components/DashboardEmptyState";
import { DashboardQuickActions, type DashboardQuickActionItem } from "../components/DashboardQuickActions";
import { DashboardSetupBanner } from "../components/DashboardSetupBanner";
import { DashboardMorningBriefingSection } from "../components/DashboardMorningBriefingSection";
import { DashboardTodaySummary } from "../components/DashboardTodaySummary";
import { dashboardApi } from "../api/dashboardApi";
import { useDashboardData } from "../hooks/useDashboardData";
import { primaryActionButtonClass } from "../../../shared/ui/buttonStyles";
import { cn } from "../../../ui/utils/cn";
import { getServicesCached } from "../../../shared/cache/servicesCache";
import { requestJson } from "../../../api/http";

const DEBT_STATUSES: InvoiceStatus[] = ["draft", "issued", "partially_paid"];
const UNPAID_STATUSES = new Set<InvoiceStatus>(["issued", "partially_paid"]);

const statusLabel: Record<AppointmentStatus, string> = {
  scheduled: "Запланировано",
  confirmed: "Подтверждено",
  arrived: "Пришел",
  in_consultation: "На приеме",
  completed: "Завершено",
  cancelled: "Отменено",
  no_show: "Неявка",
};

const statusColor: Record<AppointmentStatus, string> = {
  scheduled: "border-[#e5e7eb] bg-[#f8fafc] text-[#0f172a]",
  confirmed: "border-[#e5e7eb] bg-[#f8fafc] text-[#0f172a]",
  arrived: "border-[#e5e7eb] bg-[#f8fafc] text-[#0f172a]",
  in_consultation: "border-[#e5e7eb] bg-[#f8fafc] text-[#0f172a]",
  completed: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]",
  cancelled: "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]",
  no_show: "border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]",
};

const isToday = (iso: string): boolean => {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const paymentMethodRu = (method: Payment["method"]): string => {
  if (method === "cash") return "Наличные";
  return "Терминал";
};

const roleDashboardCopy = (role: UserRole | undefined): { title: string; subtitle: string } => {
  if (role === "doctor") return { title: "Рабочий стол врача", subtitle: "Ключевые метрики, записи и действия на сегодня" };
  if (role === "nurse") return { title: "Рабочий стол медсестры", subtitle: "Записи и задачи по вашему врачу" };
  if (role === "cashier") return { title: "Рабочий стол кассы", subtitle: "Оплаты, долги, смена и ближайшие пациенты" };
  if (role === "reception") return { title: "Регистратура", subtitle: "Пациенты, записи и расписание" };
  if (role === "operator") return { title: "Оператор записи", subtitle: "Расписание и слоты" };
  if (role === "director") return { title: "Операционный обзор", subtitle: "Ежедневная картина по клинике в одном экране" };
  if (role === "accountant") return { title: "Финансы", subtitle: "Счета, оплаты и отчёты" };
  if (role === "superadmin") return { title: "Панель суперадмина", subtitle: "Полный доступ к системе" };
  return { title: "Панель управления", subtitle: "Главный рабочий центр клиники" };
};

const canMarkArrived = (status: AppointmentStatus): boolean => status === "scheduled" || status === "confirmed";
const canMarkCompleted = (status: AppointmentStatus): boolean =>
  status === "confirmed" || status === "arrived" || status === "in_consultation";

export const DashboardPage: React.FC = () => {
  const { user, token } = useAuth();
  const role = user?.role;
  const { title: headerTitle, subtitle: headerSubtitle } = roleDashboardCopy(role);

  const {
    loading,
    partialError,
    appointments,
    payments,
    invoices,
    patients,
    doctors,
    services,
    activeShift,
    reload,
  } = useDashboardData(role);

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionPendingById, setActionPendingById] = React.useState<Record<number, string>>({});
  const [quickModalOpen, setQuickModalOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (!token) return;
    void getServicesCached(() => requestJson("/api/services", { token }));
  }, [token]);

  const readAppointments = role ? canReadAppointments(role) : false;
  const readBilling = role ? canReadBilling(role) : false;
  const readPatients = role ? canReadPatients(role) : false;
  const readAi = role ? canReadAi(role) : false;
  const writeAppointments = role ? canWriteAppointments(role) : false;
  const writeBilling = role ? canWriteBilling(role) : false;
  const canQuickPatientBooking = role ? canUseDashboardQuickPatientBooking(role) : false;

  const patientsMap = React.useMemo(() => Object.fromEntries(patients.map((p) => [p.id, p.fullName])), [patients]);
  const doctorsMap = React.useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d.name])), [doctors]);
  const servicesMap = React.useMemo(() => Object.fromEntries(services.map((s) => [s.id, s.name])), [services]);

  const todayAppointments = React.useMemo(
    () => (readAppointments ? appointments.filter((a) => isToday(a.startAt)) : []),
    [appointments, readAppointments]
  );
  const todayPayments = React.useMemo(
    () => (readBilling ? payments.filter((p) => !p.deletedAt && isToday(p.createdAt)) : []),
    [payments, readBilling]
  );
  const newPatientsToday = React.useMemo(
    () => (readPatients ? patients.filter((p) => p.createdAt && isToday(p.createdAt)).length : 0),
    [patients, readPatients]
  );

  const revenueToday = React.useMemo(() => todayPayments.reduce((acc, p) => acc + p.amount, 0), [todayPayments]);

  const openInvoices = React.useMemo(() => invoices.filter((i) => UNPAID_STATUSES.has(i.status)), [invoices]);
  const debtRows = React.useMemo(() => {
    if (!readBilling) return [];
    return invoices
      .filter((i) => DEBT_STATUSES.includes(i.status))
      .map((i) => ({ invoiceId: i.id, patientId: i.patientId, debt: Math.max(0, i.total - i.paidAmount) }))
      .filter((i) => i.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 6);
  }, [invoices, readBilling]);

  const debtTotal = React.useMemo(() => debtRows.reduce((acc, row) => acc + row.debt, 0), [debtRows]);

  const upcomingAppointments = React.useMemo(() => {
    if (!readAppointments) return [];
    const now = Date.now();
    return todayAppointments
      .filter((a) => {
        const ts = new Date(a.startAt).getTime();
        return ts >= now && a.status !== "cancelled" && a.status !== "no_show";
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, 10);
  }, [todayAppointments, readAppointments]);

  const recentPayments = React.useMemo(() => {
    if (!readBilling) return [];
    return [...payments]
      .filter((p) => !p.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
  }, [payments, readBilling]);

  const invoiceByAppointment = React.useMemo(() => {
    const map: Record<number, InvoiceSummary> = {};
    invoices.forEach((inv) => {
      if (inv.appointmentId) map[inv.appointmentId] = inv;
    });
    return map;
  }, [invoices]);

  const completedToday = React.useMemo(
    () => todayAppointments.filter((a) => a.status === "completed").length,
    [todayAppointments]
  );

  const completionRate = todayAppointments.length ? (completedToday / todayAppointments.length) * 100 : 0;

  const quickActionItems = React.useMemo<DashboardQuickActionItem[]>(() => {
    return [
      {
        to: "/appointments",
        label: "Новая запись",
        subLabel: "Расписание",
        icon: CalendarPlus,
        disabled: !readAppointments,
        disabledReason: "Нет доступа к расписанию",
      },
      {
        to: "/patients",
        label: "Новый пациент",
        subLabel: "Карточка в базе",
        icon: UserPlus,
        disabled: !readPatients,
        disabledReason: "Нет доступа к пациентам",
      },
      {
        to: "/billing/cash-desk",
        label: "Принять оплату",
        subLabel: "Касса",
        icon: Wallet,
        disabled: !readBilling,
        disabledReason: "Нет доступа к биллингу",
      },
      {
        to: "/billing/cash-desk",
        label: "Открыть смену",
        subLabel: "Смена",
        icon: Store,
        disabled: !readBilling,
        disabledReason: "Нет доступа к кассе",
      },
      {
        to: "/billing/invoices",
        label: "Выставить счет",
        subLabel: "Биллинг",
        icon: FileText,
        disabled: !readBilling,
        disabledReason: "Нет доступа к счетам",
      },
      {
        to: "/appointments",
        label: "Расписание",
        subLabel: "Все записи",
        icon: CalendarClock,
        disabled: !readAppointments,
        disabledReason: "Нет доступа к расписанию",
      },
    ];
  }, [readAppointments, readBilling, readPatients]);

  const runAppointmentAction = async (appointmentId: number, action: "arrived" | "completed" | "invoice") => {
    try {
      setActionError(null);
      setActionPendingById((prev) => ({ ...prev, [appointmentId]: action }));
      const row = appointments.find((a) => a.id === appointmentId);
      if (!row) return;

      if (action === "arrived") await dashboardApi.markArrived(appointmentId);
      if (action === "completed") await dashboardApi.completeAppointment(appointmentId);
      if (action === "invoice") {
        if (invoiceByAppointment[appointmentId]) return;
        await dashboardApi.createInvoiceForAppointment({
          patientId: row.patientId,
          appointmentId,
          serviceId: row.serviceId,
        });
      }
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    } finally {
      setActionPendingById((prev) => {
        const clone = { ...prev };
        delete clone[appointmentId];
        return clone;
      });
    }
  };

  const openQuickModal = () => {
    if (!readAppointments || !canQuickPatientBooking) return;
    setQuickModalOpen(true);
  };

  const showSetupBanner =
    !loading &&
    readAppointments &&
    readBilling &&
    readPatients &&
    appointments.length === 0 &&
    invoices.length === 0 &&
    payments.filter((p) => !p.deletedAt).length === 0;

  const todayLabel = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className={cn(
        "page-enter w-full max-w-none space-y-4 overflow-x-hidden rounded-2xl bg-slate-50/70 p-4 max-md:[&_button]:min-h-[44px] md:space-y-7 md:p-8",
        canQuickPatientBooking && readAppointments && "max-md:pb-[100px]"
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-2 md:gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-[#0f172a] md:text-2xl lg:text-3xl">{headerTitle}</h1>
          <p className="mt-0.5 hidden text-sm text-[#64748b] sm:block">{headerSubtitle}</p>
          <p className="mt-0.5 text-xs text-[#94a3b8] md:text-sm">Сегодня, {todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canQuickPatientBooking ? (
            <button
              type="button"
              onClick={openQuickModal}
              disabled={!readAppointments}
              className={`${primaryActionButtonClass} max-md:hidden`}
            >
              <CalendarPlus className="h-4 w-4" />
              + Быстрая запись пациента
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void reload();
            }}
            className="crm-btn-interactive inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f1f5f9] text-[#64748b] shadow-sm transition-transform duration-100 ease-out active:scale-[0.98] max-md:active:scale-[0.98] md:h-11 md:w-11 md:transition-colors md:duration-200 md:ease-out md:hover:bg-[#e2e8f0] md:hover:text-[#0f172a]"
            disabled={loading}
            aria-label="Обновить"
            title="Обновить"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {partialError ? (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">{partialError}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">{actionError}</div>
      ) : null}
      {toast ? (
        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534] shadow-sm">
          {toast}
        </div>
      ) : null}
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)] xl:gap-5 xl:items-stretch">
        <div className="flex flex-col gap-3 md:gap-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5">
            <div className="min-w-0 sm:col-span-2">
              <DashboardCard
                title="Выручка сегодня"
                subtitle={readBilling && !loading ? "Сумма оплат за день" : undefined}
                value={loading ? "..." : readBilling ? formatSum(revenueToday) : "—"}
                icon={Banknote}
                animationIndex={0}
                loading={loading}
                valueMuted={!readBilling && !loading}
                iconTone="emerald"
                revenueHighlight={readBilling}
                revenueAmount={revenueToday}
              />
            </div>
            <DashboardCard
              title="Записи сегодня"
              subtitle={readAppointments && !loading ? "На сегодня" : undefined}
              value={loading ? "..." : readAppointments ? String(todayAppointments.length) : "—"}
              icon={CalendarClock}
              animationIndex={1}
              loading={loading}
              valueMuted={!readAppointments && !loading}
              iconTone="indigo"
            />
            <DashboardCard
              title="Новые пациенты"
              subtitle={readPatients && !loading ? "Сегодня" : undefined}
              value={loading ? "..." : readPatients ? String(newPatientsToday) : "—"}
              icon={Users}
              animationIndex={2}
              loading={loading}
              valueMuted={!readPatients && !loading}
              iconTone="violet"
            />
          </div>

          {showSetupBanner ? (
            <DashboardSetupBanner
              steps={[
                { label: "Добавить пациента", to: "/patients", done: patients.length > 0, icon: UserPlus },
                { label: "Создать запись", to: "/appointments", done: appointments.length > 0, icon: CalendarPlus },
                { label: "Выставить счёт", to: "/billing/invoices", done: invoices.length > 0, icon: FileText },
              ]}
            />
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5 xl:auto-rows-fr">
            <DashboardCard
              title="Долги пациентов"
              subtitle={readBilling && !loading ? "Задолженность" : undefined}
              value={loading ? "..." : readBilling ? formatSum(debtTotal) : "—"}
              icon={Receipt}
              animationIndex={3}
              loading={loading}
              valueMuted={!readBilling && !loading}
              iconTone="rose"
            />
            <DashboardCard
              title="Активная смена"
              subtitle={readBilling && !loading ? "Касса" : undefined}
              value={loading ? "..." : readBilling ? (activeShift && !activeShift.closedAt ? "Открыта" : "Закрыта") : "—"}
              icon={Store}
              animationIndex={4}
              loading={loading}
              valueMuted={!readBilling && !loading}
              iconTone="amber"
            />
            <DashboardCard
              title="Неоплаченные счета"
              subtitle={readBilling && !loading ? "К оплате" : undefined}
              value={loading ? "..." : readBilling ? String(openInvoices.length) : "—"}
              icon={CreditCard}
              animationIndex={5}
              loading={loading}
              valueMuted={!readBilling && !loading}
              iconTone="sky"
            />
          </div>
        </div>

        {readAi && token ? (
          <div className="h-full">
            <DashboardMorningBriefingSection
              token={token}
              userName={(user?.fullName ?? "").trim() || user?.username || ""}
            />
          </div>
        ) : (
          <div className="hidden xl:block" />
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 md:gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DashboardTodaySummary
            loading={loading}
            appointmentsCount={readAppointments ? todayAppointments.length : 0}
            paymentsCount={readBilling ? todayPayments.length : 0}
            newPatientsCount={readPatients ? newPatientsToday : 0}
            completionRate={completionRate}
          />
        </div>
      </section>

      <DashboardQuickActions items={quickActionItems} />

      <section className="grid grid-cols-1 gap-3 md:gap-6 xl:grid-cols-2">
        <div className="rounded-[20px] border border-slate-100/90 bg-white p-4 shadow-sm backdrop-blur-sm md:p-6 md:transition-all md:duration-200 md:hover:shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#111827]">Ближайшие записи сегодня</h2>
            <Link to="/appointments" className="text-xs font-semibold text-[#6366f1] hover:text-[#4f46e5]">
              Открыть расписание
            </Link>
          </div>

          {!readAppointments ? (
            <DashboardEmptyState icon={CalendarClock} title="Нет доступа" description="Расписание недоступно для вашей роли" />
          ) : loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-[#f3f4f6]" />)}</div>
          ) : upcomingAppointments.length === 0 ? (
            <DashboardEmptyState icon={CalendarClock} title="На сегодня ближайших записей нет" description="Когда появятся записи, они будут здесь" action={{ label: "Новая запись", to: "/appointments" }} />
          ) : (
            <div className="space-y-2">
              {upcomingAppointments.map((a) => {
                const busy = actionPendingById[a.id];
                const hasInvoice = Boolean(invoiceByAppointment[a.id]);
                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-3 md:transition md:hover:-translate-y-1 md:hover:shadow-[0_14px_34px_-20px_rgba(15,23,42,0.12)]"
                  >
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[80px_1fr_1fr_1fr_auto] md:items-center">
                      <div className="text-sm font-semibold text-[#111827]">
                        {new Date(a.startAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-sm text-[#111827]">{patientsMap[a.patientId] ?? `Пациент #${a.patientId}`}</div>
                      <div className="text-sm text-[#374151]">{doctorsMap[a.doctorId] ?? `Врач #${a.doctorId}`}</div>
                      <div className="text-sm text-[#6b7280]">{servicesMap[a.serviceId] ?? `Услуга #${a.serviceId}`}</div>
                      <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs ${statusColor[a.status]}`}>{statusLabel[a.status]}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/appointments"
                        className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1 text-xs font-medium text-[#111827] transition hover:bg-[#f3f4f6]"
                      >
                        Открыть
                      </Link>
                      <button
                        type="button"
                        disabled={!writeAppointments || !canMarkArrived(a.status) || Boolean(busy)}
                        onClick={() => void runAppointmentAction(a.id, "arrived")}
                        className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1 text-xs font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === "arrived" ? "Обновление..." : "Отметить пришел"}
                      </button>
                      <button
                        type="button"
                        disabled={!writeAppointments || !canMarkCompleted(a.status) || Boolean(busy)}
                        onClick={() => void runAppointmentAction(a.id, "completed")}
                        className="rounded-lg bg-[#22c55e] px-2.5 py-1 text-xs font-medium text-white transition hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === "completed" ? "Обновление..." : "Завершить"}
                      </button>
                      <button
                        type="button"
                        disabled={!writeBilling || hasInvoice || Boolean(busy)}
                        onClick={() => void runAppointmentAction(a.id, "invoice")}
                        className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1 text-xs font-medium text-[#111827] transition hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {hasInvoice ? "Счет уже есть" : busy === "invoice" ? "Создание..." : "Выставить счет"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 md:space-y-6">
          <div className="rounded-[20px] border border-slate-100/90 bg-white p-4 shadow-sm backdrop-blur-sm sm:p-5 md:transition-all md:duration-200 md:hover:shadow-md">
            <h2 className="mb-2 text-base font-semibold text-[#111827]">Последние оплаты</h2>
            {!readBilling ? (
              <DashboardEmptyState icon={CreditCard} title="Нет доступа" description="Оплаты доступны ролям с правами биллинга" />
            ) : loading ? (
              <div className="space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-[#f3f4f6]" />)}</div>
            ) : recentPayments.length === 0 ? (
              <DashboardEmptyState icon={CreditCard} title="Оплат пока нет" description="Платежи появятся после операций в кассе" />
            ) : (
              <ul className="divide-y divide-[#f1f5f9]">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <time className="text-[11px] tabular-nums text-[#6b7280] sm:text-xs" dateTime={p.createdAt}>
                      {formatDateTimeRu(p.createdAt)}
                    </time>
                    <span className="text-sm font-semibold tabular-nums text-[#111827]">{formatSum(p.amount)}</span>
                    <span className="inline-flex rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-2 py-0.5 text-[10px] font-medium text-[#4b5563] sm:text-[11px]">
                      {paymentMethodRu(p.method)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[20px] border border-slate-100/90 bg-white p-4 shadow-sm backdrop-blur-sm md:p-6 md:transition-all md:duration-200 md:hover:shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#111827]">Долги пациентов</h2>
              <Link to="/billing/invoices" className="text-xs font-semibold text-[#6366f1] hover:text-[#4f46e5]">
                Перейти в биллинг
              </Link>
            </div>
            {!readBilling ? (
              <DashboardEmptyState icon={Receipt} title="Нет доступа" description="Список долгов виден ролям биллинга" />
            ) : loading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-[#f3f4f6]" />)}</div>
            ) : debtRows.length === 0 ? (
              <DashboardEmptyState icon={CalendarCheck2} title="Задолженностей нет" description="Открытые счета без долга не обнаружены" />
            ) : (
              <div className="space-y-2">
                {debtRows.map((row) => (
                  <div key={row.invoiceId} className="flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-2">
                    <div>
                      <p className="text-sm text-[#111827]">{patientsMap[row.patientId] ?? `Пациент #${row.patientId}`}</p>
                      <p className="text-xs text-[#6b7280]">Счет #{row.invoiceId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-[#111827]">{formatSum(row.debt)}</p>
                      <Link to="/billing/invoices" className="text-xs font-semibold text-[#6366f1] hover:text-[#4f46e5]">
                        Открыть
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {canQuickPatientBooking && readAppointments ? (
        <button
          type="button"
          onClick={openQuickModal}
          className="fixed bottom-16 left-0 right-0 z-[90] flex w-full justify-center px-4 transition-transform duration-150 ease-out active:scale-[0.98] md:hidden"
          aria-label="Быстрая запись пациента"
        >
          <span className="flex min-h-[48px] w-full max-w-none items-center justify-center gap-2 rounded-[14px] bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(5,150,105,0.45)]">
            <CalendarPlus className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            + Быстрая запись пациента
          </span>
        </button>
      ) : null}
      {canQuickPatientBooking ? (
        <AppointmentQuickCreateModal
          open={quickModalOpen}
          onClose={() => setQuickModalOpen(false)}
          onCreated={async () => {
            await reload();
            setToast("Запись создана");
          }}
          token={token ?? null}
          canCreateNewPatient={role ? canCreatePatients(role) : false}
        />
      ) : null}
    </div>
  );
};
