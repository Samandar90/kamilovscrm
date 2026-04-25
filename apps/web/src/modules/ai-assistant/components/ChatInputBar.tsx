import React, { useEffect, useRef } from "react";
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
};

const MAX_TA_HEIGHT = 140;

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Сообщение ассистенту…",
  className,
  onFocus,
}) => {
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
          "relative h-14 rounded-2xl border border-slate-200 bg-white px-[14px] py-0 shadow-sm",
          "transition-[border-color,box-shadow] duration-200",
          "focus-within:border-blue-300/70 focus-within:shadow-[0_8px_24px_-14px_rgba(37,99,235,0.4)]"
        )}
      >
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
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
            "h-[56px] w-full resize-none border-0 bg-transparent py-[15px] pr-12 text-[16px] leading-relaxed text-slate-900 outline-none ring-0",
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
          aria-label="Отправить"
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
        Enter — отправить сообщение. Shift+Enter — новая строка.
      </p>
    </div>
  );
};
