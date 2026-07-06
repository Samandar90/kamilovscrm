import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { formatSum } from "../../../utils/formatMoney";
import type { RevenueByDoctorRow, RevenueByServiceRow } from "../api/reportsApi";

type Props = {
  doctors: RevenueByDoctorRow[];
  services: RevenueByServiceRow[];
  loading: boolean;
};

const TOP_N = 7;

export const ReportsBreakdown: React.FC<Props> = ({ doctors, services, loading }) => {
  const { t } = useTranslation();
  const topDoctors = [...doctors].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, TOP_N);
  const topServices = [...services].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, TOP_N);

  const shell =
    "rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] transition hover:shadow-[0_16px_36px_-20px_rgba(15,23,42,0.2)]";

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <motion.article
        className={shell}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: "easeOut" }}
      >
        <h3 className="text-base font-semibold text-slate-950">{t("reports.doctorRevenueTitle")}</h3>
        <p className="mt-1 text-sm text-slate-500">{t("reports.doctorRevenueSubtitle")}</p>
        {loading ? (
          <div className="mt-4 h-56 animate-pulse rounded-xl bg-slate-100" />
        ) : topDoctors.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {t("reports.noBreakdownData")}
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {topDoctors.map((row, idx) => (
              <li key={`${row.doctorId ?? "none"}-${idx}`} className="flex items-center justify-between gap-4">
                <span className="truncate text-sm text-slate-700">{row.doctorName ?? "—"}</span>
                <span className="shrink-0 text-sm font-semibold text-slate-950">{formatSum(row.totalRevenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.article>

      <motion.article
        className={shell}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: "easeOut", delay: 0.06 }}
      >
        <h3 className="text-base font-semibold text-slate-950">{t("reports.serviceRevenueTitle")}</h3>
        <p className="mt-1 text-sm text-slate-500">{t("reports.serviceRevenueSubtitle")}</p>
        {loading ? (
          <div className="mt-4 h-56 animate-pulse rounded-xl bg-slate-100" />
        ) : topServices.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {t("reports.noBreakdownData")}
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {topServices.map((row, idx) => (
              <li key={`${row.serviceId ?? "none"}-${idx}`} className="flex items-center justify-between gap-4">
                <span className="truncate text-sm text-slate-700">{row.serviceName ?? "—"}</span>
                <span className="shrink-0 text-sm font-semibold text-slate-950">{formatSum(row.totalRevenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.article>
    </section>
  );
};

