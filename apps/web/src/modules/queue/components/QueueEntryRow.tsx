import React from "react";
import { useTranslation } from "react-i18next";
import type { QueueEntry, QueueEntryState } from "../api/queueTypes";
import { formatWallTime } from "../utils/queueView";

/** Literal keys so check-i18n verifies them. */
const STATE_KEYS: Record<QueueEntryState, string> = {
  waiting: "queue.states.waiting",
  called: "queue.states.called",
  serving: "queue.states.serving",
  missed: "queue.states.missed",
  done: "queue.states.done",
};
const STATE_TONES: Record<QueueEntryState, string> = {
  waiting: "bg-slate-100 text-slate-600",
  called: "bg-amber-100 text-amber-800",
  serving: "bg-emerald-100 text-emerald-800",
  missed: "bg-rose-100 text-rose-700",
  done: "bg-slate-100 text-slate-500",
};
const ROW_TONES: Partial<Record<QueueEntryState, string>> = {
  called: "bg-amber-50/70",
  serving: "bg-emerald-50/70",
};

/** One patient in a cabinet queue: code, full name, appointment time, waiting time, state; actions on the right. */
export function QueueEntryRow({
  entry,
  waitMinutes,
  children,
}: {
  entry: QueueEntry;
  /** Minutes since the number was issued (shown for waiting/called entries), or null. */
  waitMinutes: number | null;
  /** Action buttons; pass null for read-only roles. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const stateLabel =
    entry.state === "called" && entry.callCount > 1
      ? t("queue.states.calledTimes", { times: entry.callCount })
      : t(STATE_KEYS[entry.state]);
  const showWait = waitMinutes !== null && (entry.state === "waiting" || entry.state === "called");
  return (
    <li
      className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${ROW_TONES[entry.state] ?? ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-16 shrink-0 font-mono text-lg font-bold tracking-tight text-slate-900">
          {entry.code ?? "—"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{entry.patientName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{t("queue.entry.time", { time: formatWallTime(entry.startAt) })}</span>
            {showWait ? <span>{t("queue.entry.wait", { minutes: waitMinutes })}</span> : null}
            {entry.state !== "waiting" ? (
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATE_TONES[entry.state]}`}>{stateLabel}</span>
            ) : null}
            {entry.code === null ? <span>{t("queue.entry.noNumber")}</span> : null}
          </p>
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-wrap gap-1.5">{children}</div> : null}
    </li>
  );
}
