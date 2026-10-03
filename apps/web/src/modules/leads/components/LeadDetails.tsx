import React from "react";
import { CalendarPlus, Search, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HttpError } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import {
  LEADS_UPDATE_ROLES,
  canCreateAppointments,
  canCreatePatients,
  canReadPatients,
} from "../../../auth/roleGroups";
import { CreatePatientModal } from "../../appointments/components/CreatePatientModal";
import { leadsApi } from "../api/leadsApi";
import type { Lead, LeadPatch, LeadPatientMatch, LeadStatus } from "../api/leadsTypes";
import { LEAD_STAGE_LABEL_KEYS, LEAD_STATUS_OPTIONS } from "../utils/leadFormat";

type Props = {
  lead: Lead;
  /** The lead as the API returned it after a change. */
  onChange: (lead: Lead) => void;
  /** 409: a colleague changed the lead meanwhile; the page reloads the list. */
  onConflict: () => void;
};

const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-slate-500";
const field =
  "mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/25 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

/**
 * Expanded row of the «Лиды» page: the other sheet columns, the status and the note staff set, and the patient the
 * lead became. A lead never turns into a patient by itself: staff link one, or create one with the lead's name and
 * phone. A role without the update right gets the texts only.
 */
export function LeadDetails({ lead, onChange, onConflict }: Props) {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const role = user?.role;
  const canUpdate = !!role && LEADS_UPDATE_ROLES.includes(role);
  // The API asks for patient read on top of the leads right, both for the candidates and for the link.
  const canLinkPatient = canUpdate && canReadPatients(role);
  const canCreatePatient = canLinkPatient && canCreatePatients(role);
  const canBook = canCreateAppointments(role);

  const [status, setStatus] = React.useState<LeadStatus>(lead.status);
  const [note, setNote] = React.useState(lead.note ?? "");
  const [busy, setBusy] = React.useState(false);
  // Synchronous twin of `busy`: a second click can arrive before React re-renders the disabled buttons.
  const busyRef = React.useRef(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** null — not searched yet. */
  const [matches, setMatches] = React.useState<LeadPatientMatch[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // The saved lead comes back through the page: start the form again from what is stored. Each field follows only
  // its own stored value: a status set elsewhere («Взять в работу», a patient link) must not erase a typed note.
  React.useEffect(() => setStatus(lead.status), [lead.status]);
  React.useEffect(() => setNote(lead.note ?? ""), [lead.note]);

  const run = async (operation: () => Promise<void>, fallback: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await operation();
    } catch (requestError) {
      if (requestError instanceof HttpError && requestError.status === 409) onConflict();
      else setError(requestError instanceof Error ? requestError.message : fallback);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const noteValue = note.trim() || null;
  const statusChanged = status !== lead.status;
  const noteChanged = noteValue !== (lead.note?.trim() || null);

  const save = () =>
    run(async () => {
      const patch: LeadPatch = {};
      // expectedStatus: the API answers 409 instead of overwriting what a colleague has just set.
      if (statusChanged && status !== "new") {
        patch.status = status;
        patch.expectedStatus = lead.status;
      }
      if (noteChanged) patch.note = noteValue;
      const updated = await leadsApi.update(lead.id, patch);
      setSaved(true);
      onChange(updated);
    }, t("leads.errors.saveFailed"));

  const findMatches = () =>
    run(async () => {
      setMatches((await leadsApi.patientMatches(lead.id)).items);
    }, t("leads.errors.matchesFailed"));

  const setPatient = (patientId: number | null) =>
    run(async () => {
      const updated = await leadsApi.setPatient(lead.id, patientId);
      setMatches(null);
      onChange(updated);
    }, t("leads.errors.saveFailed"));

  const extra = Object.entries(lead.extra);

  return (
    <div className="space-y-4 border-t border-slate-100 bg-slate-50/70 px-4 py-4">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {extra.length > 0 ? (
          <section>
            <h4 className={sectionTitle}>{t("leads.details.extraTitle")}</h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {extra.map(([header, value]) => (
                <li key={header} data-extra className="whitespace-pre-wrap break-words">
                  <span className="font-medium text-slate-500">{header}:</span> {value}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canUpdate ? (
          <section>
            <label className="block text-xs font-medium text-slate-600" htmlFor={`lead-status-${lead.id}`}>
              {t("leads.details.status")}
              <select
                id={`lead-status-${lead.id}`}
                value={status}
                onChange={(event) => {
                  setSaved(false);
                  setStatus(event.target.value as LeadStatus);
                }}
                disabled={busy}
                className={`${field} h-10`}
              >
                {/* «Новый» is set only by the sheet reader: shown while the lead is new, never offered. */}
                {lead.status === "new" ? (
                  <option value="new" disabled>
                    {t("leads.stage.new")}
                  </option>
                ) : null}
                {LEAD_STATUS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(LEAD_STAGE_LABEL_KEYS[value])}
                  </option>
                ))}
              </select>
            </label>
            {lead.stage !== lead.status ? (
              <p className="mt-1 text-xs text-slate-500">
                {t("leads.details.derivedStage", { stage: t(LEAD_STAGE_LABEL_KEYS[lead.stage]) })}
              </p>
            ) : null}
            <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor={`lead-note-${lead.id}`}>
              {t("leads.details.note")}
              <textarea
                id={`lead-note-${lead.id}`}
                value={note}
                onChange={(event) => {
                  setSaved(false);
                  setNote(event.target.value);
                }}
                disabled={busy}
                rows={3}
                maxLength={2000}
                placeholder={t("leads.details.notePlaceholder")}
                className={`${field} py-2`}
              />
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                data-action="save"
                onClick={() => void save()}
                disabled={busy || !(statusChanged || noteChanged)}
                className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("common.save")}
              </button>
              {saved ? (
                <span className="text-xs text-emerald-700" role="status">
                  {t("common.actions.saved")}
                </span>
              ) : null}
            </div>
          </section>
        ) : lead.note ? (
          <section>
            <h4 className={sectionTitle}>{t("leads.details.note")}</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{lead.note}</p>
          </section>
        ) : null}

        <section>
          <h4 className={sectionTitle}>{t("leads.patient.title")}</h4>
          {lead.patientId !== null ? (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {lead.patientName ?? t("common.patientWithId", { id: lead.patientId })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canBook ? (
                  <Link
                    to={`/appointments?patientId=${lead.patientId}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <CalendarPlus className="h-4 w-4" aria-hidden />
                    {t("leads.patient.book")}
                  </Link>
                ) : null}
                {canLinkPatient ? (
                  <button
                    type="button"
                    data-action="unlink-patient"
                    onClick={() => void setPatient(null)}
                    disabled={busy}
                    className={secondaryButton}
                  >
                    {t("leads.patient.unlink")}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-500">{t("leads.patient.notLinked")}</p>
              {canLinkPatient ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-action="find-patient"
                    onClick={() => void findMatches()}
                    disabled={busy}
                    className={secondaryButton}
                  >
                    <Search className="h-4 w-4" aria-hidden />
                    {t("leads.patient.find")}
                  </button>
                  {canCreatePatient ? (
                    <button
                      type="button"
                      data-action="create-patient"
                      onClick={() => {
                        setCreateError(null);
                        setCreateOpen(true);
                      }}
                      disabled={busy}
                      className={secondaryButton}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      {t("leads.patient.create")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {matches === null ? null : matches.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("leads.patient.noMatches")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {matches.map((match) => (
                    <li key={match.id} data-match className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{match.fullName}</span>
                        {match.phone ? <span className="block text-xs tabular-nums text-slate-500">{match.phone}</span> : null}
                      </span>
                      <button
                        type="button"
                        data-action="link-patient"
                        onClick={() => void setPatient(match.id)}
                        disabled={busy}
                        className={secondaryButton}
                      >
                        {t("leads.patient.link")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      {createOpen && canCreatePatient ? (
        <CreatePatientModal
          open
          token={token ?? null}
          initialName={lead.fullName ?? ""}
          initialPhone={`+${lead.phone}`}
          source="advertising"
          error={createError}
          submitting={busy}
          onClose={() => setCreateOpen(false)}
          onCreated={(patient) => {
            setCreateOpen(false);
            void setPatient(patient.id);
          }}
          onError={setCreateError}
        />
      ) : null}
    </div>
  );
}
