import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { DoctorOption, PeriodKey, ServiceOption } from "../api/reportsApi";

type Props = {
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  doctorId: number | null;
  onDoctorChange: (doctorId: number | null) => void;
  serviceId: number | null;
  onServiceChange: (serviceId: number | null) => void;
  customDateFrom: string;
  customDateTo: string;
  onCustomDateFromChange: (v: string) => void;
  onCustomDateToChange: (v: string) => void;
  doctors: DoctorOption[];
  services: ServiceOption[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
};

const tabClass = (active: boolean): string =>
  `rounded-xl border px-3 py-2 text-sm font-medium transition ${
    active
      ? "border-slate-300 bg-white text-slate-900 shadow-sm"
      : "border-transparent bg-slate-100/70 text-slate-600 hover:bg-slate-200/60"
  }`;

export const ReportsHeader: React.FC<Props> = ({
  period,
  onPeriodChange,
  doctorId,
  onDoctorChange,
  serviceId,
  onServiceChange,
  customDateFrom,
  customDateTo,
  onCustomDateFromChange,
  onCustomDateToChange,
  doctors,
  services,
  loading,
  refreshing,
  onRefresh,
}) => {
  const { t } = useTranslation();
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            ["today", t("reports.periodToday")],
            ["week", t("reports.periodWeek")],
            ["month", t("reports.periodMonth")],
            ["custom", t("reports.periodCustom")],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onPeriodChange(key as PeriodKey)}
              className={tabClass(period === key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {t("reports.refresh")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {period === "custom" ? (
          <>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("reports.dateFrom")}
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => onCustomDateFromChange(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("reports.dateTo")}
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => onCustomDateToChange(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
          </>
        ) : null}

        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {t("reports.doctorLabel")}
          <select
            value={doctorId ?? ""}
            onChange={(e) => onDoctorChange(e.target.value ? Number(e.target.value) : null)}
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
          >
            <option value="">{t("reports.allDoctors")}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {t("reports.serviceLabel")}
          <select
            value={serviceId ?? ""}
            onChange={(e) => onServiceChange(e.target.value ? Number(e.target.value) : null)}
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
          >
            <option value="">{t("reports.allServices")}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
};

