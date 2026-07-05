import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Brain, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import type { AiInsightsModel } from "../../hooks/useAiInsights";

type AiInsightsCardProps = {
  loading: boolean;
  onRefresh: () => void;
  model: AiInsightsModel;
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; tone: string }> = ({ icon, title, tone }) => (
  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
    <span className={tone}>{icon}</span>
    <span>{title}</span>
  </div>
);

export const AiInsightsCard: React.FC<AiInsightsCardProps> = ({ loading, onRefresh, model }) => {
  const { t } = useTranslation();
  return (
    <section className="group relative overflow-hidden rounded-2xl border border-[#dbeafe] bg-gradient-to-br from-white via-[#f8fbff] to-[#f3f7ff] p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#6366f1]/8 blur-2xl" />
      <div className="pointer-events-none absolute -left-12 -bottom-12 h-36 w-36 rounded-full bg-[#22c55e]/6 blur-2xl" />

      <div className="relative mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef2ff] text-[#4f46e5]">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[#0f172a]">{t("aiAssistant.analysisTitle")}</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">{t("aiAssistant.analysisDesc")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#334155] transition hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("aiAssistant.updateAnalysis")}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-40 animate-pulse rounded-xl border border-[#e2e8f0] bg-white/70" />
          ))}
        </div>
      ) : (
      <div className="relative grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-[#dbeafe] bg-[#f8fbff] p-4">
          <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title={t("aiAssistant.conclusion")} tone="text-[#2563eb]" />
          <p className="text-sm leading-relaxed text-[#1e293b]">{model.summary}</p>
        </div>

        <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4">
          <SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title={t("aiAssistant.problems")} tone="text-[#c2410c]" />
          <ul className="space-y-2">
            {model.issues.map((item) => (
              <li key={item} className="text-sm text-[#7c2d12]">
                - {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-4">
          <SectionTitle icon={<Sparkles className="h-4 w-4" />} title={t("aiAssistant.recommendations")} tone="text-[#15803d]" />
          <ul className="space-y-2">
            {model.recommendations.map((item) => (
              <li key={item} className="text-sm text-[#166534]">
                - {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      )}
    </section>
  );
};

