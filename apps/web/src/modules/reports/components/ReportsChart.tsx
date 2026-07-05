import React from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import type { ReportsGranularity, RevenuePoint } from "../api/reportsApi";
import { formatReportDayRu } from "../../../utils/formatDateTime";
import { formatSum } from "../../../utils/formatMoney";

type Props = {
  points: RevenuePoint[];
  granularity: ReportsGranularity;
  loading: boolean;
};

const compact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
};

type Row = RevenuePoint & { xLabel: string; xLabelFull: string };

const toRow = (point: RevenuePoint, granularity: ReportsGranularity): Row => {
  if (granularity === "day") {
    return {
      ...point,
      xLabel: formatReportDayRu(point.periodStart),
      xLabelFull: formatReportDayRu(point.periodStart),
    };
  }
  return { ...point, xLabel: point.periodStart, xLabelFull: point.periodStart };
};

const ChartTooltip: React.FC<{
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Row }>;
}> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg shadow-slate-900/10">
      <p className="font-medium text-slate-500">{row.xLabelFull}</p>
      <p className="mt-1 text-sm font-bold text-slate-950">{formatSum(row.totalRevenue)}</p>
    </div>
  );
};

export const ReportsChart: React.FC<Props> = ({ points, granularity, loading }) => {
  const { t } = useTranslation("reports");
  const rows = React.useMemo(() => points.map((point) => toRow(point, granularity)), [points, granularity]);
  return (
    <motion.section
      className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.18)] transition hover:shadow-[0_16px_36px_-20px_rgba(15,23,42,0.2)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <h3 className="text-base font-semibold text-slate-950">{t("chartTitle")}</h3>
      <p className="mt-1 text-sm text-slate-500">{t("chartSubtitle")}</p>
      {loading ? (
        <div className="mt-5 h-[280px] animate-pulse rounded-xl bg-slate-100" />
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {t("noChartData")}
        </div>
      ) : (
        <div className="mt-5 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#334155" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#334155" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="xLabel" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(v) => compact(Number(v))}
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#e2e8f0" }} />
              <Area
                type="monotone"
                dataKey="totalRevenue"
                fill="url(#revenueGradient)"
                stroke="none"
                isAnimationActive
                animationDuration={450}
              />
              <Line
                type="monotone"
                dataKey="totalRevenue"
                stroke="#334155"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#334155", stroke: "#fff", strokeWidth: 2 }}
                animationDuration={420}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.section>
  );
};

