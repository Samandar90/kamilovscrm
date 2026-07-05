// Translation keys for fallback suggestions
const FALLBACK_KEYS = [
  "aiSuggestions.fallbackReports",
  "aiSuggestions.fallbackInvoices",
  "aiSuggestions.fallbackAppointments",
  "aiSuggestions.fallbackPatients",
];

// Translation keys for contextual suggestions (organized by pattern)
const CONTEXTUAL_KEYS: { test: RegExp; keys: string[] }[] = [
  {
    test: /долг|неоплач|счёт|счет|дебитор|invoice|оплат/i,
    keys: ["aiSuggestions.contextInvoices", "aiSuggestions.contextPayment", "aiSuggestions.contextDebtPatients"],
  },
  {
    test: /загрузк|низк|слот|окн|расписан|запис(и|ей|ь)/i,
    keys: ["aiSuggestions.contextAppointments", "aiSuggestions.contextDoctors", "aiSuggestions.contextAddPatient"],
  },
  {
    test: /врач|топ|перегруж|нагрузк/i,
    keys: ["aiActions.openDoctors", "aiSuggestions.contextAppointments", "aiSuggestions.contextReports"],
  },
  {
    test: /выручк|доход|оборот|аналитик|отчёт|отчет/i,
    keys: ["aiSuggestions.contextReports", "aiRoleChips.exec.chip1", "aiRoleChips.exec.chip2"],
  },
  {
    test: /пациент|карт/i,
    keys: ["aiActions.openPatients", "aiRoleChips.front.chip1", "aiSuggestions.contextAddPatient"],
  },
  { test: /касс|смен/i, keys: ["aiActions.openCashDesk", "aiSuggestions.contextInvoices", "aiRoleChips.finance.chip3"] },
  { test: /no-?show|отмен|пропуск/i, keys: ["aiSuggestions.contextNoShow", "aiRoleChips.clinical.chip3", "aiRoleChips.front.chip1"] },
  {
    test: /риск|теря|потер/i,
    keys: ["aiSuggestions.contextReports", "aiRoleChips.exec.chip4", "aiSuggestions.contextAppointments"],
  },
];

const MAX = 4;

/**
 * До 4 релевантных follow-up: API, затем по тексту ответа, затем запасной пул.
 * Translation happens at component render time via t().
 */
export function mergeSmartSuggestions(apiSuggestions: string[] | undefined, answerText: string): string[] {
  const fromApi = (apiSuggestions ?? []).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of fromApi) {
    if (out.length >= MAX) break;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  const lower = answerText.toLowerCase();
  for (const { test, keys } of CONTEXTUAL_KEYS) {
    if (out.length >= MAX) break;
    if (!test.test(lower)) continue;
    for (const key of keys) {
      if (out.length >= MAX) break;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }

  for (const key of FALLBACK_KEYS) {
    if (out.length >= MAX) break;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }

  return out.slice(0, MAX);
}
