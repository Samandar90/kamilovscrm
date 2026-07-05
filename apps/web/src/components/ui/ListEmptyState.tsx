import React from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";

type ListEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  showAction?: boolean;
};

export const ListEmptyState: React.FC<ListEmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
  showAction = true,
}) => {
  const { t } = useTranslation();
  const finalActionLabel = actionLabel ?? t("components.addButton");
  return (
    <div
      className="flex min-h-[min(400px,calc(100vh-260px))] flex-col items-center justify-center rounded-2xl border border-[#e8ecf1] bg-gradient-to-b from-[#f8fafc] via-white to-white px-6 py-16 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white text-[#64748b] shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-4 ring-[#f1f5f9]/80"
        aria-hidden
      >
        <Icon className="h-8 w-8" strokeWidth={1.4} />
      </div>
      <h3 className="mt-6 text-base font-semibold tracking-tight text-[#0f172a]">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-[22rem] text-sm leading-relaxed text-[#64748b]">{description}</p>
      ) : null}
      {showAction && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="mt-8 inline-flex h-10 items-center justify-center rounded-[10px] bg-[#16a34a] px-5 text-sm font-semibold text-white shadow-[0_2px_8px_-2px_rgba(22,163,74,0.45)] transition hover:bg-[#22c55e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16a34a]/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {finalActionLabel}
        </button>
      ) : null}
    </div>
  );
};
