import React from "react";
import { useTranslation } from "react-i18next";

export type AiInsightsMetrics = {
  revenueToday: number;
  revenue7d: number;
  unpaidInvoicesCount: number;
  unpaidInvoicesAmount: number;
  appointmentsToday: number;
  completedToday: number;
  avgCheckToday: number;
  avgCheck7d: number;
  topDoctor: string | null;
  noShow30d: number;
};

export type AiInsightsModel = {
  summary: string;
  issues: string[];
  recommendations: string[];
};

const buildInsights = (m: AiInsightsMetrics, t: (key: string) => string): AiInsightsModel => {
  const expectedRevenueToday = m.avgCheck7d * Math.max(m.appointmentsToday, 1);
  let summary = t("aiInsights.revenueStable");
  if (m.appointmentsToday === 0) {
    summary = t("aiInsights.lowLoad");
  } else if (m.revenueToday < expectedRevenueToday * 0.75) {
    summary = t("aiInsights.revenueLow");
  } else if (m.revenueToday > expectedRevenueToday * 1.15) {
    summary = t("aiInsights.revenueHigh");
  }

  const issues: string[] = [];
  if (m.unpaidInvoicesCount > 0) {
    const amount = Math.round(m.unpaidInvoicesAmount).toLocaleString("ru-RU");
    issues.push(t("aiInsights.unpaidInvoices").replace("{{count}}", String(m.unpaidInvoicesCount)).replace("{{amount}}", amount));
  }
  if (m.appointmentsToday < 3) {
    issues.push(t("aiInsights.lowDoctorLoad"));
  }
  if (m.noShow30d > 0) {
    issues.push(t("aiInsights.cancellations").replace("{{count}}", String(m.noShow30d)));
  }
  if (m.avgCheck7d > 0 && m.avgCheckToday > 0 && m.avgCheckToday < m.avgCheck7d * 0.85) {
    issues.push(t("aiInsights.lowAverageCheck"));
  }
  if (issues.length === 0) {
    issues.push(t("aiInsights.noCritical"));
  }

  const recommendations: string[] = [];
  if (m.unpaidInvoicesCount > 0) {
    recommendations.push(t("aiInsights.contactPatients"));
  }
  if (m.appointmentsToday < 3) {
    recommendations.push(t("aiInsights.increaseBooking"));
  }
  if (m.noShow30d > 0) {
    recommendations.push(t("aiInsights.doubleConfirm"));
  }
  if (m.avgCheck7d > 0 && m.avgCheckToday > 0 && m.avgCheckToday < m.avgCheck7d * 0.85) {
    recommendations.push(t("aiInsights.addPackages"));
  }
  if (recommendations.length === 0 && m.topDoctor) {
    recommendations.push(t("aiInsights.copyTopDoctor").replace("{{doctor}}", m.topDoctor));
  }
  if (recommendations.length === 0) {
    recommendations.push(t("aiInsights.maintain"));
  }

  return {
    summary,
    issues: issues.slice(0, 3),
    recommendations: recommendations.slice(0, 3),
  };
};

export const useAiInsights = (metrics: AiInsightsMetrics) => {
  const { t } = useTranslation();
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  const data = React.useMemo(() => buildInsights(metrics, t), [metrics, refreshTick, t]);

  const refresh = React.useCallback(() => {
    setLoading(true);
    window.setTimeout(() => {
      setRefreshTick((prev) => prev + 1);
      setLoading(false);
    }, 450);
  }, []);

  return {
    loading,
    data,
    refresh,
  };
};

