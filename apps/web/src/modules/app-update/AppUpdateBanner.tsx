import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { reloadToNewVersion, useUpdateAvailable } from "./appUpdate";

/**
 * The «Доступна новая версия» bar. Shown while the tab still runs the old version and waits for a moment to reload:
 * it reloads by itself on the next page change or once nobody is at the screen. The button is for those who will not wait.
 */
export const AppUpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const available = useUpdateAvailable();

  if (!available) return null;

  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-2 md:px-5">
      <div className="flex min-w-0 items-center gap-2 text-sm text-sky-900">
        <RefreshCw className="h-4 w-4 shrink-0 text-sky-600" />
        <span className="min-w-0 truncate">{t("appUpdate.available")}</span>
      </div>
      <button
        type="button"
        onClick={() => reloadToNewVersion(() => window.confirm(t("appUpdate.unsavedConfirm")))}
        className="shrink-0 rounded-lg border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-100"
      >
        {t("common.actions.refresh")}
      </button>
    </div>
  );
};
