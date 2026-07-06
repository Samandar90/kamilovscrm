import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";
import { PageLoader } from "./PageLoader";
import { SectionCard } from "./SectionCard";

type DataTableProps = {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
  children: React.ReactNode;
};

export const DataTable: React.FC<DataTableProps> = ({
  title,
  subtitle,
  loading = false,
  empty = false,
  emptyTitle,
  emptySubtitle,
  children,
}) => {
  const { t } = useTranslation();
  const finalEmptyTitle = emptyTitle ?? t("components.noData");
  const finalEmptySubtitle = emptySubtitle ?? t("components.empty");

  return (
  <SectionCard className="crm-data-table overflow-hidden p-0">
    {title || subtitle ? (
      <div className="border-b border-gray-200 px-4 py-3">
        {title ? <p className="text-sm font-semibold text-gray-900">{title}</p> : null}
        {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
      </div>
    ) : null}

      {loading ? <PageLoader /> : empty ? <EmptyState title={finalEmptyTitle} subtitle={finalEmptySubtitle} /> : children}
    </SectionCard>
  );
};

