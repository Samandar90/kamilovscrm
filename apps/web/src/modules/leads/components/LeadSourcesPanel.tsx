import React from "react";
import { FileSearch, Pencil, Plus, RefreshCw, Table2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import { leadsApi } from "../api/leadsApi";
import type { LeadMarketerOption, LeadSheetCheck, LeadSource, LeadSyncResult, LeadSyncStatus } from "../api/leadsTypes";
import { LeadSourceFormModal } from "./LeadSourceFormModal";

/** Texts of the sheet read statuses: i18n keys. String literals only — scripts/check-i18n.cjs checks nothing else. */
export const LEAD_SYNC_STATUS_KEYS: Record<LeadSyncStatus, string> = {
  ok: "leads.sources.status.ok",
  empty: "leads.sources.status.empty",
  no_access: "leads.sources.status.noAccess",
  not_found: "leads.sources.status.notFound",
  columns_not_found: "leads.sources.status.columnsNotFound",
  too_large: "leads.sources.status.tooLarge",
  timeout: "leads.sources.status.timeout",
  http_error: "leads.sources.status.httpError",
};

/** The last «Проверить таблицу» or «Прочитать сейчас» answer, shown in the row of its source. */
type Report =
  | { sourceId: number; kind: "check"; check: LeadSheetCheck }
  | { sourceId: number; kind: "sync"; sync: LeadSyncResult };

const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const chip = "rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600";
const columnSelect =
  "mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/25 disabled:opacity-60 sm:w-52";

/** A sheet without rows yet is not a failure; every other status than `ok` needs the superadmin's attention. */
const reportTone = (status: LeadSyncStatus): string =>
  status === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status === "empty"
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : "border-amber-200 bg-amber-50 text-amber-900";

type Props = {
  onClose: () => void;
  /** A source was saved or a read added leads: the page behind the panel reloads its filter and its list. */
  onChanged: () => void;
};

/**
 * Superadmin panel on the «Лиды» page: lead sources, the contractor each one belongs to, the Google sheet it is read
 * from, the sheet check with the column choice, the reading switch and «Прочитать сейчас».
 */
export function LeadSourcesPanel({ onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const [sources, setSources] = React.useState<LeadSource[]>([]);
  const [marketers, setMarketers] = React.useState<LeadMarketerOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  /** null — loaded; a text (may be empty) — the list could not be loaded. */
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ source: LeadSource | null } | null>(null);
  /** The row action in flight; one at a time for the whole panel. */
  const [pending, setPending] = React.useState<{ sourceId: number; reading: boolean } | null>(null);
  // Synchronous twin of `pending`: a second click can arrive before React re-renders the disabled buttons.
  const pendingRef = React.useRef(false);
  const [report, setReport] = React.useState<Report | null>(null);
  /** The column pickers of the shown check; "" — not chosen / no name column. */
  const [columns, setColumns] = React.useState({ phone: "", name: "" });
  // Number of the latest list request: an answer to an older one (unmounted panel) is dropped.
  const requestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await leadsApi.sourcesManage();
      if (request !== requestRef.current) return;
      setSources(result.items);
      setMarketers(result.marketers);
      setLoadError(null);
    } catch (requestError) {
      if (request !== requestRef.current) return;
      // A failure is never shown as «no sources yet».
      setLoadError(requestError instanceof Error ? requestError.message : "");
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

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const statusText = (status: LeadSyncStatus): string => {
    const key = LEAD_SYNC_STATUS_KEYS[status];
    return key ? t(key) : status;
  };

  const replace = (updated: LeadSource) =>
    setSources((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));

  const run = async (source: LeadSource, operation: () => Promise<void>, reading = false) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending({ sourceId: source.id, reading });
    setError(null);
    try {
      await operation();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("leads.sources.actionFailed"));
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  const showCheck = (sourceId: number, check: LeadSheetCheck) => {
    setReport({ sourceId, kind: "check", check });
    setColumns({ phone: check.detected.phone ?? "", name: check.detected.name ?? "" });
  };

  const toggleSync = (source: LeadSource) =>
    run(source, async () => {
      replace(await leadsApi.updateSource(source.id, { syncEnabled: !source.syncEnabled }));
    });

  const check = (source: LeadSource) =>
    run(source, async () => {
      showCheck(source.id, await leadsApi.checkSource(source.id));
    });

  const saveColumns = (source: LeadSource) =>
    run(source, async () => {
      replace(await leadsApi.updateSource(source.id, { columnMap: { phone: columns.phone, name: columns.name || null } }));
      // The shown check was made with the old columns: read the sheet again with the chosen ones.
      setReport(null);
      showCheck(source.id, await leadsApi.checkSource(source.id));
    });

  const syncNow = (source: LeadSource) =>
    run(source, async () => {
      const sync = await leadsApi.syncSource(source.id);
      setReport({ sourceId: source.id, kind: "sync", sync });
      // The answer has only the counts; the row (time, status, leads) comes with the list. If the list fails now, the
      // rows stay as they were.
      try {
        const fresh = await leadsApi.sourcesManage();
        setSources(fresh.items);
        setMarketers(fresh.marketers);
      } catch {
        // Nothing to add: the read itself is already reported above.
      }
      if (sync.added > 0) onChanged();
    }, true);

  const busy = pending !== null;

  const renderCheck = (source: LeadSource, result: LeadSheetCheck) => {
    const canPick = result.headers.length > 0 && (result.status === "ok" || result.status === "columns_not_found");
    const unchanged =
      result.status === "ok" &&
      columns.phone === (result.detected.phone ?? "") &&
      columns.name === (result.detected.name ?? "");
    return (
      <div data-report="check" className={`mt-3 space-y-2 rounded-xl border px-3 py-3 text-sm ${reportTone(result.status)}`}>
        <p className="font-semibold" role="status">
          {t("leads.sources.checkResult", { status: statusText(result.status) })}
        </p>
        {result.status === "ok" ? (
          <p>{t("leads.sources.checkCounts", { rows: result.rows, valid: result.valid, skipped: result.skipped })}</p>
        ) : null}
        {result.headers.length > 0 ? <p>{t("leads.sources.headers", { list: result.headers.join(", ") })}</p> : null}
        {canPick ? (
          <>
            <p>
              {t("leads.sources.detected", {
                phone: result.detected.phone ?? t("leads.sources.columnMissing"),
                name: result.detected.name ?? t("leads.sources.columnMissing"),
              })}
            </p>
            <div className="flex flex-wrap items-end gap-3 text-slate-700">
              <label className="block text-xs font-medium" htmlFor={`lead-source-${source.id}-phone-column`}>
                {t("leads.sources.phoneColumn")}
                <select
                  id={`lead-source-${source.id}-phone-column`}
                  value={columns.phone}
                  onChange={(event) => {
                    const phone = event.target.value;
                    // One header cannot be both columns.
                    setColumns((prev) => ({ phone, name: prev.name === phone ? "" : prev.name }));
                  }}
                  disabled={busy}
                  className={columnSelect}
                >
                  <option value="">{t("leads.sources.choosePhoneColumn")}</option>
                  {result.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium" htmlFor={`lead-source-${source.id}-name-column`}>
                {t("leads.sources.nameColumn")}
                <select
                  id={`lead-source-${source.id}-name-column`}
                  value={columns.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setColumns((prev) => ({ ...prev, name }));
                  }}
                  disabled={busy}
                  className={columnSelect}
                >
                  <option value="">{t("leads.sources.noNameColumn")}</option>
                  {result.headers
                    .filter((header) => header !== columns.phone)
                    .map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                data-action="save-columns"
                onClick={() => void saveColumns(source)}
                disabled={busy || columns.phone === "" || unchanged}
                className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("leads.sources.saveColumns")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  };

  const renderSync = (result: LeadSyncResult) => (
    <p
      data-report="sync"
      role="status"
      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${reportTone(result.status)}`}
    >
      {result.status === "ok"
        ? t("leads.sources.syncDone", { added: result.added, duplicates: result.duplicates, skipped: result.skipped })
        : statusText(result.status)}
    </p>
  );

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
      aria-labelledby="lead-sources-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Table2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="lead-sources-title" className="text-base font-semibold text-slate-900">
              {t("leads.sources.title")}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{t("leads.sources.subtitle")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditor({ source: null })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("leads.sources.add")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {loadError !== null ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          <span>
            {t("leads.sources.loadFailed")}
            {loadError ? `: ${loadError}` : ""}
          </span>
          <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButton}>
            {t("leads.actions.retry")}
          </button>
        </div>
      ) : loading && sources.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {t("leads.sources.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {sources.map((source) => {
            const hasSheet = source.sheetUrl !== null;
            const failed = source.lastSyncStatus !== null && source.lastSyncStatus !== "ok" && source.lastSyncStatus !== "empty";
            return (
              <li key={source.id} className="px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{source.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t("leads.sources.marketer", {
                        name:
                          source.marketerUserId === null
                            ? t("leads.sources.notBound")
                            : source.marketerName ?? `#${source.marketerUserId}`,
                      })}
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                      <span className={chip}>{hasSheet ? t("leads.sources.sheetOn") : t("leads.sources.sheetOff")}</span>
                      <span className={chip}>{source.syncEnabled ? t("leads.sources.syncOn") : t("leads.sources.syncOff")}</span>
                      <span className={chip}>{t("leads.sources.leadsCount", { total: source.leadsCount })}</span>
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {source.lastSyncAt === null ? (
                        t("leads.sources.neverSynced")
                      ) : (
                        <>
                          {t("leads.sources.lastSync", { time: formatDateTimeRu(source.lastSyncAt) })}
                          {source.lastSyncStatus !== null ? (
                            <>
                              {" — "}
                              <span className={failed ? "font-semibold text-rose-700" : undefined}>
                                {statusText(source.lastSyncStatus)}
                              </span>
                            </>
                          ) : null}
                          {source.lastSyncRows !== null
                            ? ` · ${t("leads.sources.counts", { rows: source.lastSyncRows, skipped: source.lastSyncSkipped ?? 0 })}`
                            : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <label className="inline-flex h-9 items-center gap-2 pr-1 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-checked={source.syncEnabled}
                        className="h-4 w-4 accent-emerald-600"
                        checked={source.syncEnabled}
                        onChange={() => void toggleSync(source)}
                        disabled={!hasSheet || busy}
                      />
                      {t("leads.sources.syncSwitch")}
                    </label>
                    <button type="button" onClick={() => setEditor({ source })} disabled={busy} className={secondaryButton}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      {t("leads.sources.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void check(source)}
                      disabled={!hasSheet || busy}
                      className={secondaryButton}
                    >
                      <FileSearch className="h-4 w-4" aria-hidden />
                      {t("leads.sources.check")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void syncNow(source)}
                      disabled={!hasSheet || busy}
                      className={secondaryButton}
                    >
                      <RefreshCw className={`h-4 w-4 ${pending?.reading && pending.sourceId === source.id ? "animate-spin" : ""}`} aria-hidden />
                      {t("leads.sources.syncNow")}
                    </button>
                  </div>
                </div>
                {report?.sourceId === source.id
                  ? report.kind === "check"
                    ? renderCheck(source, report.check)
                    : renderSync(report.sync)
                  : null}
              </li>
            );
          })}
        </ul>
      )}

      {editor ? (
        <LeadSourceFormModal
          source={editor.source}
          marketers={marketers}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            setSources((prev) =>
              prev.some((row) => row.id === saved.id)
                ? prev.map((row) => (row.id === saved.id ? saved : row))
                : [...prev, saved]
            );
            // Another sheet may be behind the source now: the shown check or read is no longer about it.
            setReport((current) => (current?.sourceId === saved.id ? null : current));
            setNotice(t("leads.sources.saved"));
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
