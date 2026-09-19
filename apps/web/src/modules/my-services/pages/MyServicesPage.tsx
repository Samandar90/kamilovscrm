import React from "react";
import { BriefcaseMedical, ListPlus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../auth/AuthContext";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { invalidateServicesCache } from "../../../shared/cache/servicesCache";
import { formatSum } from "../../../utils/formatMoney";
import { catalogPrice } from "../../appointments/utils/serviceLines";
import { myServicesApi, type OwnServiceInput, type OwnServices } from "../api/myServicesApi";
import { AddFromCatalogModal } from "../components/AddFromCatalogModal";
import { CreateOwnServiceModal } from "../components/CreateOwnServiceModal";

/** A doctor's own services: what patients can be booked with this doctor for. */
export const MyServicesPage: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [data, setData] = React.useState<OwnServices>({ assigned: [], available: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await myServicesApi.list(token));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("myServices.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const afterChange = async (message: string) => {
    invalidateServicesCache();
    setNotice(message);
    await load();
  };

  const addFromCatalog = async (serviceId: number) => {
    if (!token) return;
    setBusyId(serviceId);
    setError(null);
    try {
      await myServicesApi.add(token, serviceId);
      setCatalogOpen(false);
      await afterChange(t("myServices.messages.added"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("myServices.errors.saveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const createService = async (input: OwnServiceInput) => {
    if (!token) return;
    setCreating(true);
    setCreateError(null);
    try {
      await myServicesApi.create(token, input);
      setCreateOpen(false);
      await afterChange(t("myServices.messages.created"));
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : t("myServices.errors.saveFailed"));
    } finally {
      setCreating(false);
    }
  };

  const removeService = async (serviceId: number, name: string) => {
    if (!token || !window.confirm(t("myServices.confirmRemove", { name }))) return;
    setBusyId(serviceId);
    setError(null);
    try {
      await myServicesApi.remove(token, serviceId);
      await afterChange(t("myServices.messages.removed"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("myServices.errors.saveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-enter space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("myServices.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("myServices.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <ListPlus className="h-4 w-4" aria-hidden />
            {t("myServices.addFromCatalog")}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("myServices.createNew")}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : data.assigned.length === 0 ? (
        <ListEmptyState
          icon={BriefcaseMedical}
          title={t("myServices.empty.title")}
          description={t("myServices.empty.description")}
        />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {data.assigned.map((service) => (
            <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{service.name}</p>
                <p className="text-xs text-slate-500">
                  {t("serviceLines.minutes", { count: service.duration })}
                  {service.active === false ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-px font-medium text-slate-600">
                      {t("services.inactive")}
                    </span>
                  ) : null}
                </p>
              </div>
              <span className="text-sm font-semibold text-slate-800">{formatSum(catalogPrice(service))}</span>
              <button
                type="button"
                onClick={() => void removeService(service.id, service.name)}
                disabled={busyId !== null}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
              >
                {busyId === service.id ? t("common.saving") : t("myServices.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {catalogOpen ? (
        <AddFromCatalogModal
          services={data.available}
          busyId={busyId}
          onClose={() => setCatalogOpen(false)}
          onAdd={(serviceId) => void addFromCatalog(serviceId)}
        />
      ) : null}
      {createOpen ? (
        <CreateOwnServiceModal
          saving={creating}
          error={createError}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => void createService(input)}
        />
      ) : null}
    </div>
  );
};
