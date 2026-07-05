import type { UserRole } from "../../../auth/permissions";
import type { AiChipVisual, EmptyHeroAction, SmartQuickChip } from "../constants";

type Chip = SmartQuickChip;
type Hero = EmptyHeroAction;

const chart = "chart" as AiChipVisual;
const invoice = "invoice" as AiChipVisual;
const crown = "crown" as AiChipVisual;
const team = "team" as AiChipVisual;
const health = "health" as AiChipVisual;

export function getQuickPromptChipsForRole(role: UserRole, t: (key: string) => string): SmartQuickChip[] {
  const EXEC_CHIPS: Chip[] = [
    { text: t("roleQuickPrompts.execChip1"), icon: chart, domain: t("roleQuickPrompts.analyticsDomain") },
    { text: t("roleQuickPrompts.execChip2"), icon: crown, domain: t("roleQuickPrompts.loadDomain") },
    { text: t("roleQuickPrompts.execChip3"), icon: invoice, domain: t("roleQuickPrompts.moneyDomain") },
    { text: t("roleQuickPrompts.execChip4"), icon: chart, domain: t("roleQuickPrompts.risksDomain") },
    { text: t("roleQuickPrompts.execChip5"), icon: health, domain: t("roleQuickPrompts.focusDomain") },
  ];

  const FINANCE_CHIPS: Chip[] = [
    { text: t("roleQuickPrompts.financeChip1"), icon: invoice, domain: t("roleQuickPrompts.invoicesDomain") },
    { text: t("roleQuickPrompts.financeChip2"), icon: chart, domain: t("roleQuickPrompts.cashDomain") },
    { text: t("roleQuickPrompts.financeChip3"), icon: invoice, domain: t("roleQuickPrompts.paymentsDomain") },
    { text: t("roleQuickPrompts.financeChip4"), icon: invoice, domain: t("roleQuickPrompts.moneyDomain") },
    { text: t("roleQuickPrompts.financeChip5"), icon: chart, domain: t("roleQuickPrompts.focusDomain") },
  ];

  const FRONT_CHIPS: Chip[] = [
    { text: t("roleQuickPrompts.frontChip1"), icon: team, domain: t("roleQuickPrompts.scheduleDomain") },
    { text: t("roleQuickPrompts.frontChip2"), icon: team, domain: t("roleQuickPrompts.slotsDomain") },
    { text: t("roleQuickPrompts.frontChip3"), icon: team, domain: t("roleQuickPrompts.patientsDomain") },
    { text: t("roleQuickPrompts.frontChip4"), icon: health, domain: t("roleQuickPrompts.focusDomain") },
    { text: t("roleQuickPrompts.frontChip5"), icon: team, domain: t("roleQuickPrompts.dayDomain") },
  ];

  const CLINICAL_CHIPS: Chip[] = [
    { text: t("roleQuickPrompts.clinicalChip1"), icon: team, domain: t("roleQuickPrompts.scheduleDomain") },
    { text: t("roleQuickPrompts.clinicalChip2"), icon: health, domain: t("roleQuickPrompts.noshowDomain") },
    { text: t("roleQuickPrompts.clinicalChip3"), icon: health, domain: t("roleQuickPrompts.processDomain") },
    { text: t("roleQuickPrompts.clinicalChip4"), icon: team, domain: t("roleQuickPrompts.systemDomain") },
    { text: t("roleQuickPrompts.clinicalChip5"), icon: health, domain: t("roleQuickPrompts.focusDomain") },
  ];

  if (role === "superadmin" || role === "manager" || role === "director") return EXEC_CHIPS;
  if (role === "cashier" || role === "accountant") return FINANCE_CHIPS;
  if (role === "doctor" || role === "nurse") return CLINICAL_CHIPS;
  return FRONT_CHIPS;
}

export function getEmptyHeroActionsForRole(role: UserRole, t: (key: string) => string): EmptyHeroAction[] {
  const EXEC_HERO: Hero[] = [
    { prompt: t("roleQuickPrompts.execHero1"), subtitle: t("roleQuickPrompts.execHeroSub1"), icon: chart },
    { prompt: t("roleQuickPrompts.execHero2"), subtitle: t("roleQuickPrompts.execHeroSub2"), icon: crown },
    { prompt: t("roleQuickPrompts.execHero3"), subtitle: t("roleQuickPrompts.execHeroSub3"), icon: invoice },
    { prompt: t("roleQuickPrompts.execHero4"), subtitle: t("roleQuickPrompts.execHeroSub4"), icon: chart },
  ];

  const FINANCE_HERO: Hero[] = [
    { prompt: t("roleQuickPrompts.financeHero1"), subtitle: t("roleQuickPrompts.financeHeroSub1"), icon: invoice },
    { prompt: t("roleQuickPrompts.financeHero2"), subtitle: t("roleQuickPrompts.financeHeroSub2"), icon: chart },
    { prompt: t("roleQuickPrompts.financeHero3"), subtitle: t("roleQuickPrompts.financeHeroSub3"), icon: invoice },
    { prompt: t("roleQuickPrompts.financeHero4"), subtitle: t("roleQuickPrompts.financeHeroSub4"), icon: invoice },
  ];

  const FRONT_HERO: Hero[] = [
    { prompt: t("roleQuickPrompts.frontHero1"), subtitle: t("roleQuickPrompts.frontHeroSub1"), icon: team },
    { prompt: t("roleQuickPrompts.frontHero2"), subtitle: t("roleQuickPrompts.frontHeroSub2"), icon: team },
    { prompt: t("roleQuickPrompts.frontHero3"), subtitle: t("roleQuickPrompts.frontHeroSub3"), icon: team },
    { prompt: t("roleQuickPrompts.frontHero4"), subtitle: t("roleQuickPrompts.frontHeroSub4"), icon: team },
  ];

  const CLINICAL_HERO: Hero[] = [
    { prompt: t("roleQuickPrompts.clinicalHero1"), subtitle: t("roleQuickPrompts.clinicalHeroSub1"), icon: team },
    { prompt: t("roleQuickPrompts.clinicalHero2"), subtitle: t("roleQuickPrompts.clinicalHeroSub2"), icon: health },
    { prompt: t("roleQuickPrompts.clinicalHero3"), subtitle: t("roleQuickPrompts.clinicalHeroSub3"), icon: health },
    { prompt: t("roleQuickPrompts.clinicalHero4"), subtitle: t("roleQuickPrompts.clinicalHeroSub4"), icon: team },
  ];

  if (role === "superadmin" || role === "manager" || role === "director") return EXEC_HERO;
  if (role === "cashier" || role === "accountant") return FINANCE_HERO;
  if (role === "doctor" || role === "nurse") return CLINICAL_HERO;
  return FRONT_HERO;
}
