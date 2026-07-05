import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";
import type { EmptyHeroAction } from "../constants";
import { AiChipIcon } from "./aiChipIcons";

export const ClearedChatEmptyState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center px-4 py-14 text-center sm:py-20"
      role="status"
    >
      <p className="max-w-md text-[15px] font-medium leading-relaxed text-neutral-500">
        {t("ai.clearedChat")}
      </p>
    </motion.div>
  );
};

export type EmptyAssistantStateProps = {
  actions: readonly EmptyHeroAction[] | EmptyHeroAction[];
  onSelect: (text: string) => void;
  disabled?: boolean;
};

export const EmptyAssistantState: React.FC<EmptyAssistantStateProps> = ({
  actions,
  onSelect,
  disabled,
}) => {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-col items-center px-3 py-4 text-center sm:py-8">
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex h-[5.5rem] w-[5.5rem] items-center justify-center"
    >
      <motion.div
        className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-br from-indigo-500/20 to-violet-500/15 blur-xl"
        animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.05, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className={[
          "relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.35rem]",
          "bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600",
          "shadow-[0_20px_50px_-16px_rgba(79,70,229,0.55),inset_0_1px_0_rgba(255,255,255,0.2)]",
        ].join(" ")}
        aria-hidden
      >
        <Sparkles className="h-9 w-9 text-white" strokeWidth={1.4} />
      </div>
    </motion.div>

    <motion.h2
      className="relative mt-10 max-w-lg bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-600 bg-clip-text text-[1.375rem] font-semibold leading-tight tracking-tight text-transparent sm:text-2xl"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      {t("ai.emptyStateTitle")}
    </motion.h2>

    <div className="relative mt-12 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
      {actions.slice(0, 4).map((item, i) => (
        <motion.button
          key={item.prompt}
          type="button"
          disabled={disabled}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.32,
            delay: 0.14 + i * 0.06,
            ease: [0.16, 1, 0.3, 1],
          }}
          whileHover={{ y: -4, transition: { type: "spring", stiffness: 380, damping: 22 } }}
          whileTap={{ scale: 0.99 }}
          onClick={() => onSelect(item.prompt)}
          className={[
            "group relative flex w-full gap-4 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/90 p-4 text-left",
            "shadow-[0_2px_12px_-4px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow] duration-300",
            "hover:border-indigo-200/80 hover:shadow-[0_20px_48px_-16px_rgba(79,70,229,0.18)]",
            "disabled:pointer-events-none disabled:opacity-35",
          ].join(" ")}
        >
          <span className="absolute bottom-0 left-0 top-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 opacity-90" />
          <span
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              "bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 ring-1 ring-indigo-100",
              "transition-transform duration-300 group-hover:scale-105",
            ].join(" ")}
          >
            <AiChipIcon kind={item.icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block text-[14px] font-semibold leading-snug text-neutral-900">{item.prompt}</span>
            <span className="mt-1 block text-[12px] leading-snug text-neutral-500">{item.subtitle}</span>
          </span>
          <ChevronRight
            className="mt-1 h-5 w-5 shrink-0 text-neutral-300 transition-colors duration-200 group-hover:text-indigo-400"
            strokeWidth={2}
            aria-hidden
          />
        </motion.button>
      ))}
    </div>
    </div>
  );
};
