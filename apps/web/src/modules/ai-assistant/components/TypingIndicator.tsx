import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { AiChatAvatar, AI_CHAT_GUTTER } from "./ChatMessage";
import { cn } from "../../../ui/utils/cn";

export type TypingIndicatorProps = {
  mode?: "thinking" | "typing";
  className?: string;
};

function BouncingDots() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((d) => (
        <motion.span
          key={d}
          className="h-2 w-2 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 shadow-sm"
          animate={{
            scale: [1, 1.25, 1],
            opacity: [0.35, 1, 0.35],
          }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: d * 0.18,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

export const TypingInline: React.FC<{ label: string; className?: string }> = ({ label, className }) => (
  <div className={cn(AI_CHAT_GUTTER, "flex items-center gap-2.5 text-xs font-medium text-slate-400", className)}>
    <BouncingDots />
    <span>{label}</span>
  </div>
);

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ mode = "thinking", className }) => {
  const { t } = useTranslation();
  return (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
  >
    <div className="flex items-end gap-3.5">
      <AiChatAvatar />
      <div
        className={cn(
          "relative flex max-w-[min(80%,28rem)] items-center gap-3 overflow-hidden rounded-2xl border border-white/50 bg-white/80 px-4 py-3.5",
          "text-xs font-medium text-slate-500 shadow-sm backdrop-blur-xl"
        )}
      >
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear", repeatDelay: 0.35 }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-50/60 to-transparent" aria-hidden />
        <span className="relative flex items-center gap-3">
          <BouncingDots />
          <span className="text-slate-500">{mode === "thinking" ? t("ai.thinking") : t("ai.typing")}</span>
        </span>
      </div>
    </div>
  </motion.div>
  );
};
