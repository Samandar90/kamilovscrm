import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { SendHorizontal } from "lucide-react";
import { cn } from "../../../ui/utils/cn";

export type ChatInputBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  size?: "default" | "desktop";
};

const MAX_TA_HEIGHT = 140;

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  className,
  onFocus,
  size = "default",
}) => {
  const { t } = useTranslation();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TA_HEIGHT)}px`;
  }, [value]);

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "relative border border-slate-200 bg-white py-0 shadow-sm",
          size === "desktop" ? "h-[52px] rounded-[14px] px-4" : "h-14 rounded-2xl px-[14px]",
          "transition-[border-color,box-shadow] duration-200",
          "focus-within:border-blue-300/70 focus-within:shadow-[0_8px_24px_-14px_rgba(37,99,235,0.4)]"
        )}
      >
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? t("ai.messagePlaceholder")}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onFocus?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={cn(
            "w-full resize-none border-0 bg-transparent pr-12 text-[16px] leading-relaxed text-slate-900 outline-none ring-0",
            size === "desktop" ? "h-[52px] py-[13px]" : "h-[56px] py-[15px]",
            "placeholder:text-slate-400",
            "focus:ring-0",
            "disabled:cursor-not-allowed disabled:opacity-45"
          )}
        />
        <motion.button
          type="button"
          disabled={disabled || !value.trim()}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 500, damping: 26 }}
          onClick={onSubmit}
          aria-label={t("common.save")}
          className={cn(
            "absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
            "bg-blue-600 text-white",
            "shadow-sm",
            "transition-[opacity,box-shadow] duration-200 hover:bg-blue-700 hover:shadow-md",
            "disabled:pointer-events-none disabled:opacity-25"
          )}
        >
          <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </motion.button>
      </div>
      <p className="sr-only">
        {t("ai.sendHint")}
      </p>
    </div>
  );
};
