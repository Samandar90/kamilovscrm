import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarPlus, Check, ChevronRight, Clock3, LockKeyhole, Phone, PhoneCall, X } from "lucide-react";
import { workspaceApi, type ContactPreferences, type NamedOption, type Outcome, type WorkspacePatient, type WorkspaceSettings } from "../api/workspaceApi";
import { clinicInputToIso, formatContact, formatVisit, renderCallScript, safePhoneHref } from "../workspaceUtils";
import { ContactHistory } from "./ContactHistory";
import { HttpError } from "../../../api/http";

export function PatientCallPanel({ patient, settings, operators, userId, isAdmin, onClose, onSaved, onDirty, onNext, hasNext, onNavigationLock, onPreferencesSaved }: {
  patient: WorkspacePatient; settings: WorkspaceSettings; operators: NamedOption[];
  userId: number; isAdmin: boolean; onClose: () => void; onSaved: () => void; onDirty: (dirty: boolean) => void;
  onNext?: () => void; hasNext?: boolean; onNavigationLock?: (locked: boolean) => void;
  onPreferencesSaved?: (preferences: ContactPreferences) => void;
}) {
  const { t, i18n } = useTranslation();
  const [taskId, setTaskId] = React.useState<number | null>(null);
  const [leaseUntil, setLeaseUntil] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome>("contacted");
  const [note, setNote] = React.useState("");
  const [callback, setCallback] = React.useState("");
  const [error, setError] = React.useState("");
  const [assignedTo, setAssignedTo] = React.useState(patient.assignedTo == null ? "" : String(patient.assignedTo));
  const [assignedSaved, setAssignedSaved] = React.useState(false);
  const [preferences, setPreferences] = React.useState(patient.contactPreferences);
  const [savedPreferences, setSavedPreferences] = React.useState(patient.contactPreferences);
  const [preferencesSaved, setPreferencesSaved] = React.useState(false);
  const preferencesDirty = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
  const mounted = React.useRef(true);
  const hasLease = React.useRef(false);
  const leaseTaskId = React.useRef<number | undefined>(undefined);
  const pendingAttempt = React.useRef<Parameters<typeof workspaceApi.attempt>[0] | null>(null);
  const [retryPending, setRetryPending] = React.useState(false);
  const isOwned = taskId !== null && leaseUntil > now;
  const occupied = patient.claimedBy !== null && patient.claimedBy !== userId && Date.parse(patient.claimExpiresAt || "") > now;
  const phoneHref = safePhoneHref(patient.phone);
  // Unsaved preferences must not allow a new call before the server has checked them.
  const contactBlockReason = savedPreferences.doNotCall || preferences.doNotCall ? "do_not_call" : patient.contactBlockReason;
  const callBlocked = Boolean(contactBlockReason || !phoneHref || preferencesDirty);
  React.useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      mounted.current = false; window.clearInterval(timer);
      if (hasLease.current) void workspaceApi.release(patient.patientId, leaseTaskId.current).catch(() => {});
      onDirty(false);
    };
  }, [patient.patientId, onDirty]);
  React.useEffect(() => { onDirty(Boolean(note.trim() || callback || taskId !== null || preferencesDirty || busy || retryPending)); }, [note, callback, taskId, preferencesDirty, busy, retryPending, onDirty]);
  React.useEffect(() => { onNavigationLock?.(busy || retryPending); return () => onNavigationLock?.(false); }, [busy, retryPending, onNavigationLock]);
  React.useEffect(() => {
    if (!preferencesDirty && !busy) { setPreferences(patient.contactPreferences); setSavedPreferences(patient.contactPreferences); }
  }, [patient.contactPreferences]);
  const claim = async () => {
    if (busy || occupied || callBlocked || retryPending) return;
    setBusy(true); setError("");
    try {
      const result = await workspaceApi.claim(patient);
      if (!mounted.current) { void workspaceApi.release(patient.patientId, result.taskId).catch(() => {}); return; }
      leaseTaskId.current = result.taskId;
      hasLease.current = true; setTaskId(result.taskId); setLeaseUntil(Date.now() + 10 * 60_000); setNow(Date.now());
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t("callWorkspace.claimError")); }
    finally { if (mounted.current) setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (taskId === null || busy || (!retryPending && preferencesDirty)) return;
    const callbackAt = outcome === "callback" ? clinicInputToIso(callback) : null;
    if (!pendingAttempt.current && outcome === "callback" && (!callbackAt || Date.parse(callbackAt) <= Date.now())) { setError(t("callWorkspace.futureCallback")); return; }
    setBusy(true); setError("");
    if (!pendingAttempt.current) pendingAttempt.current = { taskId, outcome, note: note.trim() || null, callbackAt, requestId: crypto.randomUUID() };
    try {
      await workspaceApi.attempt(pendingAttempt.current);
      hasLease.current = false; pendingAttempt.current = null;
      if (mounted.current) { setRetryPending(false); onDirty(false); onSaved(); }
    } catch (e) {
      if (!mounted.current) return;
      const rejected = e instanceof HttpError && e.status < 500;
      if (rejected) {
        pendingAttempt.current = null;
        if (e.status === 409) { setTaskId(null); setLeaseUntil(0); }
      }
      setRetryPending(!rejected);
      setError(e instanceof Error ? e.message : t("callWorkspace.saveError"));
    }
    finally { if (mounted.current) setBusy(false); }
  };
  const assign = async () => {
    if (busy || retryPending || (patient.taskId === null && taskId === null && callBlocked)) return;
    setBusy(true); setError(""); setAssignedSaved(false);
    let temporaryTask: number | undefined;
    try {
      let id = taskId ?? patient.taskId;
      if (id === null) { id = (await workspaceApi.claim(patient)).taskId; temporaryTask = id; }
      await workspaceApi.assign(id, assignedTo === "" ? null : Number(assignedTo));
      if (mounted.current) setAssignedSaved(true);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t("callWorkspace.saveError")); }
    finally {
      if (temporaryTask !== undefined) await workspaceApi.release(patient.patientId, temporaryTask).catch(() => {});
      if (mounted.current) setBusy(false);
    }
  };
  const changePreferences = <K extends keyof ContactPreferences>(key: K, value: ContactPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value })); setPreferencesSaved(false);
  };
  const savePreferences = async () => {
    if (busy || retryPending) return;
    const { preferredCallStart: start, preferredCallEnd: end } = preferences;
    const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    if ((start === null) !== (end === null) || (start !== null && end !== null && (!validTime(start) || !validTime(end) || start >= end))) {
      setError(t("callWorkspace.invalidPreferredHours")); return;
    }
    setBusy(true); setError(""); setPreferencesSaved(false);
    try {
      const value = await workspaceApi.savePreferences(patient.patientId, preferences);
      if (!mounted.current) return;
      setPreferences(value); setSavedPreferences(value); setPreferencesSaved(true); onPreferencesSaved?.(value);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t("callWorkspace.saveError")); }
    finally { if (mounted.current) setBusy(false); }
  };
  const script = renderCallScript(settings.script, { patient: patient.patientName, doctor: patient.nextDoctorName || patient.lastDoctorName || "—", lastVisit: formatVisit(patient.lastVisitAt), nextVisit: formatVisit(patient.nextVisitAt) });
  const checkLeave = (event: React.MouseEvent) => { if (busy || retryPending || ((note || callback || taskId || preferencesDirty) && !window.confirm(t("callWorkspace.leaveDraft")))) event.preventDefault(); };
  return <aside className="cc-patient-panel" aria-label={t("callWorkspace.patientCard")}>
    <header className="cc-patient-header"><span className="cc-eyebrow">{t("callWorkspace.patientCard")} · #{patient.patientId}</span><button className="cc-icon-btn" type="button" onClick={onClose} disabled={busy || retryPending} aria-label={t("callWorkspace.close")}><X size={17} /></button></header>
    <div className="cc-patient-identity"><span className="cc-avatar cc-avatar-large">{patient.patientName.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("")}</span><h2>{patient.patientName}</h2><p className="cc-phone-number">{patient.phone || t("callWorkspace.noPhone")}</p></div>
    <div className="cc-visit-pair"><div><span>{t("callWorkspace.lastVisit")}</span><strong>{formatVisit(patient.lastVisitAt)}</strong><small>{patient.lastDoctorName || t("callWorkspace.noCompletedVisits")}</small></div><div><span>{t("callWorkspace.nextVisit")}</span><strong>{formatVisit(patient.nextVisitAt)}</strong><small>{patient.nextDoctorName || t("callWorkspace.noNextVisit")}</small></div></div>
    <p className="cc-patient-reason">{t(`callWorkspace.reasons.${patient.reason}`)}{patient.recommendedReturnDate && <span>{t("callWorkspace.returnDate")}: {patient.recommendedReturnDate.split("-").reverse().join(".")}</span>}</p>
    <div className="cc-booking-links"><Link className="cc-btn" to={`/appointments?patientId=${patient.patientId}`} onClick={checkLeave}><CalendarPlus size={15} />{t("callWorkspace.book")}</Link><Link to="/appointments" onClick={checkLeave}>{t("callWorkspace.schedule")}<ArrowUpRight size={14} /></Link></div><p className="cc-help cc-booking-help">{t("callWorkspace.bookingHint")}</p>
    <details className="cc-preferences"><summary>{t("callWorkspace.contactPreferences")}</summary>
      <fieldset disabled={busy || retryPending}>
        <label className="cc-preference-toggle"><input type="checkbox" aria-label={t("callWorkspace.doNotCall")} checked={preferences.doNotCall} onChange={(e) => changePreferences("doNotCall", e.target.checked)} />{t("callWorkspace.doNotCall")}</label>
        <label className="cc-field"><span>{t("callWorkspace.preferredLanguage")}</span><select aria-label={t("callWorkspace.preferredLanguage")} value={preferences.preferredLanguage ?? ""} onChange={(e) => changePreferences("preferredLanguage", (e.target.value || null) as ContactPreferences["preferredLanguage"])}><option value="">{t("callWorkspace.notSpecified")}</option><option value="ru">{t("callWorkspace.languages.ru")}</option><option value="uz">{t("callWorkspace.languages.uz")}</option></select></label>
        <div className="cc-form-grid">{(["preferredCallStart", "preferredCallEnd"] as const).map((key) => <label className="cc-field" key={key}><span>{t(`callWorkspace.${key}`)}</span><input type="time" aria-label={t(`callWorkspace.${key}`)} value={preferences[key] ?? ""} onChange={(e) => changePreferences(key, e.target.value || null)} /></label>)}</div>
        <p className="cc-help">{t("callWorkspace.preferredHoursHint")}</p>
        <button type="button" className="cc-btn" disabled={busy || retryPending || !preferencesDirty} onClick={() => void savePreferences()}>{busy ? t("callWorkspace.saving") : t("callWorkspace.savePreferences")}</button>
      </fieldset>
      {preferencesSaved && <p className="cc-help" role="status">{t("callWorkspace.preferencesSaved")}</p>}
    </details>
    <p className="cc-preference-summary">{t("callWorkspace.preferredLanguage")}: {savedPreferences.preferredLanguage ? t(`callWorkspace.languages.${savedPreferences.preferredLanguage}`) : t("callWorkspace.notSpecified")}{savedPreferences.preferredCallStart && <span>{savedPreferences.preferredCallStart}–{savedPreferences.preferredCallEnd} · {t("callWorkspace.timezoneShort")}</span>}</p>
    {isAdmin && <div className="cc-assignment"><label className="cc-field"><span>{t("callWorkspace.assignedTo")}</span><select value={assignedTo} disabled={busy || retryPending} onChange={(e) => { setAssignedTo(e.target.value); setAssignedSaved(false); }}><option value="">{t("callWorkspace.unassigned")}</option>{operators.map((operator) => <option value={operator.id} key={operator.id}>{operator.name}</option>)}</select></label><button type="button" className="cc-btn" disabled={busy || retryPending || (patient.taskId === null && taskId === null && callBlocked)} onClick={() => void assign()}>{assignedSaved ? <Check size={15} /> : t("callWorkspace.assign")}</button></div>}
    {error && <p className="cc-error" role="alert">{error}</p>}
    {occupied && !isOwned && <p className="cc-lock-note"><LockKeyhole size={16} />{t("callWorkspace.occupiedBy", { name: patient.claimedByName || "—" })}</p>}
    {contactBlockReason && <p className="cc-lock-note" role="status"><LockKeyhole size={16} />{t(`callWorkspace.contactBlocks.${contactBlockReason}`)}</p>}
    {preferencesDirty && <p className="cc-preference-summary">{t("callWorkspace.savePreferencesFirst")}</p>}
    {!isOwned && !retryPending ? <div className="cc-start-call"><button type="button" className="cc-btn cc-btn-primary" disabled={busy || occupied || callBlocked} onClick={() => void claim()}><PhoneCall size={17} />{busy ? t("callWorkspace.loading") : taskId ? t("callWorkspace.renewLease") : t("callWorkspace.startCall")}</button><p className="cc-help">{t("callWorkspace.claimHint")}</p></div> : <form onSubmit={(e) => void save(e)} className="cc-call-form">
      <div className="cc-call-active"><span><span className="cc-live-dot" />{t("callWorkspace.inProgress")}</span>{phoneHref && !callBlocked && !busy && !retryPending && <a className="cc-btn cc-btn-primary" href={phoneHref}><Phone size={15} />{t("callWorkspace.dial")}</a>}</div>
      <details className="cc-script" open><summary>{t("callWorkspace.script")}</summary><p>{script}</p></details>
      <fieldset disabled={busy || retryPending}><legend>{t("callWorkspace.result")}</legend><div className="cc-outcomes">{(["contacted", "confirmed", "no_answer", "callback", "declined", "wrong_number"] as Outcome[]).map((value) => <label className={outcome === value ? "is-selected" : ""} key={value}><input type="radio" name="callOutcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} /><span>{t(`callWorkspace.outcomes.${value}`)}</span></label>)}</div>
        {outcome === "callback" && <label className="cc-field"><span><Clock3 size={14} />{t("callWorkspace.callbackAt")}</span><input type="datetime-local" required value={callback} onChange={(e) => setCallback(e.target.value)} /><small>{t("callWorkspace.timezone")}</small></label>}
        {outcome === "no_answer" && <p className="cc-help">{t("callWorkspace.autoRetry", { minutes: settings.retryMinutes, max: settings.maxAttempts })}</p>}
        <label className="cc-field"><span>{t("callWorkspace.note")}</span><textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("callWorkspace.notePlaceholder")} /></label>
      </fieldset>
      {retryPending && <p className="cc-help">{t("callWorkspace.retrySaveHint")}</p>}
      <button type="submit" className="cc-btn cc-btn-primary cc-save-call" disabled={busy || (!retryPending && preferencesDirty)}><Check size={16} />{busy ? t("callWorkspace.saving") : retryPending ? t("callWorkspace.retrySave") : t("callWorkspace.saveNext")}</button>
    </form>}
    {onNext && <div className="cc-next-patient"><button type="button" className="cc-btn" onClick={onNext} disabled={busy || retryPending || !hasNext}>{t("callWorkspace.nextPatient")}<ChevronRight size={16} /></button><p className="cc-help">{t(hasNext ? "callWorkspace.nextPatientHint" : "callWorkspace.endOfPage")}</p></div>}
    {patient.dueAt && <p className="cc-callback-time"><Clock3 size={14} />{t("callWorkspace.callbackAt")}: {formatContact(patient.dueAt, i18n.language)}</p>}
    <ContactHistory patientId={patient.patientId} />
  </aside>;
}
