import React from "react";
import { Activity, CalendarClock, CreditCard, UserPlus } from "lucide-react";

type DashboardTodaySummaryProps = {
  appointmentsCount: number;
  paymentsCount: number;
  newPatientsCount: number;
  completionRate: number;
  loading?: boolean;
};

const rowMeta = [
  { label: "Записей", icon: CalendarClock, tone: "indigo" as const },
  { label: "Оплат", icon: CreditCard, tone: "emerald" as const },
  { label: "Новых пациентов", icon: UserPlus, tone: "violet" as const },
  { label: "Завершено, %", icon: Activity, tone: "sky" as const },
];

const toneClass: Record<(typeof rowMeta)[number]["tone"], string> = {
  indigo: "border-indigo-100 bg-indigo-50 text-indigo-600",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-600",
  violet: "border-violet-100 bg-violet-50 text-violet-600",
  sky: "border-sky-100 bg-sky-50 text-sky-600",
};

export const DashboardTodaySummary: React.FC<DashboardTodaySummaryProps> = ({
  appointmentsCount,
  paymentsCount,
  newPatientsCount,
  completionRate,
  loading,
}) => {
  const values = [
    loading ? "…" : String(appointmentsCount),
    loading ? "…" : String(paymentsCount),
    loading ? "…" : String(newPatientsCount),
    loading ? "…" : `${Math.round(completionRate)}%`,
  ];

  return (
    <div className="rounded-[20px] border border-slate-100/90 bg-white p-4 shadow-sm md:p-6 md:transition-all md:duration-200 md:ease-[cubic-bezier(0.22,1,0.36,1)] md:hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-[#64748b] md:text-[13px]">Сегодня</p>
        <p className="hidden text-xs text-[#94a3b8] sm:block">Сводка смены</p>
      </div>
      <ul className="mt-3 flex flex-col gap-2 md:mt-5 md:gap-3">
        {rowMeta.map((row, i) => {
          const Icon = row.icon;
          return (
            <li
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-[#f1f5f9] pb-3 last:border-0 last:pb-0"
            >
              <span className="flex items-center gap-3 text-sm font-medium text-[#0f172a]">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm ${toneClass[row.tone]}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.85} />
                </span>
                {row.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-[#0f172a]">{values[i]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
