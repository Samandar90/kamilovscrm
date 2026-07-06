import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

type PageLoaderProps = {
  label?: string;
};

export const PageLoader: React.FC<PageLoaderProps> = ({ label }) => {
  const { t } = useTranslation();
  const displayLabel = label ?? t("common.loading");

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {displayLabel}
    </div>
  );
};

