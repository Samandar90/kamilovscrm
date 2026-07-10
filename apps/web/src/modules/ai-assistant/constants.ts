/** Ширина колонки чата задаётся родителем (max-w-[1400px] layout) */
export const AI_ASSISTANT_MAX_CLASS = "w-full";

/** Стеклянная карточка (Apple-style) */
export const PREMIUM_GLASS =
  "bg-white/70 backdrop-blur-xl border border-white/40 shadow-[0_8px_30px_rgba(0,0,0,0.06)]";

export const PREMIUM_GLASS_HOVER =
  "transition-[box-shadow,transform] duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08),0_0_28px_-6px_rgba(99,102,241,0.12)]";

/** Ключи иконок для умных чипов / карточек */
export type AiChipVisual = "chart" | "invoice" | "crown" | "team" | "health";

export type SmartQuickChip = {
  text: string;
  icon: AiChipVisual;
  /** Короткий контекстный тег (CRM / Клиника) */
  domain: string;
};

export type EmptyHeroAction = {
  prompt: string;
  subtitle: string;
  icon: AiChipVisual;
};
