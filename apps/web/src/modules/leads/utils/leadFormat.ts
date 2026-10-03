import type { LeadStage, LeadStatus } from "../api/leadsTypes";

/** The API stores digits only. An Uzbek number is grouped for reading; any other is shown as is. */
export function formatLeadPhone(digits: string): string {
  const uz = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  return uz ? `+998 ${uz[1]} ${uz[2]} ${uz[3]} ${uz[4]}` : `+${digits}`;
}

/** Stage names: i18n keys. String literals only — scripts/check-i18n.cjs checks nothing else. */
export const LEAD_STAGE_LABEL_KEYS: Record<LeadStage, string> = {
  new: "leads.stage.new",
  in_progress: "leads.stage.inProgress",
  no_answer: "leads.stage.noAnswer",
  booked: "leads.stage.booked",
  visited: "leads.stage.visited",
  declined: "leads.stage.declined",
  invalid: "leads.stage.invalid",
};

/** Every stage in the order of the «Статус» filter: the way a lead moves, the dead ends last. */
export const LEAD_STAGES: LeadStage[] = ["new", "in_progress", "no_answer", "booked", "visited", "declined", "invalid"];

/** Statuses staff may set. `new` is set only by the sheet reader; `visited` is never stored. */
export const LEAD_STATUS_OPTIONS: LeadStatus[] = ["in_progress", "no_answer", "booked", "declined", "invalid"];

const STAGE_BADGE_TONES: Record<LeadStage, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200",
  no_answer: "bg-orange-50 text-orange-800 ring-orange-200",
  booked: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  visited: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-rose-50 text-rose-700 ring-rose-200",
  invalid: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function leadStageBadgeClass(stage: LeadStage): string {
  return `inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STAGE_BADGE_TONES[stage]}`;
}
