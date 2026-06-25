import React from "react";
import { Navigate } from "react-router-dom";
import { usePlatformAccess } from "../../../hooks/usePlatformAccess";
import {
  fetchPlatformClinics,
  updateClinicSubscription,
  type PlatformClinic,
  type SubscriptionAction,
} from "../../../api/platformApi";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  trialing: { text: "Пробный", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  active: { text: "Активна", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  expired: { text: "Истекла", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  suspended: { text: "Приостановлена", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU");
};

const daysLeft = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86_400_000);
};

export const PlatformPage: React.FC = () => {
  const { isPlatformAdmin, loading: accessLoading } = usePlatformAccess();
  const [clinics, setClinics] = React.useState<PlatformClinic[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    fetchPlatformClinics()
      .then((rows) => {
        setClinics(rows);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (isPlatformAdmin) load();
  }, [isPlatformAdmin, load]);

  const act = async (clinicId: number, body: SubscriptionAction) => {
    setBusyId(clinicId);
    setError(null);
    try {
      const updated = await updateClinicSubscription(clinicId, body);
      setClinics((prev) => prev.map((c) => (c.id === clinicId ? updated : c)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось обновить подписку");
    } finally {
      setBusyId(null);
    }
  };

  if (accessLoading) {
    return <div className="p-8 text-slate-500">Загрузка…</div>;
  }
  if (!isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Платформа · Клиники</h1>
        <p className="mt-1 text-sm text-slate-500">
          Управление подписками клиник. Оплата отмечается вручную: продлите доступ после поступления оплаты.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Клиника</th>
              <th className="px-4 py-3 font-semibold">Статус</th>
              <th className="px-4 py-3 font-semibold">Действует до</th>
              <th className="px-4 py-3 font-semibold">Польз.</th>
              <th className="px-4 py-3 font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Загрузка…
                </td>
              </tr>
            ) : clinics.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Клиник пока нет
                </td>
              </tr>
            ) : (
              clinics.map((c) => {
                const badge = STATUS_LABEL[c.status] ?? {
                  text: c.status,
                  cls: "bg-slate-50 text-slate-600 border-slate-200",
                };
                const left = daysLeft(c.endsAt);
                const busy = busyId === c.id;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.slug ?? `#${c.id}`}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.endsAt ? (
                        <span>
                          {fmtDate(c.endsAt)}
                          {left != null ? (
                            <span className={`ml-1 text-xs ${left < 0 ? "text-rose-500" : left <= 5 ? "text-amber-500" : "text-slate-400"}`}>
                              ({left < 0 ? `просрочено на ${-left} дн.` : `${left} дн.`})
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">бессрочно</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{c.userCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 3, 6, 12].map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={busy}
                            onClick={() => act(c.id, { action: "extend", months: m })}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                          >
                            +{m} мес
                          </button>
                        ))}
                        {c.status === "suspended" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(c.id, { action: "activate" })}
                            className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
                          >
                            Активировать
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(c.id, { action: "suspend" })}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                          >
                            Приостановить
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PlatformPage;
