import React from "react";
import type { LucideIcon } from "lucide-react";

/** Цветная иконка на белом фоне карточки (SaaS KPI) */
export type DashboardIconTone = "emerald" | "indigo" | "violet" | "amber" | "sky" | "rose";

const toneStyles: Record<
  DashboardIconTone,
  { box: string; icon: string }
> = {
  emerald: {
    box: "border-emerald-200/60 bg-emerald-50",
    icon: "text-emerald-600",
  },
  indigo: {
    box: "border-indigo-200/60 bg-indigo-50",
    icon: "text-indigo-600",
  },
  violet: {
    box: "border-violet-200/60 bg-violet-50",
    icon: "text-violet-600",
  },
  amber: {
    box: "border-amber-200/60 bg-amber-50",
    icon: "text-amber-600",
  },
  sky: {
    box: "border-sky-200/60 bg-sky-50",
    icon: "text-sky-600",
  },
  rose: {
    box: "border-rose-200/60 bg-rose-50",
    icon: "text-rose-600",
  },
};

const cardShell =
  "dashboard-card-enter group relative flex flex-col overflow-hidden rounded-[20px] border border-slate-100/90 bg-white p-4 shadow-sm transition-transform duration-150 ease-out will-change-transform active:scale-[0.98] md:p-[18px] md:transition-[transform,box-shadow] md:duration-200 md:ease-[cubic-bezier(0.22,1,0.36,1)] md:hover:-translate-y-0.5 md:hover:shadow-md md:hover-scale-subtle";

export type DashboardCardProps = {
  /** Подпись метрики */
  title: string;
  value: string;
  icon: LucideIcon;
  animationIndex: number;
  valueMuted?: boolean;
  /** Подзаголовок под значением (контекст периода и т.д.) */
  subtitle?: string;
  hint?: string;
  comparisonHint?: string;
  footnote?: string;
  loading?: boolean;
  /** Акцент иконки */
  iconTone?: DashboardIconTone;
  className?: string;
  /** Крупная метрика выручки (премиум KPI) */
  revenueHighlight?: boolean;
  /** Сумма для окраски value (0 = серый, >0 = зелёный) */
  revenueAmount?: number;
};

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  value,
  icon: Icon,
  animationIndex,
  valueMuted,
  subtitle,
  hint,
  comparisonHint,
  footnote,
  loading,
  iconTone = "emerald",
  className,
  revenueHighlight,
  revenueAmount = 0,
}) => {
  const tone = toneStyles[iconTone];
  const revenueZero = revenueHighlight && !loading && !valueMuted && revenueAmount === 0;
  const revenuePositive = revenueHighlight && !loading && !valueMuted && revenueAmount > 0;

  if (revenueHighlight) {
    return (
      <div
        className={`dashboard-card-enter group relative flex min-h-[132px] flex-col overflow-hidden rounded-[20px] border border-slate-100/80 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm transition-transform duration-150 ease-out will-change-transform active:scale-[0.98] md:min-h-[140px] md:p-[18px] md:transition-[transform,box-shadow] md:duration-200 md:hover:shadow-md ${className ?? ""}`}
        style={{
          animationDelay: `${animationIndex * 55}ms`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 shadow-none">
            <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </div>
        </div>
        {loading ? (
          <div className="mt-4 h-10 w-48 animate-pulse rounded-lg bg-slate-100/80" />
        ) : (
          <p
            className={`mt-3 text-[clamp(2rem,7.5vw,2.25rem)] font-bold leading-none tracking-tight tabular-nums ${
              valueMuted ? "text-slate-300" : revenueZero ? "text-slate-400" : revenuePositive ? "text-green-600" : "text-slate-900"
            }`}
          >
            {value}
          </p>
        )}
        {hint && !loading && !valueMuted ? (
          <p className="mt-2 text-xs font-medium text-slate-500">{hint}</p>
        ) : null}
        {comparisonHint && !loading && !valueMuted ? (
          <p className="mt-1.5 text-[11px] font-medium tabular-nums text-slate-400">{comparisonHint}</p>
        ) : null}
        {footnote && !loading ? <p className="mt-2 text-xs text-slate-500">{footnote}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={`${cardShell} min-h-[148px] ${className ?? ""}`}
      style={{
        animationDelay: `${animationIndex * 55}ms`,
      }}
    >
      <div className="relative flex items-start gap-3">
        <div
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-none md:transition-transform md:duration-200 md:group-hover:scale-[1.02] ${tone.box}`}
        >
          <Icon className={`h-5 w-5 ${tone.icon}`} strokeWidth={1.85} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
          {subtitle ? <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p> : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-9 w-32 animate-pulse rounded-lg bg-slate-100/80" />
      ) : (
        <p
          className={`mt-3 text-2xl font-semibold leading-tight tracking-tight tabular-nums ${
            valueMuted ? "text-slate-300" : "text-slate-900"
          }`}
        >
          {value}
        </p>
      )}
      {hint && !loading && !valueMuted ? <p className="mt-2 text-xs font-medium text-slate-500">{hint}</p> : null}
      {comparisonHint && !loading && !valueMuted ? (
        <p className="mt-1.5 text-[11px] font-medium tabular-nums text-slate-400">{comparisonHint}</p>
      ) : null}
      {footnote && !loading ? <p className="mt-2 text-xs text-slate-500">{footnote}</p> : null}
    </div>
  );
};
