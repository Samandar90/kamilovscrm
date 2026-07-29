import React from "react";
import { useTranslation } from "react-i18next";
import { UserCog } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { getImpersonatorName, stopImpersonation } from "../auth/impersonation";

/**
 * Жёлтая полоса «вы работаете от имени другого пользователя».
 * Видна, пока в storage отложен токен админа; «Вернуться» восстанавливает его
 * и перезагружает приложение уже под админом.
 */
export const ImpersonationBanner: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const impersonatorName = getImpersonatorName();

  if (impersonatorName === null) return null;

  const handleReturn = () => {
    if (stopImpersonation()) {
      window.location.replace("/users");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 md:px-5">
      <div className="flex min-w-0 items-center gap-2 text-sm text-amber-900">
        <UserCog className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="min-w-0 truncate">
          {t("impersonation.banner", {
            name: user?.fullName ?? user?.username ?? "",
            admin: impersonatorName,
          })}
        </span>
      </div>
      <button
        type="button"
        onClick={handleReturn}
        className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
      >
        {t("impersonation.return")}
      </button>
    </div>
  );
};
