import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

const BASE_BUTTON_CLASS =
  "inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-primary-600 to-primary-700 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.30)] transition duration-200 ease-out hover:-translate-y-px hover:brightness-110 hover:shadow-[0_16px_34px_rgba(37,99,235,0.45)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

export const Button: React.FC<ButtonProps> = ({ children, loading = false, className = "", disabled, ...props }) => {
  const { t } = useTranslation();
  return (
    <button className={[BASE_BUTTON_CLASS, className].filter(Boolean).join(" ")} disabled={disabled || loading} {...props}>
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
          <span>{t("components.loading")}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};

