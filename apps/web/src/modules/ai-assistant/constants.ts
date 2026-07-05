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

/** Smart quick chips are translated via i18n, keys in ai.smartChips.* */
export const SMART_QUICK_CHIPS: readonly SmartQuickChip[] = [
  { text: "ai.smartChips.revenue", icon: "chart", domain: "ai.smartChips.analyticsDomain" },
  { text: "ai.smartChips.unpaidInvoices", icon: "invoice", domain: "ai.smartChips.billingDomain" },
  { text: "ai.smartChips.topDoctor", icon: "crown", domain: "ai.smartChips.crmDomain" },
  { text: "ai.smartChips.doctorsAvailable", icon: "team", domain: "ai.smartChips.directoryDomain" },
] as const;

export type EmptyHeroAction = {
  prompt: string;
  subtitle: string;
  icon: AiChipVisual;
};

export const EMPTY_HERO_ACTIONS: readonly EmptyHeroAction[] = [
  { prompt: "ai.emptyHero.revenue.prompt", subtitle: "ai.emptyHero.revenue.subtitle", icon: "chart" },
  { prompt: "ai.emptyHero.invoices.prompt", subtitle: "ai.emptyHero.invoices.subtitle", icon: "invoice" },
  { prompt: "ai.emptyHero.doctor.prompt", subtitle: "ai.emptyHero.doctor.subtitle", icon: "crown" },
  { prompt: "ai.emptyHero.doctors.prompt", subtitle: "ai.emptyHero.doctors.subtitle", icon: "team" },
] as const;

/** Note: Component will call t() on these keys at render time */
export const QUICK_PROMPT_LABELS = SMART_QUICK_CHIPS.map((c) => c.text);
