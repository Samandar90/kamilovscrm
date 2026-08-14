import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, Phone, Plus, X } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import {
  callCenterApi,
  CALL_OUTCOMES,
  type CallOutcome,
  type CallQueueItem,
  type CallReminderRule,
} from "../api/callCenterApi";

/** Локальная (настенная) дата клиники. */
const localDate = (d = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
};

const formatDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
};

const OUTCOME_CHIP: Record<CallOutcome, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_answer: "bg-amber-50 text-amber-700 border-amber-200",
  rescheduled: "bg-sky-50 text-sky-700 border-sky-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const outcomeKey = (outcome: CallOutcome): string =>
  `callCenter.outcomes.${outcome === "no_answer" ? "noAnswer" : outcome}`;

const itemKey = (item: Pick<CallQueueItem, "appointmentId" | "daysBefore">): string =>
  `${item.appointmentId}:${item.daysBefore}`;

export const CallCenterPage: React.FC = () => {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const isAdmin = me?.role === "superadmin";

  const [rules, setRules] = React.useState<CallReminderRule[]>([]);
  const [newDays, setNewDays] = React.useState<string>("");
  const [queue, setQueue] = React.useState<CallQueueItem[]>([]);
  const [date, setDate] = React.useState<string>(localDate());
  const [loading, setLoading] = React.useState(true);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Map<string, string>>(new Map());

  const loadRules = React.useCallback(async () => {
    try {
      setRules(await callCenterApi.listRules());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("callCenter.loadError"));
    }
  }, []);

  const loadQueue = React.useCallback(async (targetDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await callCenterApi.queue(targetDate);
      setQueue(rows);
      setNotes(new Map(rows.map((r) => [itemKey(r), r.log?.note ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("callCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadRules();
  }, [loadRules]);

  React.useEffect(() => {
    void loadQueue(date);
  }, [date, loadQueue]);

  const addRule = async () => {
    const days = Number(newDays);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      setError(t("callCenter.ruleRangeError"));
      return;
    }
    setError(null);
    try {
      await callCenterApi.addRule(days);
      setNewDays("");
      await loadRules();
      await loadQueue(date);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("callCenter.saveError"));
    }
  };

  const removeRule = async (rule: CallReminderRule) => {
    setError(null);
    try {
      await callCenterApi.removeRule(rule.id);
      await loadRules();
      await loadQueue(date);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("callCenter.saveError"));
    }
  };

  const mark = async (item: CallQueueItem, outcome: CallOutcome) => {
    const key = itemKey(item);
    setSavingKey(key);
    setError(null);
    try {
      const log = await callCenterApi.mark({
        appointmentId: item.appointmentId,
        daysBefore: item.daysBefore,
        outcome,
        note: notes.get(key)?.trim() || null,
      });
      setQueue((prev) =>
        prev.map((row) => (itemKey(row) === key ? { ...row, log } : row))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("callCenter.saveError"));
    } finally {
      setSavingKey(null);
    }
  };

  const total = queue.length;
  const done = queue.filter((item) => item.log !== null).length;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#0f172a]">{t("callCenter.title")}</h1>
          <p className="text-sm text-[#64748b]">{t("callCenter.subtitle")}</p>
        </div>
        <div className="text-sm text-[#64748b]">
          {t("callCenter.progress", { done, total })}
        </div>
      </header>

      <section className="rounded-2xl border border-[#eef2f7] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#0f172a]">{t("callCenter.rulesTitle")}</h2>
        <p className="mb-3 text-xs text-[#64748b]">
          {isAdmin ? t("callCenter.rulesHintAdmin") : t("callCenter.rulesHint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {rules.length === 0 ? (
            <span className="text-sm text-[#94a3b8]">{t("callCenter.noRules")}</span>
          ) : (
            rules.map((rule) => (
              <span
                key={rule.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
              >
                {rule.daysBefore === 0
                  ? t("callCenter.ruleSameDay")
                  : t("callCenter.ruleDaysBefore", { days: rule.daysBefore })}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void removeRule(rule)}
                    aria-label={t("callCenter.removeRule")}
                    className="text-violet-400 transition hover:text-violet-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
            ))
          )}
          {isAdmin ? (
            <span className="inline-flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={30}
                value={newDays}
                onChange={(e) => setNewDays(e.target.value)}
                placeholder={t("callCenter.daysPlaceholder")}
                className="w-24 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-[#0f172a]"
              />
              <button
                type="button"
                onClick={() => void addRule()}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <Plus className="h-3 w-3" />
                {t("callCenter.addRule")}
              </button>
            </span>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#334155] hover:bg-[#f8fafc]"
          onClick={() => setDate((d) => shiftDate(d, -1))}
          aria-label={t("attendance.prevDay")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm text-[#0f172a]"
        />
        <button
          className="rounded-lg border border-[#e2e8f0] bg-white p-2 text-[#334155] hover:bg-[#f8fafc]"
          onClick={() => setDate((d) => shiftDate(d, 1))}
          aria-label={t("attendance.nextDay")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f8fafc]"
          onClick={() => setDate(localDate())}
        >
          <CalendarDays className="h-4 w-4" />
          {t("attendance.today")}
        </button>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-[#eef2f7] bg-white">
        {loading ? (
          <p className="px-4 py-6 text-sm text-[#64748b]">{t("common.states.loading")}</p>
        ) : queue.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#64748b]">
            {rules.length === 0 ? t("callCenter.noRulesQueue") : t("callCenter.emptyQueue")}
          </p>
        ) : (
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
              <tr>
                <th className="px-4 py-3">{t("callCenter.reminder")}</th>
                <th className="px-3 py-2">{t("callCenter.patient")}</th>
                <th className="px-3 py-2">{t("callCenter.phone")}</th>
                <th className="px-3 py-2">{t("callCenter.appointment")}</th>
                <th className="px-3 py-2">{t("callCenter.result")}</th>
                <th className="px-3 py-2">{t("attendance.note")}</th>
                <th className="px-3 py-2">{t("callCenter.markCall")}</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => {
                const key = itemKey(item);
                const rowBusy = savingKey === key;
                return (
                  <tr key={key} className="border-t border-[#eef2f7]">
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {item.daysBefore === 0
                          ? t("callCenter.ruleSameDay")
                          : t("callCenter.ruleDaysBefore", { days: item.daysBefore })}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-[#0f172a]">{item.patientName}</td>
                    <td className="px-3 py-2">
                      {item.patientPhone ? (
                        <a
                          href={`tel:${item.patientPhone}`}
                          className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {item.patientPhone}
                        </a>
                      ) : (
                        <span className="text-xs text-[#94a3b8]">{t("callCenter.noPhone")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#334155]">
                      {formatDate(item.appointmentDate)} · {item.appointmentTime}
                      <div className="text-xs text-[#64748b]">{item.doctorName}</div>
                    </td>
                    <td className="px-3 py-2">
                      {item.log ? (
                        <div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_CHIP[item.log.outcome]}`}
                          >
                            {t(outcomeKey(item.log.outcome))}
                          </span>
                          <div className="mt-1 text-xs text-[#94a3b8]">
                            {item.log.calledByName ?? ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-[#94a3b8]">{t("callCenter.notCalled")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={notes.get(key) ?? ""}
                        placeholder={t("attendance.notePlaceholder")}
                        onChange={(e) =>
                          setNotes((prev) => new Map(prev).set(key, e.target.value))
                        }
                        className="w-36 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-[#0f172a]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {CALL_OUTCOMES.map((outcome) => (
                          <button
                            key={outcome}
                            type="button"
                            onClick={() => void mark(item, outcome)}
                            disabled={savingKey !== null}
                            className={`rounded-md border px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${
                              item.log?.outcome === outcome
                                ? OUTCOME_CHIP[outcome]
                                : "border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]"
                            }`}
                          >
                            {rowBusy ? "…" : t(outcomeKey(outcome))}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
