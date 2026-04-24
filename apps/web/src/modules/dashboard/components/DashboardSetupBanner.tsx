import React from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../../ui/utils/cn";

export type SetupStep = {
  label: string;
  to: string;
  done?: boolean;
  icon: LucideIcon;
};

type DashboardSetupBannerProps = {
  steps: SetupStep[];
};

export const DashboardSetupBanner: React.FC<DashboardSetupBannerProps> = ({ steps }) => {
  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="dashboard-card-enter rounded-[20px] border border-slate-100/90 bg-white p-3 shadow-sm transition-transform duration-150 ease-out active:scale-[0.99] md:p-4 md:transition-[transform,box-shadow] md:duration-200 md:hover:shadow-md">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Первые шаги</h3>
        <span className="shrink-0 tabular-nums text-[11px] font-medium text-slate-400">
          {doneCount}/{total}
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-green-600/80 transition-[width] duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={total}
        />
      </div>
      <ul className="divide-y divide-slate-100/90">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.to}>
              <Link
                to={step.to}
                className={cn(
                  "flex min-h-[40px] items-center justify-between gap-2 py-2 transition-transform duration-150 ease-out active:scale-[0.98] md:py-2.5",
                  step.done && "opacity-60"
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-medium text-slate-800">{step.label}</span>
                </span>
                {step.done ? (
                  <Check className="h-4 w-4 shrink-0 text-green-600" strokeWidth={2.25} aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={2} aria-hidden />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
