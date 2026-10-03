import React from "react";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HttpError } from "../../../api/http";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { leadsApi } from "../api/leadsApi";
import type { MyLead } from "../api/leadsTypes";
import { LEAD_STAGE_LABEL_KEYS, formatLeadPhone, leadStageBadgeClass } from "../utils/leadFormat";

/** Columns from xl up: received, name, phone, source, stage. Narrower (the sidebar takes 260px from md) a row is a two-column card. */
const ROW_COLUMNS = "gap-x-4 px-4 xl:grid-cols-[8rem_minmax(0,1.2fr)_10rem_minmax(0,1fr)_9rem] xl:items-center";
const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

/**
 * The API's text of a failure, or "" when there is none to show. A 402 is about the clinic's subscription, which an
 * external account is not told about: the layout covers the page with its neutral block.
 */
const failureText = (requestError: unknown): string =>
  requestError instanceof HttpError && requestError.status === 402
    ? ""
    : requestError instanceof Error
      ? requestError.message
      : "";

/**
 * «Мои лиды»: the external contractor's only page. Leads of the sources bound to the account, newest first, with what
 * became of each. Read-only: one endpoint (/api/leads/mine), no links to staff pages, no actions on a row.
 */
export const MyLeadsPage: React.FC = () => {
  const { t } = useTranslation();
  const [items, setItems] = React.useState<MyLead[]>([]);
  const [nextBeforeId, setNextBeforeId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  /** null — loaded; a text (may be empty) — the list could not be loaded. */
  const [error, setError] = React.useState<string | null>(null);
  const [moreError, setMoreError] = React.useState<string | null>(null);
  // Number of the latest list request: an answer to an older one (unmounted page) is dropped.
  const requestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const page = await leadsApi.mine();
      if (request !== requestRef.current) return;
      setItems(page.items);
      setNextBeforeId(page.nextBeforeId);
    } catch (requestError) {
      if (request !== requestRef.current) return;
      // A failure is never shown as «no leads yet».
      setItems([]);
      setNextBeforeId(null);
      setError(failureText(requestError));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const loadMore = async () => {
    if (nextBeforeId === null || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await leadsApi.mine({ beforeId: nextBeforeId });
      // The list was reloaded meanwhile: this page belongs to the old one.
      if (request !== requestRef.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextBeforeId(page.nextBeforeId);
    } catch (requestError) {
      if (request !== requestRef.current) return;
      setMoreError(failureText(requestError) || t("leads.errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page-enter space-y-5 p-4 md:p-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("pages.myLeads")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("leads.mine.subtitle")}</p>
      </header>

      {error !== null ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          <span>
            {t("leads.errors.loadFailed")}
            {error ? `: ${error}` : ""}
          </span>
          <button type="button" onClick={() => void load()} className={secondaryButton}>
            {t("leads.actions.retry")}
          </button>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <ListEmptyState icon={Target} title={t("leads.mine.empty")} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-busy={loading}>
          <div
            className={`${ROW_COLUMNS} hidden border-b border-slate-100 bg-slate-50 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 xl:grid`}
            aria-hidden
          >
            <span>{t("leads.columns.received")}</span>
            <span>{t("leads.columns.name")}</span>
            <span>{t("leads.columns.phone")}</span>
            <span>{t("leads.columns.source")}</span>
            <span>{t("leads.columns.status")}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((lead) => (
              <li key={lead.id} className={`${ROW_COLUMNS} grid grid-cols-2 gap-y-1.5 py-3`}>
                <span data-cell="received" className="order-1 text-xs tabular-nums text-slate-500 xl:order-none">
                  {formatDateTimeRu(lead.receivedAt)}
                </span>
                <span
                  data-cell="name"
                  className={`order-3 col-span-2 truncate text-sm font-semibold xl:order-none xl:col-span-1 ${
                    lead.fullName ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {lead.fullName ?? t("leads.noName")}
                </span>
                <span data-cell="phone" className="order-4 text-sm font-medium tabular-nums text-slate-700 xl:order-none">
                  {formatLeadPhone(lead.phone)}
                </span>
                <span
                  data-cell="source"
                  className="order-5 truncate text-right text-sm text-slate-600 xl:order-none xl:text-left"
                >
                  {lead.sourceName}
                </span>
                <span data-cell="stage" className="order-2 justify-self-end xl:order-none xl:justify-self-start">
                  <span className={leadStageBadgeClass(lead.stage)}>{t(LEAD_STAGE_LABEL_KEYS[lead.stage])}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {moreError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {moreError}
        </div>
      ) : null}

      {nextBeforeId !== null && items.length > 0 ? (
        <div className="flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={secondaryButton}>
            {t("leads.actions.showMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
};
