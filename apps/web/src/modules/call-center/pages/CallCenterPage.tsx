import React from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Clock3, Headphones, History, ListFilter, PhoneCall, RefreshCw, Search, Settings2, Users, UserRoundCheck, CalendarClock, RotateCcw, LockKeyhole } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { workspaceApi, type Segment, type WorkspacePatient, type WorkspaceResponse } from "../api/workspaceApi";
import { PatientCallPanel } from "../components/PatientCallPanel";
import { WorkspaceSettingsPanel } from "../components/WorkspaceSettingsPanel";
import { ContactHistory } from "../components/ContactHistory";
import { formatContact, formatVisit, patientKey } from "../workspaceUtils";
import "../workspace.css";

const segments: { id: Segment; icon: typeof Users }[] = [
  { id: "today", icon: Check },
  { id: "base", icon: Users }, { id: "recall", icon: RotateCcw }, { id: "followup", icon: UserRoundCheck },
  { id: "reminder", icon: CalendarClock }, { id: "callbacks", icon: Clock3 }, { id: "archive", icon: History },
];
export const CallCenterPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin";
  const [tab, setTab] = React.useState<"workspace" | "history" | "settings">("workspace");
  const [segment, setSegment] = React.useState<Segment>("today");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [doctorId, setDoctorId] = React.useState("");
  const [operatorId, setOperatorId] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<WorkspaceResponse | null>(null);
  const [selected, setSelected] = React.useState<WorkspacePatient | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [navigationLocked, setNavigationLocked] = React.useState(false);
  const navigationLock = React.useRef(false);
  const pendingAdvance = React.useRef<{ excludeId: number; preferredId?: number } | null>(null);
  const lockNavigation = React.useCallback((locked: boolean) => { navigationLock.current = locked; setNavigationLocked(locked); }, []);
  React.useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    workspaceApi.list({ segment, search: debouncedSearch, page, status, doctorId, operatorId }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (pendingAdvance.current) {
          if (!result.items.length && page > 1) { setPage(page - 1); return; }
          const { excludeId, preferredId } = pendingAdvance.current;
          pendingAdvance.current = null;
          setSelected(result.items.find((item) => item.patientId === preferredId && item.patientId !== excludeId)
            ?? result.items.find((item) => item.patientId !== excludeId) ?? null);
          return;
        }
        setSelected((current) => current ? result.items.find((item) => patientKey(item) === patientKey(current)) ?? current : null);
      })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("callWorkspace.loadError")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [segment, debouncedSearch, page, status, doctorId, operatorId, revision, t]);
  React.useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const mayLeave = () => !navigationLock.current && (!dirty || window.confirm(t("callWorkspace.leaveDraft")));
  const switchTab = (next: typeof tab) => { if (next !== tab && mayLeave()) { pendingAdvance.current = null; setSelected(null); setDirty(false); setTab(next); } };
  const choose = (patient: WorkspacePatient | null) => { if (selected && patient && patientKey(selected) === patientKey(patient)) return; if (mayLeave()) { setDirty(false); setSelected(patient); setSuccess(false); } };
  const switchSegment = (next: Segment) => { if (next !== segment && mayLeave()) { pendingAdvance.current = null; setDirty(false); setSelected(null); setSegment(next); setStatus("all"); setPage(1); } };
  const saved = () => {
    const index = data?.items.findIndex((p) => selected && patientKey(p) === patientKey(selected)) ?? -1;
    if (selected) pendingAdvance.current = { excludeId: selected.patientId, preferredId: index >= 0 ? data?.items[index + 1]?.patientId : undefined };
    setSelected(null);
    setDirty(false); setSuccess(true); setRevision((r) => r + 1);
  };
  const selectedIndex = data?.items.findIndex((p) => selected && patientKey(p) === patientKey(selected)) ?? -1;
  const nextPatient = selectedIndex >= 0 ? data?.items[selectedIndex + 1] : undefined;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize || 30)));
  const next = () => {
    if (loading) return;
    if (nextPatient) { choose(nextPatient); return; }
    if (selected && page < pageCount && mayLeave()) {
      pendingAdvance.current = { excludeId: selected.patientId };
      setSelected(null); setDirty(false); setSuccess(false); setPage((current) => current + 1);
    }
  };
  const filterActive = Boolean(search || doctorId || operatorId || status !== "all");
  return <div className="cc-workspace">
    <header className="cc-header"><div className="cc-heading"><span className="cc-heading-icon"><Headphones size={24} /></span><div><h1>{t("callWorkspace.title")}</h1><p>{t("callWorkspace.subtitle")}</p></div></div><div className="cc-header-actions"><span className="cc-timezone"><Clock3 size={14} />{t("callWorkspace.timezoneShort")}</span><button type="button" className="cc-icon-btn" disabled={loading} onClick={() => setRevision((r) => r + 1)} aria-label={t("callWorkspace.refresh")}><RefreshCw size={17} className={loading ? "cc-spin" : ""} /></button></div></header>
    <nav className="cc-tabs" aria-label={t("callWorkspace.navigation")}>
      {([{ id: "workspace", icon: PhoneCall }, { id: "history", icon: History }, ...(isAdmin ? [{ id: "settings", icon: Settings2 }] : [])] as const).map(({ id, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "is-active" : ""} onClick={() => switchTab(id as typeof tab)}><Icon size={16} />{t("callWorkspace." + id)}</button>)}
      <span className="cc-tabs-caption">{t("callWorkspace.noAutoCalls")}</span>
    </nav>
    {success && <div className="cc-success" role="status"><Check size={17} />{t("callWorkspace.callSaved")}</div>}
    {error && <div className="cc-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRevision((r) => r + 1)}>{t("callWorkspace.retry")}</button></div>}
    {tab === "settings" ? data ? <WorkspaceSettingsPanel settings={data.settings} onDirty={setDirty} onSaved={(settings) => { setData((d) => d ? { ...d, settings } : d); setDirty(false); setRevision((r) => r + 1); }} /> : <div className="cc-empty" role="status">{t("callWorkspace.loading")}</div> : tab === "history" ? <div className="cc-history-page"><header className="cc-section-heading"><div><h2>{t("callWorkspace.history")}</h2><p>{t("callWorkspace.historyHint")}</p></div><History size={24} /></header><ContactHistory revision={revision} /></div> : <>
      <section className="cc-daily-progress" aria-label={t("callWorkspace.dailyProgress")}><div><strong>{t("callWorkspace.dailyProgress")}</strong><small>{t("callWorkspace.dailyClinicScope")}</small></div><dl><div><dt>{t("callWorkspace.dailyCompleted")}</dt><dd data-testid="daily-completed">{data?.dailyProgress.completed ?? "—"}</dd></div><div><dt>{t("callWorkspace.dailyPending")}</dt><dd data-testid="daily-pending">{data?.dailyProgress.pending ?? "—"}</dd></div></dl></section>
      <nav className="cc-segments" aria-label={t("callWorkspace.campaigns")}>{segments.map(({ id, icon: Icon }) => <button type="button" key={id} className={segment === id ? "is-active" : ""} aria-pressed={segment === id} onClick={() => switchSegment(id)}><span className="cc-segment-top"><Icon size={18} /><strong>{data?.counts[id] ?? "—"}</strong></span><span>{t(`callWorkspace.segments.${id}`)}</span><small>{t(`callWorkspace.segmentDescriptions.${id}`)}</small></button>)}</nav>
      <div className={"cc-desk" + (selected ? " has-selection" : "")}>
        <section className="cc-patient-list" aria-label={t(`callWorkspace.segments.${segment}`)}>
          <header className="cc-list-heading"><div><h2>{t(`callWorkspace.segments.${segment}`)}<span className="cc-count">{data?.total ?? "—"}</span></h2><p>{t(`callWorkspace.listHints.${segment}`)}</p></div><ListFilter size={18} /></header>
          <div className="cc-filters" data-reload-ignore><label className="cc-search"><Search size={17} /><span className="cc-sr-only">{t("callWorkspace.search")}</span><input type="search" placeholder={t("callWorkspace.search")} value={search} onChange={(e) => setSearch(e.target.value)} /></label><div className="cc-select-filters">
            <select aria-label={t("callWorkspace.status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">{t("callWorkspace.allStatuses")}</option>{["new", "callback", "overdue", "done"].map((s) => <option value={s} key={s}>{t(`callWorkspace.statuses.${s}`)}</option>)}</select>
            <select aria-label={t("callWorkspace.doctor")} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }}><option value="">{t("callWorkspace.allDoctors")}</option>{data?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select>
            <select aria-label={t("callWorkspace.operator")} value={operatorId} onChange={(e) => { setOperatorId(e.target.value); setPage(1); }}><option value="">{t("callWorkspace.allOperators")}</option>{data?.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select>
          </div></div>
          {loading ? <div className="cc-loading" role="status"><div className="cc-skeleton" /><div className="cc-skeleton" /><div className="cc-skeleton" /><p>{t("callWorkspace.loading")}</p></div> : error ? <div className="cc-empty"><p>{t("callWorkspace.retryLoad")}</p></div> : !data?.items.length ? <div className="cc-empty"><Users size={32} /><h3>{t(filterActive ? "callWorkspace.noMatches" : "callWorkspace.emptyTitle")}</h3><p>{t(filterActive ? "callWorkspace.noMatchesHint" : `callWorkspace.emptyHints.${segment}`)}</p>{filterActive ? <button className="cc-btn" onClick={() => { setSearch(""); setStatus("all"); setDoctorId(""); setOperatorId(""); setPage(1); }}>{t("callWorkspace.resetFilters")}</button> : segment !== "base" && <button className="cc-btn" onClick={() => switchSegment("base")}>{t("callWorkspace.openBase")}</button>}</div> : <div className="cc-table-scroll"><table className="cc-table"><thead><tr><th>{t("callWorkspace.patient")}</th><th>{t(segment === "reminder" ? "callWorkspace.nextVisit" : "callWorkspace.lastVisit")}</th><th>{t("callWorkspace.contact")}</th><th><span className="cc-sr-only">{t("callWorkspace.openPatient")}</span></th></tr></thead><tbody>{data.items.map((patient) => {
            const overdue = patient.status === "callback" && patient.dueAt && Date.parse(patient.dueAt) < Date.now();
            const locked = patient.claimedBy !== null && Date.parse(patient.claimExpiresAt || "") > Date.now();
            return <tr key={patientKey(patient)} className={selected && patientKey(selected) === patientKey(patient) ? "is-selected" : ""} onClick={() => choose(patient)}>
              <td><div className="cc-table-patient"><span className="cc-avatar">{patient.patientName.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("")}</span><div><button type="button" className="cc-patient-name" disabled={navigationLocked} onClick={(e) => { e.stopPropagation(); choose(patient); }}>{patient.patientName}</button><span className="cc-table-phone">{patient.phone || t("callWorkspace.noPhone")}</span><small className="cc-reason">{t(`callWorkspace.reasons.${patient.reason}`)}</small></div></div></td>
              <td><span className="cc-table-date">{formatVisit(segment === "reminder" ? patient.nextVisitAt : patient.lastVisitAt)}</span><small>{segment === "reminder" ? patient.nextDoctorName || "—" : patient.lastDoctorName || t("callWorkspace.noCompletedVisits")}</small></td>
              <td><span className={"cc-status cc-status-" + (overdue ? "overdue" : patient.status)}>{t(`callWorkspace.statuses.${overdue ? "overdue" : patient.status}`)}</span><small>{locked ? <><LockKeyhole size={11} />{patient.claimedByName}</> : patient.dueAt ? formatContact(patient.dueAt, i18n.language) : patient.lastContactAt ? formatContact(patient.lastContactAt, i18n.language) : t("callWorkspace.noContact")}</small>{patient.contactBlockReason && <small className="cc-contact-block"><LockKeyhole size={11} />{t(`callWorkspace.contactBlocks.${patient.contactBlockReason}`)}</small>}</td>
              <td><ChevronRight size={16} /></td>
            </tr>;
          })}</tbody></table></div>}
          <footer className="cc-list-footer"><span>{t("callWorkspace.totalPatients", { count: data?.total ?? 0 })}</span><div className="cc-pagination"><button type="button" className="cc-icon-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label={t("callWorkspace.prev")}><ChevronLeft size={16} /></button><span>{page} / {pageCount}</span><button type="button" className="cc-icon-btn" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)} aria-label={t("callWorkspace.next")}><ChevronRight size={16} /></button></div></footer>
        </section>
        {selected && data ? <PatientCallPanel key={patientKey(selected)} patient={selected} settings={data.settings} operators={data.operators} userId={user?.id ?? 0} isAdmin={isAdmin} onClose={() => choose(null)} onSaved={saved} onDirty={setDirty} onNavigationLock={lockNavigation} onNext={next} hasNext={(Boolean(nextPatient) || page < pageCount) && !loading} onPreferencesSaved={(contactPreferences) => {
          setSelected((current) => current?.patientId === selected.patientId ? { ...current, contactPreferences } : current);
          setRevision((r) => r + 1);
        }} /> : <aside className="cc-desk-guide"><div className="cc-guide-mark"><PhoneCall size={34} /></div><h2>{t("callWorkspace.guideTitle")}</h2><p>{t("callWorkspace.guideHint")}</p><ol><li><Users size={17} /><span>{t("callWorkspace.guidePick")}</span></li><li><PhoneCall size={17} /><span>{t("callWorkspace.guideCall")}</span></li><li><Check size={17} /><span>{t("callWorkspace.guideSave")}</span></li></ol><div className="cc-guide-note"><LockKeyhole size={16} /><span>{t("callWorkspace.guideLock")}</span></div></aside>}
      </div>
    </>}
  </div>;
};
