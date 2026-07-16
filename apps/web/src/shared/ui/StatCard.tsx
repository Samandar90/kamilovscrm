import React from "react";
import { cn } from "../../ui/utils/cn";
import { SectionCard } from "./SectionCard";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  trend?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export const StatCard: React.FC<StatCardProps> = ({ label, value, trend, tone = "neutral" }) => (
  <SectionCard className="crm-stat-card-enter">
    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</p>
    <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-gray-900">{value}</p>
    {trend ? (
      <p
        className={cn(
          "mt-1 text-xs",
          tone === "success" && "text-emerald-600",
          tone === "warning" && "text-amber-600",
          tone === "danger" && "text-rose-600",
          tone === "neutral" && "text-gray-500"
        )}
      >
        {trend}
      </p>
    ) : null}
  </SectionCard>
);

