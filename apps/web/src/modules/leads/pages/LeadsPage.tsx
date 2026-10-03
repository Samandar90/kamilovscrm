import React from "react";
import { ChevronDown, Megaphone, RefreshCw, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HttpError } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import { LEADS_UPDATE_ROLES, LEAD_SOURCES_MANAGE_ROLES } from "../../../auth/roleGroups";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { leadsApi } from "../api/leadsApi";
import type { Lead, LeadSourceBrief, LeadStage, LeadsListParams } from "../api/leadsTypes";
import { LeadDetails } from "../components/LeadDetails";
import { LeadSourcesPanel } from "../components/LeadSourcesPanel";
import { LEAD_STAGES, LEAD_STAGE_LABEL_KEYS, formatLeadPhone, leadStageBadgeClass } from "../utils/leadFormat";

/**
 * Columns from xl up: received, name, phone, source, stage, actions. Narrower (the sidebar takes 260px from md) a row
 * is a two-column card.
 */
const ROW_COLUMNS =
  "gap-x-4 px-4 xl:grid-cols-[6rem_minmax(0,1.2fr)_9rem_minmax(0,1fr)_8.5rem_11.5rem] xl:items-center";
const filterSelect =
  "mt-1 block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/25 md:w-56";
const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

/**
 * Staff «Лиды» page: requests read from the contractors' sheets, newest first. Operator, reception and manager call
 * the lead, set the result and link a patient; a role without the update right only reads. The superadmin also gets
 * the sources panel: contractors' sheets and their reading.
 */
