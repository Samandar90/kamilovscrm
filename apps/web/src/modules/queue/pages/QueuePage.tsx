import React from "react";
import { ListOrdered, RefreshCw, Tv } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import {
  DOCTOR_WORKSPACE_ROLES,
  canCallQueue,
  canIssueQueue,
  canManageQueueDisplays,
} from "../../../auth/roleGroups";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { appointmentsFlowApi } from "../../appointments/api/appointmentsFlowApi";
import { queueApi } from "../api/queueApi";
import type { QueueEntry } from "../api/queueTypes";
import { CabinetQueueCard } from "../components/CabinetQueueCard";
import { DisplaysPanel } from "../components/DisplaysPanel";
import { usePolling } from "../hooks/usePolling";
import { entryLabel, waitMinutes, type QueueAction } from "../utils/queueView";

const QUEUE_POLL_MS = 5000;
/** Longest wait for the reload after an action; a stalled /today must not lock the page for good. */
const ACTION_REFRESH_WAIT_MS = 8_000;

type ServerAction = Exclude<QueueAction, { kind: "openWorkspace" }>;

/**
 * Staff «Очередь» page. Doctors and nurses get only their doctor's card (the API scopes /today and always
 * includes their doctor); reception and superadmin see every cabinet with actions; manager and director read only.
 */
export const QueuePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const role = user?.role;
  const canCall = canCallQueue(role);
  const canIssue = canIssueQueue(role);
  const canManageDisplays = canManageQueueDisplays(role);
  // Opening the visit is an action too: read-only roles (manager, director) never get it.
  const canOpenWorkspace = canCall && !!role && DOCTOR_WORKSPACE_ROLES.includes(role);

  const { data, error, loading, refresh } = usePolling((signal) => queueApi.today(null, signal), QUEUE_POLL_MS, []);
  // Client clock minus server clock when this snapshot arrived (see waitMinutes).
  const skewMs = React.useMemo(() => (data ? Date.now() - Date.parse(data.serverTime) : 0), [data]);
  const [pending, setPending] = React.useState(false);
  // Synchronous twin of `pending`: a second click can arrive before React re-renders the disabled buttons.
  const pendingRef = React.useRef(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [showDisplays, setShowDisplays] = React.useState(false);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const waitOf = (entry: QueueEntry): number | null =>
    data ? waitMinutes(entry.issuedAt, data.serverTime, skewMs, Date.now()) : null;

  /** Runs one action on the API and returns the notice to show. */
  const perform = async (action: ServerAction, authToken: string): Promise<string> => {
    switch (action.kind) {
      case "callNext": {
        const { entry } = await queueApi.callNext(action.doctorId);
        return entry ? t("queue.notices.called", { code: entryLabel(entry) }) : t("queue.notices.nobodyWaiting");
      }
      case "call": {
        const { entry } = await queueApi.call(action.entry.appointmentId);
        return t("queue.notices.called", { code: entryLabel(entry) });
      }
      case "start":
        await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "in_consultation");
        return t("queue.notices.started", { code: entryLabel(action.entry) });
      case "notCame":
        await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "no_show");
        return t("queue.notices.missed", { code: entryLabel(action.entry) });
      case "returnToQueue": {
        // The API gives a NEW number at the end of the queue (no_show → arrived is allowed only for today's visit).
        const updated = await appointmentsFlowApi.updateAppointmentStatus(authToken, action.entry.appointmentId, "arrived");
        return t("queue.notices.returned", { code: updated.queueCode ?? entryLabel(action.entry) });
      }
      case "complete":
        await appointmentsFlowApi.completeAppointment(authToken, action.entry.appointmentId, {});
        return t("queue.notices.completed", { code: entryLabel(action.entry) });
    }
  };

  const run = async (action: QueueAction) => {
    // requestJson treats "" as "no token" (it would send no Authorization header), so never call without one.
    if (pendingRef.current || !token) return;
    if (action.kind === "openWorkspace") {
      navigate(`/doctor-workspace/${action.entry.appointmentId}`);
      return;
    }
    if (action.kind === "notCame" && !window.confirm(t("queue.actions.confirmNotCame", { code: entryLabel(action.entry) }))) {
      return;
    }
    if (action.kind === "complete" && !window.confirm(t("queue.actions.confirmComplete", { code: entryLabel(action.entry) }))) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    try {
      setNotice(await perform(action, token));
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : t("queue.errors.actionFailed"));
    } finally {
      // Stay locked until the reloaded queue is on screen: the old snapshot still offers the patient just called
      // («Вызвать следующего · К-06»), so a quick second press would call the next patient or re-call this one.
      // Refresh after a failure too: it usually means somebody else already changed this patient.
      let waitTimer: number | undefined;
      await Promise.race([
        refresh(),
        new Promise<void>((resolve) => {
          waitTimer = window.setTimeout(resolve, ACTION_REFRESH_WAIT_MS);
        }),
      ]);
      window.clearTimeout(waitTimer);
      pendingRef.current = false;
      setPending(false);
    }
  };

  const doctors = data?.doctors ?? [];

  return (
    <div className="page-enter space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("queue.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("queue.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageDisplays ? (
            <button
              type="button"
              onClick={() => setShowDisplays((value) => !value)}
              aria-expanded={showDisplays}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <Tv className="h-4 w-4" aria-hidden />
              {t("queue.actions.displays")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label={t("common.actions.refresh")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
      </header>

      {showDisplays ? <DisplaysPanel onClose={() => setShowDisplays(false)} /> : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {t("queue.errors.loadFailed")}: {error}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : data && doctors.length === 0 ? (
        <ListEmptyState icon={ListOrdered} title={t("queue.empty.title")} description={t("queue.empty.description")} />
      ) : doctors.length ? (
        <div className={doctors.length === 1 ? "max-w-3xl" : "grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"}>
          {doctors.map((day) => (
            <CabinetQueueCard
              key={day.doctorId}
              day={day}
              permissions={{ canCall, canIssue, canOpenWorkspace }}
              disabled={pending}
              waitOf={waitOf}
              onAction={(action) => void run(action)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
