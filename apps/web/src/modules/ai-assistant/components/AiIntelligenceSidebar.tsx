import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Info, RefreshCw, Sparkles } from "lucide-react";
import { aiAssistantService, type BusinessInsightDto } from "../services/aiAssistantService";
import { PREMIUM_GLASS } from "../constants";
import { cn } from "../../../ui/utils/cn";

const toneStyles: Record<BusinessInsightDto["type"], string> = {
  warning: "border-yellow-200/90 bg-yellow-50/80",
  info: "border-blue-200/90 bg-blue-50/80",
  success: "border-emerald-200/90 bg-emerald-50/80",
};

const iconTone: Record<BusinessInsightDto["type"], string> = {
  warning: "text-amber-600",
  info: "text-blue-600",
  success: "text-emerald-600",
};

function InsightGlyph({ type }: { type: BusinessInsightDto["type"] }) {
  const cls = `h-4 w-4 shrink-0 ${iconTone[type]}`;
  if (type === "warning") return <AlertTriangle className={cls} strokeWidth={2} aria-hidden />;
  if (type === "success") return <CheckCircle className={cls} strokeWidth={2} aria-hidden />;
  return <Info className={cls} strokeWidth={2} aria-hidden />;
}

function SidebarSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden>
      <div className="h-10 rounded-xl bg-slate-200/50" />
      <div className="h-24 rounded-2xl bg-slate-200/40" />
      <div className="h-20 rounded-2xl bg-slate-200/35" />
      <div className="h-28 rounded-2xl bg-slate-200/35" />
    </div>
  );
}

export const AiIntelligenceSidebar = () => {
  const { t } = useTranslation();
  const [insights, setInsights] = useState<BusinessInsightDto[]>([]);
  const [todayFocus, setTodayFocus] = useState<string[]>([]);
  const [proactiveHeadline, setProactiveHeadline] = useState<string | null>(null);
  const [kpiTeaser, setKpiTeaser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await aiAssistantService.insights();
      setInsights(data.insights);
      setTodayFocus(data.todayFocus ?? []);
      setProactiveHeadline(data.proactiveHeadline ?? null);
      setKpiTeaser(data.kpiTeaser ?? null);
    } catch {
      setError(t("ai.errors.loadAnalytics"));
      setInsights([]);
      setTodayFocus([]);
      setProactiveHeadline(null);
      setKpiTeaser(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium tracking-wide text-slate-500">{t("aiAssistant.todayHeading")}</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
          {t("dashboard.refresh")}
        </button>
      </div>

      {error ? <p className="text-center text-xs font-medium text-red-600">{error}</p> : null}

      {loading && insights.length === 0 && !error ? <SidebarSkeleton /> : null}

      {!loading && !error && proactiveHeadline ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "flex gap-3 rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-indigo-50/90 via-white/80 to-violet-50/50 px-4 py-3.5 shadow-sm backdrop-blur-md"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md">
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600/90">{t("aiAssistant.aiOverview")}</p>
            <p className="mt-0.5 text-sm font-medium leading-snug text-slate-800">{proactiveHeadline}</p>
            {kpiTeaser ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{kpiTeaser}</p> : null}
          </div>
        </motion.div>
      ) : null}

      {!loading && !error && todayFocus.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className={cn("rounded-2xl p-4", PREMIUM_GLASS)}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("aiAssistant.whatImportant")}</p>
          <ul className="mt-2.5 space-y-2">
            {todayFocus.map((line, i) => (
              <li
                key={`${line}-${i}`}
                className="flex gap-2 text-xs font-medium leading-snug text-slate-700 before:mt-1.5 before:h-1 before:w-1 before:shrink-0 before:rounded-full before:bg-blue-500/80 before:content-['']"
              >
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}

      <section className={cn("relative rounded-2xl p-4 pt-3", PREMIUM_GLASS)}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("aiAssistant.insightsActions")}</p>

        {!loading && !error && insights.length === 0 ? (
          <p className="py-2 text-center text-xs text-slate-500">{t("aiAssistant.noDataForInsights")}</p>
        ) : null}

        <ul className="space-y-3">
          {insights.map((item, i) => (
            <motion.li
              key={`${item.title}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.06, 0.35) }}
              whileHover={{
                scale: 1.015,
                transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
              }}
              className={cn(
                "rounded-2xl border p-3.5 transition-all duration-300",
                "shadow-[0_4px_16px_-4px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.08),0_0_24px_-6px_rgba(99,102,241,0.12)]",
                toneStyles[item.type]
              )}
            >
              <div className="flex gap-3">
                <InsightGlyph type={item.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight text-slate-900">{item.title}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("aiAssistant.signal")}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 line-clamp-3">{item.message}</p>
                  {item.recommendation ? (
                    <>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("aiAssistant.nextStep")}</p>
                      <p className="mt-0.5 text-xs font-medium text-slate-800 line-clamp-2">{item.recommendation}</p>
                    </>
                  ) : null}
                  {item.link ? (
                    <Link
                      to={item.link.path}
                      className="mt-2.5 inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      {item.link.label} →
                    </Link>
                  ) : null}
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  );
};
