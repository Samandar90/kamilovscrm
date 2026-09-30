import React from "react";
import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QueueDoctorDay, QueueEntry } from "../api/queueTypes";
import { nextWaiting, type QueueAction } from "../utils/queueView";
import { QueueEntryRow } from "./QueueEntryRow";

export type CabinetPermissions = {
  /** Call / call next / start / not came / complete (queue.update — reception, doctor, nurse, superadmin). */
  canCall: boolean;
  /** «Вернуть в очередь» for a missed patient (queue.create — reception, superadmin). */
  canIssue: boolean;
  /** «Открыть приём» → /doctor-workspace/:id. */
  canOpenWorkspace: boolean;
};

const buttonBase =
  "inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${buttonBase} bg-emerald-600 text-white hover:bg-emerald-700`;
const secondaryButton = `${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const dangerButton = `${buttonBase} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`;

/** One doctor's queue today: who is in the cabinet, the big «Вызвать следующего», waiting and missed patients. */
export function CabinetQueueCard({
  day,
  permissions,
  disabled,
  waitOf,
  onAction,
}: {
  day: QueueDoctorDay;
  permissions: CabinetPermissions;
  /** True while any queue action is running (prevents double calls). */
  disabled: boolean;
  waitOf: (entry: QueueEntry) => number | null;
  onAction: (action: QueueAction) => void;
}) {
  const { t } = useTranslation();
  const next = nextWaiting(day);
  const room = day.room?.trim();

  const button = (label: string, action: QueueAction, className: string) => (
    <button type="button" data-action={action.kind} className={className} disabled={disabled} onClick={() => onAction(action)}>
      {label}
    </button>
  );

  const servingActions = (entry: QueueEntry) =>
    permissions.canCall || permissions.canOpenWorkspace ? (
      <>
        {permissions.canOpenWorkspace ? button(t("queue.actions.openWorkspace"), { kind: "openWorkspace", entry }, secondaryButton) : null}
        {permissions.canCall ? button(t("queue.actions.complete"), { kind: "complete", entry }, primaryButton) : null}
      </>
    ) : null;

  const waitingActions = (entry: QueueEntry) => {
    if (!permissions.canCall) return null;
    if (entry.state === "called") {
      return (
        <>
          {button(t("queue.actions.start"), { kind: "start", entry }, primaryButton)}
          {button(t("queue.actions.recall"), { kind: "call", entry }, secondaryButton)}
          {button(t("queue.actions.notCame"), { kind: "notCame", entry }, dangerButton)}
        </>
      );
    }
    return button(t("queue.actions.call"), { kind: "call", entry }, secondaryButton);
  };

  return (
    <article className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={day.doctorName}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {room ? t("queue.cabinet.room", { room }) : t("queue.cabinet.noRoom")}
          </p>
          <h3 className="truncate text-base font-semibold text-slate-900">{day.doctorName}</h3>
          {day.specialty ? <p className="truncate text-xs text-slate-500">{day.specialty}</p> : null}
        </div>
        <div className="shrink-0 space-y-0.5 text-right text-xs text-slate-500">
          <p>{t("queue.cabinet.waiting", { total: day.waiting.length })}</p>
          <p>{t("queue.cabinet.done", { total: day.doneCount })}</p>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {day.serving ? (
          <ul className="overflow-hidden rounded-xl border border-emerald-200">
            <QueueEntryRow entry={day.serving} waitMinutes={null}>
              {servingActions(day.serving)}
            </QueueEntryRow>
          </ul>
        ) : null}

        {permissions.canCall ? (
          next ? (
            <button
              type="button"
              data-action="callNext"
              disabled={disabled}
              onClick={() => onAction({ kind: "callNext", doctorId: day.doctorId })}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Megaphone className="h-5 w-5" aria-hidden />
              {t("queue.actions.callNext", { code: next.code ?? "" })}
            </button>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-sm text-slate-500">
              {t("queue.cabinet.noWaiting")}
            </p>
          )
        ) : null}

        {day.waiting.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {day.waiting.map((entry) => (
              <QueueEntryRow key={entry.appointmentId} entry={entry} waitMinutes={waitOf(entry)}>
                {waitingActions(entry)}
              </QueueEntryRow>
            ))}
          </ul>
        ) : !permissions.canCall ? (
          <p className="text-sm text-slate-500">{t("queue.cabinet.noWaiting")}</p>
        ) : null}

        {day.missed.length ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("queue.cabinet.missed")}</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {day.missed.map((entry) => (
                <QueueEntryRow key={entry.appointmentId} entry={entry} waitMinutes={null}>
                  {permissions.canIssue
                    ? button(t("queue.actions.returnToQueue"), { kind: "returnToQueue", entry }, secondaryButton)
                    : null}
                </QueueEntryRow>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
