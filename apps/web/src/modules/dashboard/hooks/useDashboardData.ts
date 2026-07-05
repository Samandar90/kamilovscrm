import React from "react";
import { useTranslation } from "react-i18next";
import { dashboardApi } from "../api/dashboardApi";
import { hasPermission } from "../../../auth/permissions";
import { canReadAppointments, canReadBilling, canReadPatients } from "../../../auth/roleGroups";
import type { UserRole } from "../../../auth/types";
import type { Appointment } from "../../appointments/api/appointmentsFlowApi";
import type { CashRegisterShift, InvoiceSummary, Payment } from "../../billing/api/cashDeskApi";
import type { DashboardDoctor, DashboardPatient, DashboardService } from "../api/dashboardApi";

type DashboardDataState = {
  loading: boolean;
  partialError: string | null;
  appointments: Appointment[];
  payments: Payment[];
  invoices: InvoiceSummary[];
  patients: DashboardPatient[];
  doctors: DashboardDoctor[];
  services: DashboardService[];
  activeShift: CashRegisterShift | null;
  reload: () => Promise<void>;
};

export const useDashboardData = (role: UserRole | undefined): DashboardDataState => {
  const { t } = useTranslation("dashboard");
  const [loading, setLoading] = React.useState(true);
  const [partialError, setPartialError] = React.useState<string | null>(null);
  const [appointments, setAppointments] = React.useState<Appointment[]>([]);
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
      jobs.push({ slot: "appointments", p: dashboardApi.listAppointments() });
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

    settled.forEach((res, index) => {
      if (res.status === "rejected") {
        hasFail = true;
        return;
      }
      switch (jobs[index].slot) {
        case "appointments":
          setAppointments(res.value as Appointment[]);
          break;
        case "payments":
          setPayments(res.value as Payment[]);
          break;
        case "invoices":
          setInvoices(res.value as InvoiceSummary[]);
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
    payments,
    invoices,
    patients,
    doctors,
    services,
    activeShift,
    reload,
  };
};
