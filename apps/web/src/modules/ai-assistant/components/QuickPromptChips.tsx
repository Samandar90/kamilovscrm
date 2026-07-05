import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { cn } from "../../../ui/utils/cn";
import type { SmartQuickChip } from "../constants";
import { AiChipIcon } from "./aiChipIcons";

export type QuickPromptChipsProps = {
  chips: readonly SmartQuickChip[] | SmartQuickChip[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
  sectionTitle?: string;
};

export const QuickPromptChips: React.FC<QuickPromptChipsProps> = ({
  chips,
  onSelect,
  disabled,
  className,
  sectionTitle,
}) => {
  const { t } = useTranslation();
  return (
    <div className={cn("relative px-0.5", className)}>
      {sectionTitle ? (
        <p className="mb-2.5 px-1 text-xs font-medium tracking-wide text-slate-500">{sectionTitle ?? t("ai.quickQuestionsTitle")}</p>
      ) : null}
      <div
        className={cn(
          "flex gap-2.5 overflow-x-auto overflow-y-hidden pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none]",
          "[&::-webkit-scrollbar]:hidden"
        )}
        role="list"
        aria-label={t("common.loading")}
      >
      {chips.map((chip, i) => (
        <motion.button
          key={chip.text}
          type="button"
          role="listitem"
          disabled={disabled}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{
            scale: 1.05,
            transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          }}
          whileTap={{ scale: 0.97, transition: { duration: 0.2 } }}
          onClick={() => onSelect(chip.text)}
          className={cn(
            "group flex min-w-0 shrink-0 items-center gap-2.5 rounded-full border border-white/50 py-1.5 pl-2 pr-3.5 text-left",
            "bg-white/60 backdrop-blur-xl",
            "shadow-[0_4px_20px_-8px_rgba(0,0,0,0.08)]",
            "transition-[border-color,box-shadow,transform] duration-300 ease-out",
            "hover:border-blue-200/70 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08),0_0_24px_-6px_rgba(59,130,246,0.15)]",
            "active:scale-[0.99]",
            "disabled:pointer-events-none disabled:opacity-35"
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              "bg-gradient-to-br from-indigo-50/90 to-blue-50/90 text-indigo-600 ring-1 ring-indigo-100/70",
              "transition-transform duration-200 group-hover:scale-105"
            )}
          >
            <AiChipIcon kind={chip.icon} className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 pr-0.5">
            <span className="block whitespace-nowrap text-[13px] font-semibold text-slate-800">{chip.text}</span>
            <span className="mt-0.5 block text-[10px] font-medium tracking-wide text-slate-400">{chip.domain}</span>
          </span>
        </motion.button>
      ))}
      </div>
    </div>
  );
};
