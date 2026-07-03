import React from "react";
import { Navigate } from "react-router-dom";
import { usePlatformAccess } from "../../../hooks/usePlatformAccess";
import {
  createClinicWithAdmin,
  fetchPlatformClinics,
  updateClinicBranding,
  updateClinicSms,
  updateClinicSubscription,
  type CreateClinicInput,
  type PlatformClinic,
  type SubscriptionAction,
} from "../../../api/platformApi";
import { imageFileToDataUrl } from "../../../shared/imageToDataUrl";

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

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const EMPTY_FORM: CreateClinicInput = {
  clinicName: "",
  clinicSlug: "",
  username: "",
  password: "",
  fullName: "",
};

type CreateClinicFormProps = {
  onCreated: () => void;
};

const CreateClinicForm: React.FC<CreateClinicFormProps> = ({ onCreated }) => {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<CreateClinicInput>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [logo, setLogo] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ clinic: string; username: string; password: string } | null>(null);

  const set = (key: keyof CreateClinicInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "clinicName" && !slugTouched) next.clinicSlug = slugify(value);
      return next;
    });
  };

  const canSubmit =
    form.clinicName.trim() &&
    form.clinicSlug.trim() &&
    form.username.trim() &&
    form.fullName.trim() &&
    form.password.length >= 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload: CreateClinicInput = {
        clinicName: form.clinicName.trim(),
        clinicSlug: slugify(form.clinicSlug),
        username: form.username.trim().toLowerCase(),
        password: form.password,
        fullName: form.fullName.trim(),
        ...(logo ? { logoUrl: logo } : {}),
      };
      await createClinicWithAdmin(payload);
      setCreated({ clinic: payload.clinicName, username: payload.username, password: payload.password });
      setForm(EMPTY_FORM);
      setSlugTouched(false);
      setLogo(null);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось создать клинику");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10";

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Создать клинику</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Новая клиника получает пробный период 14 дней. Логин и пароль передайте владельцу клиники.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D4ED8]"
        >
          {open ? "Скрыть" : "+ Новая клиника"}
        </button>
      </div>

      {created ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-semibold">Клиника «{created.clinic}» создана ✅</div>
          <div className="mt-1">
            Доступ для владельца: логин <code className="rounded bg-white px-1.5 py-0.5 font-mono">{created.username}</code>{" "}
            пароль <code className="rounded bg-white px-1.5 py-0.5 font-mono">{created.password}</code>
          </div>
          <div className="mt-1 text-xs text-emerald-600">Сохраните пароль сейчас — он больше нигде не показывается.</div>
        </div>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Название клиники</label>
            <input value={form.clinicName} onChange={set("clinicName")} className={inputCls} placeholder="Например: Shifo Med" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Slug (латиницей, для системы)</label>
            <input
              value={form.clinicSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm((prev) => ({ ...prev, clinicSlug: e.target.value }));
              }}
              className={inputCls}
              placeholder="shifo-med"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Имя владельца (ФИО)</label>
            <input value={form.fullName} onChange={set("fullName")} className={inputCls} placeholder="Иванов Иван" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Логин админа клиники</label>
            <input value={form.username} onChange={set("username")} autoComplete="off" className={inputCls} placeholder="shifo_admin" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Пароль (мин. 6 символов)</label>
            <input value={form.password} onChange={set("password")} autoComplete="new-password" className={inputCls} placeholder="••••••" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Логотип клиники (для интерфейса и чеков)
            </label>
            <div className="flex items-center gap-3">
              {logo ? (
                <img src={logo} alt="Логотип" className="h-10 w-10 rounded-lg border border-slate-200 object-contain" />
              ) : null}
              <label className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-sm text-slate-500 transition hover:border-slate-400 hover:text-slate-700">
                {logo ? "Заменить лого" : "Выбрать файл (PNG/JPEG)"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    imageFileToDataUrl(file)
                      .then(setLogo)
                      .catch((err: unknown) =>
                        setError(err instanceof Error ? err.message : "Не удалось загрузить лого")
                      );
                  }}
                />
              </label>
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="h-10 w-full rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Создание…" : "Создать клинику"}
            </button>
          </div>
          {error ? (
            <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
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

  const toggleSms = async (clinicId: number, enabled: boolean) => {
    setBusyId(clinicId);
    setError(null);
    try {
      const updated = await updateClinicSms(clinicId, enabled);
      setClinics((prev) => prev.map((c) => (c.id === clinicId ? updated : c)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось переключить SMS");
    } finally {
      setBusyId(null);
    }
  };

  const changeLogo = async (clinicId: number, file: File) => {
    setBusyId(clinicId);
    setError(null);
    try {
      const dataUrl = await imageFileToDataUrl(file);
      await updateClinicBranding(clinicId, { logoUrl: dataUrl });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось обновить логотип");
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

      <CreateClinicForm onCreated={load} />

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
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleSms(c.id, !c.smsEnabled)}
                          title="SMS-напоминания пациентам за 24 часа до приёма"
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                            c.smsEnabled
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          SMS {c.smsEnabled ? "вкл" : "выкл"}
                        </button>
                        <label
                          className={`cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 ${busy ? "pointer-events-none opacity-50" : ""}`}
                        >
                          Лого
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) void changeLogo(c.id, file);
                            }}
                          />
                        </label>
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
