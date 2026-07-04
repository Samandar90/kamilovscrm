import React from "react";
import { useTranslation } from "react-i18next";
import { useClinic } from "../hooks/useClinic";
import { useAuth } from "../auth/AuthContext";
import { SALES_CONTACTS } from "../shared/config/branding";

/** Имя события, которое http-клиент шлёт при ответе 402 (подписка истекла/приостановлена). */
export const PAYMENT_REQUIRED_EVENT = "sazion:payment-required";

/**
 * Баннер пробного периода + полноэкранная блокировка при 402.
 * Рендерится в MainLayout, чтобы работать на всех страницах клиники.
 */
export const SubscriptionNotice: React.FC = () => {
  const { t } = useTranslation();
  const { clinic } = useClinic();
  const { logout } = useAuth();
  const [blockedMessage, setBlockedMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onPaymentRequired = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setBlockedMessage(
        detail && detail.trim()
          ? detail
          : t("subscription.accessBlockedDesc")
      );
    };
    window.addEventListener(PAYMENT_REQUIRED_EVENT, onPaymentRequired);
    return () => window.removeEventListener(PAYMENT_REQUIRED_EVENT, onPaymentRequired);
  }, []);

  if (blockedMessage) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">
            ⏳
          </div>
          <h2 className="text-lg font-bold text-slate-900">{t("subscription.accessBlocked")}</h2>
          <p className="mt-2 text-sm text-slate-600">{blockedMessage}</p>
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">Для продления свяжитесь с нами:</div>
            <div className="mt-2 flex flex-col gap-1">
              <a href={SALES_CONTACTS.phoneHref} className="font-semibold text-[#2563EB] hover:underline">
                {SALES_CONTACTS.phone}
              </a>
              <a
                href={SALES_CONTACTS.telegramHref}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[#2563EB] hover:underline"
              >
                Telegram: {SALES_CONTACTS.telegram}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-5 h-10 w-full rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {t("common.logout")}
          </button>
        </div>
      </div>
    );
  }

  const isTrial = clinic.subscriptionStatus === "trialing";
  const daysLeft = clinic.subscriptionDaysLeft;
  const activeExpiring =
    clinic.subscriptionStatus === "active" && daysLeft != null && daysLeft <= 5;

  if (!isTrial && !activeExpiring) return null;

  const urgent = daysLeft != null && daysLeft <= 3;
  const text = isTrial
    ? daysLeft != null
      ? `Пробный период: ${daysLeft === 0 ? "заканчивается сегодня" : `осталось ${daysLeft} дн.`}`
      : "Пробный период"
    : `Подписка истекает через ${daysLeft} дн.`;

  return (
    <div
      className={`flex items-center justify-center gap-2 px-3 py-1.5 text-center text-xs font-medium ${
        urgent ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"
      }`}
    >
      <span>{text}</span>
      <span className="hidden sm:inline text-inherit opacity-70">·</span>
      <a
        href={SALES_CONTACTS.telegramHref}
        target="_blank"
        rel="noreferrer"
        className="hidden font-semibold underline-offset-2 hover:underline sm:inline"
      >
        Продлить: {SALES_CONTACTS.telegram}
      </a>
    </div>
  );
};
