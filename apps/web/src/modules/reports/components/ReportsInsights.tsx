import React from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { formatSum } from "../../../utils/formatMoney";

type Props = {
  revenue: number;
  growthPct: number | null;
  averageCheck: number;
  paymentsCount: number;
  topDoctor?: string | null;
  topService?: string | null;
  loading: boolean;
};

export const ReportsInsights: React.FC<Props> = ({
  revenue,
  growthPct,
  averageCheck,
  paymentsCount,
  topDoctor,
  topService,
  loading,
}) => {
  const { t } = useTranslation("reports");

  const growthText =
    growthPct == null
      ? t("insufficientHistory")
      : growthPct > 0
        ? t("revenueGrowing", { pct: Math.round(growthPct) })
        : growthPct < 0
          ? t("revenueDeclining", { pct: Math.abs(Math.round(growthPct)) })
          : t("revenueStable");

  const doctorText = topDoctor ? t("leadingDoctor", { name: topDoctor }) : t("noLeadingDoctor");
  const serviceText = topService ? t("leadingService", { name: topService }) : t("noLeadingService");

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm md:p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-500" />
        <h3 className="text-base font-semibold text-slate-950">{t("insightsTitle")}</h3>
      </div>
      {loading ? (
        <div className="mt-4 h-28 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
          <p>{growthText}</p>
          <p>
            {t("statsSummary", {
              revenue: formatSum(revenue),
              check: formatSum(averageCheck),
              count: paymentsCount
            })}
          </p>
          <p>{doctorText}</p>
          <p>{serviceText}</p>
        </div>
      )}
    </section>
  );
};

