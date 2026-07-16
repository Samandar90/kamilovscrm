import React from "react";
import { BriefcaseMedical, Plus, Search, Stethoscope, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestJson } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { Modal } from "../../../components/ui/Modal";
import { SelectableItemsModal } from "../../../components/ui/SelectableItemsModal";
import {
  getServicesCached,
  getServicesInstant,
  refreshServicesCache,
} from "../../../shared/cache/servicesCache";
import { useDebounce } from "../../../shared/lib/useDebounce";
import { normalizeMoneyInput } from "../../../shared/lib/money";
import { CollapsibleChips } from "../../../shared/ui/CollapsibleChips";
import { MoneyInput } from "../../../shared/ui/MoneyInput";
import { formatSum } from "../../../utils/formatMoney";

const SERVICE_CATEGORIES = [
  "consultation",
  "diagnostics",
  "hygiene",
  "treatment",
  "surgery",
  "orthodontics",
  "other",
] as const;

const CATEGORY_KEYS = {
  consultation: "services.category.consultation",
  diagnostics: "services.category.diagnostics",
  hygiene: "services.category.hygiene",
  treatment: "services.category.treatment",
  surgery: "services.category.surgery",
  orthodontics: "services.category.orthodontics",
  other: "services.category.other",
} as const;

type ServiceRow = {
  id: number;
  name: string;
  category: string;
  price: number;
  duration: number;
  active: boolean;
  doctorIds: number[];
  createdAt: string;
};

type DoctorOption = {
  id: number;
  name: string;
};

type ServiceFormState = {
  name: string;
  category: string;
  price: number;
  duration: string;
  active: boolean;
  doctorIds: number[];
};

const initialFormState: ServiceFormState = {
  name: "",
  category: "other",
  price: 0,
  duration: "30",
  active: true,
  doctorIds: [],
};

