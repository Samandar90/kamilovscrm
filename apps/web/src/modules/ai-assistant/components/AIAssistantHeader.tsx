import React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../../ui/utils/cn";

export type AIAssistantHeaderProps = {
  className?: string;
  /** Действие справа сверху (например очистка чата) */
  trailing?: React.ReactNode;
};

export const AIAssistantHeader: React.FC<AIAssistantHeaderProps> = ({ className, trailing }) => (
  <header className={cn("w-full", className)}>
    <div className="flex h-[56px] items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Sparkles className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-slate-900">AI Ассистент</h1>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Онлайн
          </p>
        </div>
      </div>
      {trailing}
    </div>
  </header>
);
