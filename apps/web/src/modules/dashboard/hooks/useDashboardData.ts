import React from "react";
import { useTranslation } from "react-i18next";
import { dashboardApi } from "../api/dashboardApi";
import { hasPermission } from "../../../auth/permissions";
import { canReadAppointments, canReadBilling, canReadPatients } from "../../../auth/roleGroups";
import type { UserRole } from "../../../auth/types";
import type { Appointment } from "../../appointments/api/appointmentsFlowApi";
import { todayYmd } from "../../appointments/utils/appointmentFormUtils";
import type { CashRegisterShift, InvoiceSummary, Payment } from "../../billing/api/cashDeskApi";
import type { DashboardDoctor, DashboardPatient, DashboardService } from "../api/dashboardApi";

type DashboardDataState = {
  loading: boolean;
  partialError: string | null;
  /** Today's appointments: every appointment block of the dashboard is about today. */
  appointments: Appointment[];
  /**
   * Whether the clinic has an appointment. With none today one more row is read, but only while nothing has been
   * billed: that is when the setup banner needs the answer. Otherwise this tells about today.
   */
  hasAppointments: boolean;
  payments: Payment[];
  invoices: InvoiceSummary[];
  patients: DashboardPatient[];
  doctors: DashboardDoctor[];
  services: DashboardService[];
  activeShift: CashRegisterShift | null;
  reload: () => Promise<void>;
};

export const useDashboardData = (role: UserRole | undefined): DashboardDataState => {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [partialError, setPartialError] = React.useState<string | null>(null);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
  const [hasAppointments, setHasAppointments] = React.useState(false);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [invoices, setInvoices] = React.useState<InvoiceSummary[]>([]);
  const [patients, setPatients] = React.useState<DashboardPatient[]>([]);
  const [doctors, setDoctors] = React.useState<DashboardDoctor[]>([]);
  const [services, setServices] = React.useState<DashboardService[]>([]);
  const [activeShift, setActiveShift] = React.useState<CashRegisterShift | null>(null);

  const reload = React.useCallback(async () => {
    if (!role) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPartialError(null);

    const jobs: Array<{ slot: string; p: Promise<unknown> }> = [];
    if (hasPermission(role, "doctors", "read")) {
      jobs.push({ slot: "doctors", p: dashboardApi.listDoctors() });
    }
    if (hasPermission(role, "services", "read")) {
      jobs.push({ slot: "services", p: dashboardApi.listServices() });
    }
    if (
      canReadAppointments(role) &&
      role !== "cashier" &&
      role !== "accountant" &&
      role !== "director"
    ) {
      const today = todayYmd();
      jobs.push({ slot: "appointments", p: dashboardApi.listAppointments({ from: today, to: today }) });
    }
    if (canReadBilling(role)) {
      jobs.push({ slot: "payments", p: dashboardApi.listPayments() });
      jobs.push({ slot: "invoices", p: dashboardApi.listInvoices() });
      jobs.push({ slot: "activeShift", p: dashboardApi.activeShift() });
    }
    if (canReadPatients(role) && role !== "accountant" && role !== "director") {
      jobs.push({ slot: "patients", p: dashboardApi.listPatients() });
    }

    const settled = await Promise.allSettled(jobs.map((j) => j.p));
    let hasFail = false;
    const loaded: { appointments?: Appointment[]; payments?: Payment[]; invoices?: InvoiceSummary[] } = {};

    settled.forEach((res, index) => {
      if (res.status === "rejected") {
        hasFail = true;
        return;
      }
      switch (jobs[index].slot) {
        case "appointments":
          loaded.appointments = res.value as Appointment[];
          setAppointments(loaded.appointments);
          break;
        case "payments":
          loaded.payments = res.value as Payment[];
          setPayments(loaded.payments);
          break;
        case "invoices":
          loaded.invoices = res.value as InvoiceSummary[];
          setInvoices(loaded.invoices);
          break;
        case "patients":
          setPatients(res.value as DashboardPatient[]);
          break;
        case "doctors":
          setDoctors(res.value as DashboardDoctor[]);
          break;
        case "services":
          setServices(res.value as DashboardService[]);
          break;
        case "activeShift":
          setActiveShift((res.value as CashRegisterShift | null) ?? null);
          break;
        default:
          break;
      }
    });

    if (loaded.appointments) {
      const billed =
        (loaded.invoices?.length ?? 0) > 0 || loaded.payments?.some((payment) => !payment.deletedAt) === true;
      if (loaded.appointments.length > 0) {
        setHasAppointments(true);
      } else if (!billed && canReadBilling(role) && canReadPatients(role)) {
        // A quiet day is not a new clinic: the setup banner must not come back when today is simply empty.
        try {
          setHasAppointments((await dashboardApi.listAppointments({ limit: 1 })).length > 0);
        } catch {
          hasFail = true;
        }
      } else {
        setHasAppointments(false);
      }
    }

    if (hasFail) {
      setPartialError(t("dashboard.partialLoadError"));
    }
    setLoading(false);
  }, [role]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return {
    loading,
    partialError,
    appointments,
    hasAppointments,
    payments,
    invoices,
    patients,
    doctors,
    services,
    activeShift,
    reload,
  };
};
