import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, RotateCcw } from "lucide-react";
import { requestJson } from "../../../api/http";
import type { UserRole } from "../../../auth/types";
import {
  attendanceApi,
  ATTENDANCE_STATUSES,
  type AttendanceRecord,
  type AttendanceStatus,
  type AttendanceSummaryRow,
} from "../api/attendanceApi";

type StaffUser = {
  id: number;
  fullName?: string;
  username: string;
  role: UserRole;
  isActive: boolean;
};

/** Локальная (настенная) дата — не UTC: клиника живёт в Asia/Tashkent. */
const localDate = (d = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const localTime = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
};

const STATUS_CHIP: Record<AttendanceStatus, string> = {
  present: "bg-emerald-50 text-emerald-700 border-emerald-200",
  late: "bg-amber-50 text-amber-700 border-amber-200",
  absent: "bg-rose-50 text-rose-700 border-rose-200",
  sick: "bg-sky-50 text-sky-700 border-sky-200",
  vacation: "bg-violet-50 text-violet-700 border-violet-200",
  day_off: "bg-slate-100 text-slate-600 border-slate-200",
};

const statusKey = (status: AttendanceStatus): string =>
  `attendance.statuses.${status === "day_off" ? "dayOff" : status}`;

export const AttendancePage: React.FC = () => {
  const { t } = useTranslation();
  const [staff, setStaff] = React.useState<StaffUser[]>([]);
  const [records, setRecords] = React.useState<Map<number, AttendanceRecord>>(new Map());
  const [view, setView] = React.useState<"day" | "month">("day");
  const [date, setDate] = React.useState<string>(localDate());
  const [month, setMonth] = React.useState<string>(localDate().slice(0, 7));
  const [summaryRows, setSummaryRows] = React.useState<AttendanceSummaryRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingUserId, setSavingUserId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Черновики заметок: userId -> текст (сохранение по blur). */
  const [noteDrafts, setNoteDrafts] = React.useState<Map<number, string>>(new Map());

  React.useEffect(() => {
    void (async () => {
      try {
        const rows = await requestJson<StaffUser[]>("/api/users");
        setStaff(rows.filter((u) => u.isActive));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("attendance.loadError"));
      }
    })();
  }, []);

  const loadDay = React.useCallback(async (targetDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await attendanceApi.listByDate(targetDate);
      setRecords(new Map(rows.map((r) => [r.userId, r])));
      setNoteDrafts(new Map(rows.map((r) => [r.userId, r.note ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("attendance.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = React.useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      setSummaryRows(await attendanceApi.summary(targetMonth));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("attendance.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (view === "day") void loadDay(date);
  }, [view, date, loadDay]);

  React.useEffect(() => {
    if (view === "month") void loadSummary(month);
  }, [view, month, loadSummary]);

  const save = async (
    user: StaffUser,
    patch: Partial<Pick<AttendanceRecord, "status" | "checkIn" | "checkOut" | "note">>
  ) => {
    const current = records.get(user.id);
    const next = {
      userId: user.id,
      workDate: date,
      status: patch.status ?? current?.status ?? "present",
      checkIn: patch.checkIn !== undefined ? patch.checkIn : current?.checkIn ?? null,
      checkOut: patch.checkOut !== undefined ? patch.checkOut : current?.checkOut ?? null,
      note: patch.note !== undefined ? patch.note : current?.note ?? null,
    };
    setSavingUserId(user.id);
    setError(null);
    try {
      const saved = await attendanceApi.upsert(next);
      setRecords((prev) => new Map(prev).set(user.id, saved));
      setNoteDrafts((prev) => new Map(prev).set(user.id, saved.note ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("attendance.saveError"));
    } finally {
      setSavingUserId(null);
    }
  };

  const reset = async (user: StaffUser) => {
    setSavingUserId(user.id);
    setError(null);
    try {
      await attendanceApi.remove(user.id, date);
      setRecords((prev) => {
        const next = new Map(prev);
        next.delete(user.id);
        return next;
      });
      setNoteDrafts((prev) => new Map(prev).set(user.id, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("attendance.saveError"));
    } finally {
      setSavingUserId(null);
    }
  };

  const summaryByUser = React.useMemo(
    () => new Map(summaryRows.map((r) => [r.userId, r.counts])),
    [summaryRows]
  );

  const busy = savingUserId !== null;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#0f172a]">{t("attendance.title")}</h1>
          <p className="text-sm text-[#64748b]">{t("attendance.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`rounded-lg border px-3 py-1.5 text-sm ${view === "day" ? "border-emerald-600 bg-emerald-600 text-white" : "border-[#e2e8f0] bg-white text-[#334155]"}`}
            onClick={() => setView("day")}
          >
            {t("attendance.viewDay")}
          </button>
          <button
            className={`rounded-lg border px-3 py-1.5 text-sm ${view === "month" ? "border-emerald-600 bg-emerald-600 text-white" : "border-[#e2e8f0] bg-white text-[#334155]"}`}
            onClick={() => setView("month")}
          >
            {t("attendance.viewMonth")}
          </button>
        </div>
      </header>

      {view === "day" ? (
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
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm text-[#0f172a]"
          />
        </div>
      )}

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-[#eef2f7] bg-white">
        {loading ? (
          <p className="px-4 py-6 text-sm text-[#64748b]">{t("common.states.loading")}</p>
        ) : view === "day" ? (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
              <tr>
                <th className="px-4 py-3">{t("attendance.employee")}</th>
                <th className="px-3 py-2">{t("attendance.status")}</th>
                <th className="px-3 py-2">{t("attendance.checkIn")}</th>
                <th className="px-3 py-2">{t("attendance.checkOut")}</th>
                <th className="px-3 py-2">{t("attendance.note")}</th>
                <th className="px-3 py-2">{t("attendance.markedBy")}</th>
                <th className="px-3 py-2">{t("attendance.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((user) => {
                const record = records.get(user.id);
                const rowBusy = savingUserId === user.id;
                return (
                  <tr key={user.id} className="border-t border-[#eef2f7]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#0f172a]">{user.fullName ?? user.username}</div>
                      <div className="text-xs text-[#64748b]">{user.role}</div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={record?.status ?? ""}
                        onChange={(e) =>
                          e.target.value &&
                          void save(user, { status: e.target.value as AttendanceStatus })
                        }
                        disabled={busy}
                        className={`rounded-lg border px-2 py-1 text-xs font-medium ${record ? STATUS_CHIP[record.status] : "border-[#e2e8f0] bg-white text-[#64748b]"}`}
                      >
                        <option value="" disabled>
                          {t("attendance.noMark")}
                        </option>
                        {ATTENDANCE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(statusKey(s))}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={record?.checkIn ?? ""}
                        onChange={(e) => void save(user, { checkIn: e.target.value || null })}
                        disabled={busy || !record}
                        className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-[#0f172a] disabled:bg-[#f8fafc]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={record?.checkOut ?? ""}
                        onChange={(e) => void save(user, { checkOut: e.target.value || null })}
                        disabled={busy || !record}
                        className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-[#0f172a] disabled:bg-[#f8fafc]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={noteDrafts.get(user.id) ?? ""}
                        placeholder={t("attendance.notePlaceholder")}
                        onChange={(e) =>
                          setNoteDrafts((prev) => new Map(prev).set(user.id, e.target.value))
                        }
                        onBlur={(e) => {
                          const value = e.target.value.trim() || null;
                          if (record && value !== (record.note ?? null)) {
                            void save(user, { note: value });
                          }
                        }}
                        disabled={busy || !record}
                        className="w-40 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-xs text-[#0f172a] disabled:bg-[#f8fafc]"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-[#64748b]">{record?.markedByName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          onClick={() =>
                            void save(user, {
                              status: record?.status === "late" ? "late" : "present",
                              checkIn: record?.checkIn ?? localTime(),
                            })
                          }
                          disabled={busy}
                        >
                          <LogIn className="h-3 w-3" />
                          {rowBusy ? "…" : t("attendance.came")}
                        </button>
                        <button
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          onClick={() =>
                            void save(user, {
                              status: record?.status ?? "present",
                              checkOut: localTime(),
                            })
                          }
                          disabled={busy}
                        >
                          <LogOut className="h-3 w-3" />
                          {t("attendance.left")}
                        </button>
                        {record ? (
                          <button
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            onClick={() => void reset(user)}
                            disabled={busy}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("attendance.reset")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
              <tr>
                <th className="px-4 py-3">{t("attendance.employee")}</th>
                {ATTENDANCE_STATUSES.map((s) => (
                  <th key={s} className="px-3 py-2">
                    {t(statusKey(s))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((user) => {
                const counts = summaryByUser.get(user.id);
                return (
                  <tr key={user.id} className="border-t border-[#eef2f7]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#0f172a]">{user.fullName ?? user.username}</div>
                      <div className="text-xs text-[#64748b]">{user.role}</div>
                    </td>
                    {ATTENDANCE_STATUSES.map((s) => {
                      const value = counts?.[s] ?? 0;
                      return (
                        <td key={s} className="px-3 py-2">
                          {value > 0 ? (
                            <span
                              className={`inline-block min-w-[28px] rounded-full border px-2 py-0.5 text-center text-xs font-semibold ${STATUS_CHIP[s]}`}
                            >
                              {value}
                            </span>
                          ) : (
                            <span className="text-xs text-[#cbd5e1]">—</span>
                          )}
                        </td>
                      );
                    })}
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
