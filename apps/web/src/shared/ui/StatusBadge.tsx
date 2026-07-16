import React from "react";
import { cn } from "../../ui/utils/cn";

type StatusBadgeProps = {
  tone?: "success" | "warning" | "danger" | "neutral" | "info";
  children: React.ReactNode;
  className?: string;
};

const dotClass: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-500",
  neutral: "bg-gray-400",
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ tone = "neutral", children, className }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
      tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
      tone === "danger" && "border-rose-200 bg-rose-50 text-rose-700",
      tone === "info" && "border-sky-200 bg-sky-50 text-sky-700",
      tone === "neutral" && "border-gray-200 bg-gray-50 text-gray-600",
      className
    )}
  >
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[tone])} aria-hidden />
    {children}
  </span>
);