export const LeadsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canUpdate = !!user && LEADS_UPDATE_ROLES.includes(user.role);
  const canManageSources = !!user && LEAD_SOURCES_MANAGE_ROLES.includes(user.role);

  const [stage, setStage] = React.useState<LeadStage | "">("");
  const [sourceId, setSourceId] = React.useState<number | null>(null);
  const [sources, setSources] = React.useState<LeadSourceBrief[]>([]);
  const [items, setItems] = React.useState<Lead[]>([]);
  const [nextBeforeId, setNextBeforeId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [pendingId, setPendingId] = React.useState<number | null>(null);
  const [showSources, setShowSources] = React.useState(false);
  // Synchronous twin of `pendingId`: a second click can arrive before React re-renders the disabled buttons.
  const pendingRef = React.useRef(false);
  // Number of the latest list request: an answer to an older one (previous filter, unmounted page) is dropped.
  const requestRef = React.useRef(0);
  const sourcesRequestRef = React.useRef(0);

  const filters = React.useMemo<LeadsListParams>(
    () => ({ ...(stage ? { stage } : {}), ...(sourceId ? { sourceId } : {}) }),
    [stage, sourceId]
  );
  const filtered = stage !== "" || sourceId !== null;

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await leadsApi.list(filters);
      if (request !== requestRef.current) return;
      setItems(page.items);
      setNextBeforeId(page.nextBeforeId);
    } catch (requestError) {
      if (request !== requestRef.current) return;
      // A failure is never shown as «no leads»: the rows of the previous filter go away too.
      setItems([]);
      setNextBeforeId(null);
      setError(requestError instanceof Error ? requestError.message : "");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filters]);

  React.useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const loadSources = React.useCallback(() => {
    const request = ++sourcesRequestRef.current;
    // Sources only feed the filter: their failure must not hide the leads (each lead carries its source name).
    leadsApi
      .sources()
      .then((result) => {
        if (request === sourcesRequestRef.current) setSources(result.items);
      })
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    loadSources();
    return () => {
      sourcesRequestRef.current += 1;
    };
  }, [loadSources]);

  const reload = () => {
    setActionError(null);
    void load();
  };

  const loadMore = async () => {
    if (nextBeforeId === null || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await leadsApi.list({ ...filters, beforeId: nextBeforeId });
      // The list was reloaded meanwhile: this page belongs to the old one.
      if (request !== requestRef.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextBeforeId(page.nextBeforeId);
    } catch (requestError) {
      if (request !== requestRef.current) return;
      setActionError(requestError instanceof Error ? requestError.message : t("leads.errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const replace = (updated: Lead) => setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));

  const take = async (lead: Lead) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingId(lead.id);
    setActionError(null);
    try {
      replace(await leadsApi.update(lead.id, { status: "in_progress", expectedStatus: "new" }));
    } catch (requestError) {
      if (requestError instanceof HttpError && requestError.status === 409) {
        // A colleague was faster: reload to show the lead as it is now instead of a stale «Новый».
        setActionError(t("leads.errors.alreadyTaken"));
        void load();
      } else {
        setActionError(requestError instanceof Error ? requestError.message : t("leads.errors.saveFailed"));
      }
    } finally {
      pendingRef.current = false;
      setPendingId(null);
    }
  };

  const conflict = () => {
    setActionError(t("leads.errors.changedByColleague"));
    void load();
  };

  // The sources panel saved a source or read a sheet: the filter and the list behind it are out of date.
  const sourcesChanged = () => {
    loadSources();
    void load();
  };

  return (
    <div className="page-enter space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("leads.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("leads.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManageSources ? (
            <button
              type="button"
              onClick={() => setShowSources((value) => !value)}
              aria-expanded={showSources}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <Table2 className="h-4 w-4" aria-hidden />
              {t("leads.sources.open")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={reload}
            aria-label={t("common.actions.refresh")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      {showSources && canManageSources ? (
        <LeadSourcesPanel onClose={() => setShowSources(false)} onChanged={sourcesChanged} />
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row">
        <label className="block text-xs font-medium text-slate-600" htmlFor="leads-filter-stage">
          {t("leads.filters.status")}
          <select
            id="leads-filter-stage"
            value={stage}
            onChange={(event) => {
              setActionError(null);
              setStage(event.target.value as LeadStage | "");
            }}
            className={filterSelect}
          >
            <option value="">{t("leads.filters.allStatuses")}</option>
            {LEAD_STAGES.map((value) => (
              <option key={value} value={value}>
                {t(LEAD_STAGE_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600" htmlFor="leads-filter-source">
          {t("leads.filters.source")}
          <select
            id="leads-filter-source"
            value={sourceId ?? ""}
            onChange={(event) => {
              const value = Number(event.target.value);
              setActionError(null);
              setSourceId(Number.isInteger(value) && value > 0 ? value : null);
            }}
            className={filterSelect}
          >
            <option value="">{t("leads.filters.allSources")}</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {actionError}
        </div>
      ) : null}

      {error !== null ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          <span>
            {t("leads.errors.loadFailed")}
            {error ? `: ${error}` : ""}
          </span>
          <button type="button" onClick={reload} className={secondaryButton}>
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
        <ListEmptyState
          icon={Megaphone}
          title={filtered ? t("leads.empty.filteredTitle") : t("leads.empty.title")}
          description={filtered ? t("leads.empty.filteredDescription") : t("leads.empty.description")}
        />
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
            <span />
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((lead) => {
              const expanded = expandedId === lead.id;
              return (
                <li key={lead.id}>
                  <div className={`${ROW_COLUMNS} grid grid-cols-2 gap-y-1.5 py-3`}>
                    <span className="order-1 text-xs tabular-nums text-slate-500 xl:order-none">
                      {formatDateTimeRu(lead.createdAt)}
                    </span>
                    <span
                      data-cell="name"
                      className={`order-3 col-span-2 truncate text-sm font-semibold xl:order-none xl:col-span-1 ${
                        lead.fullName ? "text-slate-900" : "text-slate-400"
                      }`}
                    >
                      {lead.fullName ?? t("leads.noName")}
                    </span>
                    <a
                      href={`tel:+${lead.phone}`}
                      className="order-4 text-sm font-medium tabular-nums text-emerald-700 hover:underline xl:order-none"
                    >
                      {formatLeadPhone(lead.phone)}
                    </a>
                    <span className="order-5 truncate text-right text-sm text-slate-600 xl:order-none xl:text-left">
                      {lead.sourceName}
                    </span>
                    <span className="order-2 justify-self-end xl:order-none xl:justify-self-start">
                      <span className={leadStageBadgeClass(lead.stage)}>{t(LEAD_STAGE_LABEL_KEYS[lead.stage])}</span>
                    </span>
                    <div className="order-6 col-span-2 flex flex-wrap gap-2 xl:order-none xl:col-span-1 xl:flex-nowrap xl:justify-end">
                      {canUpdate && lead.status === "new" ? (
                        <button
                          type="button"
                          data-action="take"
                          onClick={() => void take(lead)}
                          disabled={pendingId !== null}
                          className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {t("leads.actions.take")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : lead.id)}
                        aria-expanded={expanded}
                        aria-controls={`lead-details-${lead.id}`}
                        className={secondaryButton}
                      >
                        <span className="xl:sr-only">{t("leads.actions.details")}</span>
                        <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div id={`lead-details-${lead.id}`}>
                      <LeadDetails lead={lead} onChange={replace} onConflict={conflict} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