export const ServicesPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, token } = useAuth();
  const canManage = !!user?.role && hasPermission(user.role, "services", "create");
  const [services, setServices] = React.useState<ServiceRow[]>(
    () => (getServicesInstant() as ServiceRow[] | null) ?? []
  );
  const [doctors, setDoctors] = React.useState<DoctorOption[]>([]);
  const [loading, setLoading] = React.useState(services.length === 0);
  const [isSaving, setIsSaving] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [doctorPickerOpen, setDoctorPickerOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [formState, setFormState] = React.useState<ServiceFormState>(initialFormState);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounce(search, 300);

  const loadAll = React.useCallback(async () => {
    if (!token) return;
    setError(null);
    const fetchServices = () => requestJson<ServiceRow[]>("/api/services", { token });
    try {
      const [serviceRows, doctorRows] = await Promise.all([
        getServicesCached(fetchServices),
        requestJson<DoctorOption[]>("/api/doctors", { token }),
      ]);
      setServices(serviceRows as ServiceRow[]);
      setDoctors(doctorRows);

      // Background refresh keeps UX instant but data fresh.
      void refreshServicesCache(fetchServices)
        .then((freshRows) => {
          setServices(freshRows as ServiceRow[]);
        })
        .catch(() => {
          // Ignore background refresh errors; initial data already rendered.
        });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("services.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    if (window.innerWidth < 768) return;
    searchInputRef.current?.focus();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setFormState(initialFormState);
    setModalOpen(true);
    setError(null);
  };

  const openEditModal = (service: ServiceRow) => {
    setEditingId(service.id);
    setFormState({
      name: service.name,
      category: SERVICE_CATEGORIES.includes(service.category as (typeof SERVICE_CATEGORIES)[number])
        ? service.category
        : "other",
      price: Math.round(Number(service.price)),
      duration: String(service.duration),
      active: service.active,
      doctorIds: [...service.doctorIds],
    });
    setModalOpen(true);
    setError(null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setDoctorPickerOpen(false);
    setEditingId(null);
    setFormState(initialFormState);
  };

  const submitService = async () => {
    if (!token || !canManage) return;
    const name = formState.name.trim();
    const category = formState.category.trim();
    const price = formState.price;
    const durationRaw = normalizeMoneyInput(formState.duration);
    const duration = durationRaw != null ? Math.round(durationRaw) : NaN;
    if (!name) {
      setError(t("services.errors.nameRequired"));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError(t("services.errors.priceInvalid"));
      return;
    }
    if (!Number.isInteger(duration) || duration <= 0) {
      setError(t("services.errors.durationInvalid"));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingId === null) {
        await requestJson<ServiceRow>("/api/services", {
          method: "POST",
          token,
          body: {
            name,
            category,
            price,
            duration,
            active: formState.active,
            doctorIds: formState.doctorIds,
          },
        });
        setToast(t("services.messages.created"));
      } else {
        await requestJson<ServiceRow>(`/api/services/${editingId}`, {
          method: "PUT",
          token,
          body: {
            name,
            category,
            price,
            duration,
            active: formState.active,
            doctorIds: formState.doctorIds,
          },
        });
        setToast(t("services.messages.updated"));
      }
      closeModal();
      await loadAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("services.errors.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (service: ServiceRow) => {
    if (!token || !canManage) return;
    setTogglingId(service.id);
    setError(null);
    try {
      await requestJson<ServiceRow>(`/api/services/${service.id}`, {
        method: "PUT",
        token,
        body: { active: !service.active },
      });
      setToast(!service.active ? t("services.messages.activated") : t("services.messages.deactivated"));
      await loadAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("services.errors.toggleFailed"));
    } finally {
      setTogglingId(null);
    }
  };
  const doctorNameById = React.useMemo(
    () => Object.fromEntries(doctors.map((doctor) => [doctor.id, doctor.name])),
    [doctors]
  );
  const normalizedSearch = debouncedSearch.trim().toLowerCase();
  const filteredServices = React.useMemo(() => {
    if (!normalizedSearch) return services;
    return services.filter((service) => {
      const byName = service.name.toLowerCase().includes(normalizedSearch);
      const categoryLabel = t(CATEGORY_KEYS[service.category as keyof typeof CATEGORY_KEYS] ?? "services.category.other");
      const byCategory = categoryLabel.toLowerCase().includes(normalizedSearch);
      return byName || byCategory;
    });
  }, [services, normalizedSearch]);
  const selectedDoctorRefs = React.useMemo(
    () =>
      formState.doctorIds.map((doctorId) => ({
        id: doctorId,
        name: doctorNameById[doctorId] ?? `#${doctorId}`,
      })),
    [formState.doctorIds, doctorNameById]
  );

  return (
    <div className="page-enter space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-[#0f172a]">{t("services.title")}</h2>
          <p className="mt-1 text-sm text-[#64748b]">{t("services.description")}</p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <div className="relative w-full sm:w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("services.searchPlaceholder")}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-[#0f172a] outline-none transition focus:ring-2 focus:ring-primary-500"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label={t("services.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {canManage ? (
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-5 text-sm font-semibold text-white shadow-[0_4px_14px_-6px_rgba(22,163,74,0.45)] transition duration-200 hover:bg-[#22c55e] hover:shadow-[0_6px_20px_-8px_rgba(22,163,74,0.5)] active:scale-[0.98] disabled:opacity-50"
              onClick={openCreateModal}
              disabled={isSaving}
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              {t("services.addService")}
            </button>
          ) : null}
        </div>
      </header>

      {toast && (
        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          {error}
        </div>
      )}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <ListEmptyState
          icon={BriefcaseMedical}
          title={t("services.empty.title")}
          description={t("services.empty.description")}
          actionLabel={t("services.addService")}
          onAction={openCreateModal}
          showAction={canManage}
          actionDisabled={isSaving}
        />
      ) : filteredServices.length === 0 ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-base font-medium text-slate-400">{t("services.noResults.title")}</p>
          <p className="mt-1 text-sm text-slate-400">{t("services.noResults.description")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filteredServices.map((service) => (
            <li key={service.id}>
              <article className="group rounded-[14px] border border-[#e2e8f0] bg-white p-[14px] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-18px_rgba(15,23,42,0.18)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[#0f172a]">{service.name}</h3>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#64748b]">
                      <Stethoscope className="h-3.5 w-3.5 text-[#94a3b8]" strokeWidth={1.75} />
                      {t(CATEGORY_KEYS[service.category as keyof typeof CATEGORY_KEYS] ?? "services.category.other")}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      service.active
                        ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
                        : "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
                    }`}
                  >
                    {service.active ? t("services.active") : t("services.inactive")}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#94a3b8]">{t("services.duration")}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-[#0f172a]">{service.duration} {t("services.minutes")}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#94a3b8]">{t("services.price")}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-[#0f172a]">
                      {formatSum(service.price)}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-[#94a3b8]">{t("services.doctors")}</p>
                  {service.doctorIds.length > 0 ? (
                    <CollapsibleChips
                      items={service.doctorIds}
                      maxVisible={2}
                      className="mt-2"
                      renderItem={(doctorId) => (
                        <span
                          key={`${service.id}-${doctorId}`}
                          className="inline-flex items-center rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-0.5 text-xs font-medium text-[#1d4ed8]"
                        >
                          {doctorNameById[doctorId] ?? `#${doctorId}`}
                        </span>
                      )}
                    />
                  ) : (
                    <p className="mt-1 text-sm text-[#94a3b8]">{t("services.noDoctorsAssigned")}</p>
                  )}
                </div>

                {canManage && (
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#f1f5f9] pt-3">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center rounded-lg border border-[#e2e8f0] bg-white px-2.5 text-xs font-medium text-[#0f172a] transition hover:bg-[#f1f5f9] disabled:opacity-50"
                      onClick={() => openEditModal(service)}
                      disabled={isSaving || togglingId !== null}
                    >
                      {t("services.editService")}
                    </button>
                    <button
                      type="button"
                      className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition disabled:opacity-50 ${
                        service.active
                          ? "border border-[#fecaca] bg-[#fef2f2] text-[#991b1b] hover:bg-[#fee2e2]"
                          : "border border-[#bbf7d0] bg-[#f0fdf4] text-[#166534] hover:bg-[#dcfce7]"
                      }`}
                      onClick={() => void toggleActive(service)}
                      disabled={togglingId === service.id || isSaving}
                    >
                      {togglingId === service.id ? "..." : service.active ? t("services.deactivate") : t("services.activate")}
                    </button>
                  </div>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Modal
          isOpen={modalOpen}
          onClose={closeModal}
          className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[20px] border border-[#e2e8f0] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.22)]"
        >
            <h3 className="text-lg font-semibold text-[#0f172a]">
              {editingId === null ? t("services.newService") : t("services.editService")}
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="text-sm text-[#334155]">
                {t("services.name")}
                <input
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                {t("services.categoryLabel")}
                <select
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.category}
                  onChange={(event) => setFormState((prev) => ({ ...prev, category: event.target.value }))}
                  disabled={isSaving}
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(CATEGORY_KEYS[c] ?? "services.category.other")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[#334155]">
                {t("services.durationLabel")}
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.duration}
                  onChange={(event) => setFormState((prev) => ({ ...prev, duration: event.target.value }))}
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                {t("services.priceLabel")}
                <MoneyInput
                  mode="integer"
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.price}
                  onChange={(next) => setFormState((prev) => ({ ...prev, price: next }))}
                  disabled={isSaving}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-[#334155]">
                <input
                  type="checkbox"
                  checked={formState.active}
                  onChange={(event) => setFormState((prev) => ({ ...prev, active: event.target.checked }))}
                  disabled={isSaving}
                  className="h-4 w-4 rounded border-[#cbd5e1] text-[#16a34a] focus:ring-[#16a34a]/30"
                />
                {t("services.activeLabel")}
              </label>
              <div className="text-sm text-[#334155]">
                <span className="block">{t("services.doctors")}</span>
                <p className="mt-1 text-xs text-[#94a3b8]">{t("services.doctorsHelp")}</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[#334155]">
                    {t("services.doctorsSelected")}: {formState.doctorIds.length}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDoctorPickerOpen(true)}
                    disabled={isSaving || doctors.length === 0}
                    className="inline-flex h-9 items-center rounded-lg border border-[#e2e8f0] bg-white px-3 text-xs font-semibold text-[#0f172a] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {formState.doctorIds.length === 0 ? t("services.addDoctors") : t("services.changeDoctors")}
                  </button>
                </div>
                {doctors.length === 0 ? (
                  <span className="mt-2 block text-xs text-[#94a3b8]">{t("services.noDoctorsAvailable")}</span>
                ) : selectedDoctorRefs.length > 0 ? (
                  <CollapsibleChips
                    items={selectedDoctorRefs}
                    maxVisible={8}
                    className="mt-2"
                    renderItem={(doctor) => (
                      <span
                        key={doctor.id}
                        className="inline-flex whitespace-nowrap rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-0.5 text-xs font-medium text-[#1d4ed8]"
                      >
                        {doctor.name}
                      </span>
                    )}
                  />
                ) : (
                  <span className="mt-2 block text-xs text-[#94a3b8]">{t("services.nothingSelected")}</span>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#0f172a] transition hover:bg-[#f1f5f9]"
                onClick={closeModal}
                disabled={isSaving}
              >
                {t("services.cancel")}
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#16a34a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#22c55e] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void submitService()}
                disabled={isSaving}
              >
                {isSaving ? t("services.saving") : t("services.save")}
              </button>
            </div>
        </Modal>
      )}
      {canManage && (
        <SelectableItemsModal
          isOpen={doctorPickerOpen}
          title={t("services.selectDoctors")}
          options={doctors}
          selectedIds={formState.doctorIds}
          searchPlaceholder={t("services.searchDoctors")}
          onClose={() => setDoctorPickerOpen(false)}
          onSave={(nextIds) => {
            setFormState((prev) => ({ ...prev, doctorIds: nextIds }));
            setDoctorPickerOpen(false);
          }}
          disabled={isSaving}
        />
      )}
    </div>
  );
};
