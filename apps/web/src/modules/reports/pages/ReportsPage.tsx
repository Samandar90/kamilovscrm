import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { reportsApi, type PeriodKey, type ReportsGranularity } from "../api/reportsApi";
import { ReportsHeader } from "../components/ReportsHeader";
import { ReportsKPI } from "../components/ReportsKPI";
import { ReportsChart } from "../components/ReportsChart";
import { ReportsBreakdown } from "../components/ReportsBreakdown";
import { ReportsTable } from "../components/ReportsTable";
import { ReportsInsights } from "../components/ReportsInsights";
import { formatSum } from "../../../utils/formatMoney";

const pct = (current: number, prev: number): number | null => {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((current - prev) / prev) * 100;
};

const todayYmd = (): string => {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const mapPeriod = (period: PeriodKey): ReportsGranularity => {
  if (period === "today") return "day";
  if (period === "week") return "day";
  if (period === "month") return "week";
  return "day";
};

export const ReportsPage: React.FC = () => {
  const { t } = useTranslation(["reports", "common"]);
  const [period, setPeriod] = React.useState<PeriodKey>("week");
  const [doctorId, setDoctorId] = React.useState<number | null>(null);
  const [serviceId, setServiceId] = React.useState<number | null>(null);
  const [customDateFrom, setCustomDateFrom] = React.useState(todayYmd());
  const [customDateTo, setCustomDateTo] = React.useState(todayYmd());

  const [summary, setSummary] = React.useState<Awaited<ReturnType<typeof reportsApi.getSummary>> | null>(null);
  const [revenue, setRevenue] = React.useState<Awaited<ReturnType<typeof reportsApi.getRevenue>> | null>(null);
  const [metrics, setMetrics] = React.useState<Awaited<ReturnType<typeof reportsApi.getMetrics>> | null>(null);
  const [doctorBreakdown, setDoctorBreakdown] = React.useState<Awaited<ReturnType<typeof reportsApi.getRevenueByDoctor>>["rows"]>([]);
  const [serviceBreakdown, setServiceBreakdown] = React.useState<Awaited<ReturnType<typeof reportsApi.getRevenueByService>>["rows"]>([]);
  const [doctors, setDoctors] = React.useState<Awaited<ReturnType<typeof reportsApi.listDoctors>>>([]);
  const [services, setServices] = React.useState<Awaited<ReturnType<typeof reportsApi.listServices>>>([]);
  const [payments, setPayments] = React.useState<Awaited<ReturnType<typeof reportsApi.listPayments>>>([]);
  const [invoices, setInvoices] = React.useState<Awaited<ReturnType<typeof reportsApi.listInvoices>>>([]);

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const range = React.useMemo(() => {
    if (period !== "custom") return {};
    return {
      dateFrom: customDateFrom || undefined,
      dateTo: customDateTo || undefined,
    };
  }, [period, customDateFrom, customDateTo]);

  const loadAll = React.useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [s, r, m, bd, bs, ds, sv, p, i] = await Promise.all([
          reportsApi.getSummary(),
          reportsApi.getRevenue({ ...range, granularity: mapPeriod(period) }),
          reportsApi.getMetrics(range),
          reportsApi.getRevenueByDoctor(range),
          reportsApi.getRevenueByService(range),
          reportsApi.listDoctors(),
          reportsApi.listServices(),
          reportsApi.listPayments(),
          reportsApi.listInvoices(),
        ]);

        setSummary(s);
        setRevenue(r);
        setMetrics(m);
        setDoctorBreakdown(bd.rows);
        setServiceBreakdown(bs.rows);
        setDoctors(ds);
        setServices(sv);
        setPayments(p);
        setInvoices(i);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errorLoadingReports"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, range]
  );

  React.useEffect(() => {
    void loadAll("initial");
  }, [loadAll]);

  const filteredDoctorBreakdown = React.useMemo(() => {
    if (!doctorId) return doctorBreakdown;
    return doctorBreakdown.filter((row) => row.doctorId === doctorId);
  }, [doctorBreakdown, doctorId]);

  const filteredServiceBreakdown = React.useMemo(() => {
    if (!serviceId) return serviceBreakdown;
    return serviceBreakdown.filter((row) => row.serviceId === serviceId);
  }, [serviceBreakdown, serviceId]);

  const filteredInvoices = React.useMemo(() => {
    if (!serviceId && !doctorId) return invoices;
    const filteredAppointmentIds = new Set<number>();
    if (doctorId) {
      for (const row of filteredDoctorBreakdown) {
        if (row.doctorId === doctorId && row.doctorId != null) {
          // appointmentId is not available from reports endpoint; keep full list
        }
      }
    }
    if (filteredAppointmentIds.size === 0) return invoices;
    return invoices.filter((invoice) => invoice.appointmentId != null && filteredAppointmentIds.has(invoice.appointmentId));
  }, [invoices, doctorId, serviceId, filteredDoctorBreakdown]);

  const filteredPayments = React.useMemo(() => {
    const invoiceIdSet = new Set(filteredInvoices.map((invoice) => invoice.id));
    if (invoiceIdSet.size === 0) return payments;
    return payments.filter((payment) => invoiceIdSet.has(payment.invoiceId));
  }, [payments, filteredInvoices]);

  const growth = metrics ? pct(metrics.totalRevenue, metrics.prevRevenue) : null;
  const averageCheck = metrics && metrics.metrics.paymentsCount > 0 ? metrics.totalRevenue / metrics.metrics.paymentsCount : 0;
  const topDoctor = filteredDoctorBreakdown[0]?.doctorName ?? null;
  const topService = filteredServiceBreakdown[0]?.serviceName ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 bg-slate-50/80 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("subtitle")}
          {summary?.timezone ? ` · ${t("timezone")} ${summary.timezone}` : ""}
        </p>
      </header>

      <ReportsHeader
        period={period}
        onPeriodChange={setPeriod}
        doctorId={doctorId}
        onDoctorChange={setDoctorId}
        serviceId={serviceId}
        onServiceChange={setServiceId}
        customDateFrom={customDateFrom}
        customDateTo={customDateTo}
        onCustomDateFromChange={setCustomDateFrom}
        onCustomDateToChange={setCustomDateTo}
        doctors={doctors}
        services={services}
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => void loadAll("refresh")}
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error || t("common:error")}</div>
      ) : null}

      <ReportsKPI
        loading={loading}
        items={[
          { title: t("revenue"), value: metrics?.totalRevenue ?? 0, changePct: growth },
          { title: t("growth"), value: growth == null ? "—" : `${growth > 0 ? "+" : ""}${Math.round(growth)}%`, changePct: growth },
          { title: t("patients"), value: summary?.revenueByDoctor.length ?? 0 },
          { title: t("invoices"), value: invoices.length },
          { title: t("averageCheck"), value: averageCheck },
        ]}
      />

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
        <ReportsChart points={revenue?.points ?? []} granularity={revenue?.granularity ?? "day"} loading={loading} />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: 0.04 }}>
        <ReportsBreakdown doctors={filteredDoctorBreakdown} services={filteredServiceBreakdown} loading={loading} />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: 0.06 }}>
        <ReportsTable payments={filteredPayments} invoices={filteredInvoices} loading={loading} />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, delay: 0.08 }}>
        <ReportsInsights
          loading={loading}
          revenue={metrics?.totalRevenue ?? 0}
          growthPct={growth}
          averageCheck={averageCheck}
          paymentsCount={metrics?.metrics.paymentsCount ?? 0}
          topDoctor={topDoctor}
          topService={topService}
        />
      </motion.div>

      {!loading && !error && metrics && metrics.totalRevenue <= 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {t("noFinancialData")}
        </div>
      ) : null}

      <footer className="text-xs text-slate-400">{t("currentRevenue")}: {formatSum(metrics?.totalRevenue ?? 0)}</footer>
    </div>
  );
};
