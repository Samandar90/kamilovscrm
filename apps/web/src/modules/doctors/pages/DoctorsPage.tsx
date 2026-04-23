import React from "react";
import { Plus, Stethoscope } from "lucide-react";
import { requestJson } from "../../../api/http";
import { useAuth } from "../../../auth/AuthContext";
import { hasPermission } from "../../../auth/permissions";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { MultiSelect } from "../../../components/ui/MultiSelect";
import { Modal } from "../../../components/ui/Modal";
import { CollapsibleChips } from "../../../shared/ui/CollapsibleChips";
import { PhoneInput } from "../../../shared/ui/PhoneInput";
import { phoneToApiValue, storedPhoneToNormalized } from "../../../utils/phoneInput";

type Doctor = {
  id: number;
  name: string;
  speciality: string;
  percent: number;
  phone?: string | null;
  birth_date?: string | null;
  active: boolean;
  serviceIds?: number[];
};

type ServiceRef = {
  id: number;
  name: string;
};

type DoctorFormState = {
  name: string;
  speciality: string;
  percent: string;
  phone: string;
  birthDate: string;
  active: boolean;
  serviceIds: number[];
};

const initialFormState: DoctorFormState = {
  name: "",
  speciality: "",
  percent: "0",
  phone: "",
  birthDate: "",
  active: true,
  serviceIds: [],
};

type DoctorServicesChipsProps = {
  doctorId: number;
  serviceIds: number[];
  serviceNameById: Record<number, string>;
};

const DoctorServicesChips: React.FC<DoctorServicesChipsProps> = ({
  doctorId,
  serviceIds,
  serviceNameById,
}) => {
  if (serviceIds.length === 0) {
    return <p className="mt-1 text-sm text-[#94a3b8]">Услуги пока не назначены</p>;
  }

  return (
    <CollapsibleChips
      items={serviceIds}
      maxVisible={2}
      className="mt-2"
      renderItem={(serviceId) => (
        <span
          key={`${doctorId}-${serviceId}`}
          className="inline-flex items-center rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-0.5 text-xs font-medium text-[#1d4ed8]"
        >
          {serviceNameById[serviceId] ?? `#${serviceId}`}
        </span>
      )}
    />
  );
};

export const DoctorsPage: React.FC = () => {
  const { user } = useAuth();
  const canManage = !!user?.role && hasPermission(user.role, "doctors", "create");
  const [doctors, setDoctors] = React.useState<Doctor[]>([]);
  const [services, setServices] = React.useState<ServiceRef[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeletingId, setIsDeletingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingDoctorId, setEditingDoctorId] = React.useState<number | null>(null);
  const [formState, setFormState] = React.useState<DoctorFormState>(initialFormState);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [doctorRows, serviceRows] = await Promise.all([
        requestJson<Doctor[]>("/api/doctors"),
        requestJson<ServiceRef[]>("/api/services"),
      ]);
      setDoctors(doctorRows);
      setServices(serviceRows);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка загрузки врачей");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!successMessage) return;
    const t = window.setTimeout(() => setSuccessMessage(null), 2800);
    return () => window.clearTimeout(t);
  }, [successMessage]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingDoctorId(null);
    setFormState(initialFormState);
    setFormError(null);
  };

  const openCreate = () => {
    setEditingDoctorId(null);
    setFormState(initialFormState);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (doctor: Doctor) => {
    setEditingDoctorId(doctor.id);
    setFormState({
      name: doctor.name,
      speciality: doctor.speciality,
      percent: String(doctor.percent),
      phone: storedPhoneToNormalized(doctor.phone),
      birthDate: doctor.birth_date ?? "",
      active: doctor.active,
      serviceIds: doctor.serviceIds ?? [],
    });
    setFormError(null);
    setModalOpen(true);
  };

  const validateForm = (): string | null => {
    const name = formState.name.trim();
    const speciality = formState.speciality.trim();
    const percent = Number(formState.percent);
    if (!name) return "Укажите ФИО врача.";
    if (!speciality) return "Укажите специальность.";
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return "Процент должен быть числом от 0 до 100.";
    }
    return null;
  };

  const saveDoctor = async () => {
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        name: formState.name.trim(),
        speciality: formState.speciality.trim(),
        percent: Number(formState.percent),
        phone: (() => {
          const apiPhone = phoneToApiValue(formState.phone);
          const digits = apiPhone.replace(/\D/g, "");
          return digits.length >= 10 ? apiPhone : null;
        })(),
        birth_date: formState.birthDate || null,
        active: formState.active,
        serviceIds: formState.serviceIds,
      };
      const isEdit = Boolean(editingDoctorId);
      if (isEdit) {
        await requestJson<Doctor>(`/api/doctors/${editingDoctorId}`, { method: "PUT", body: payload });
      } else {
        await requestJson<Doctor>("/api/doctors", { method: "POST", body: payload });
      }
      closeModal();
      await loadData();
      setSuccessMessage(isEdit ? "Врач обновлён." : "Врач добавлен.");
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDoctorActive = async (doctor: Doctor) => {
    if (isDeletingId !== null) return;
    const confirmed = window.confirm(
      doctor.active
        ? `Деактивировать врача «${doctor.name}»?`
        : `Активировать врача «${doctor.name}»?`
    );
    if (!confirmed) return;

    setIsDeletingId(doctor.id);
    setError(null);
    try {
      if (doctor.active) {
        await requestJson<{ success: true }>(`/api/doctors/${doctor.id}`, { method: "DELETE" });
      } else {
        await requestJson<Doctor>(`/api/doctors/${doctor.id}`, {
          method: "PUT",
          body: { active: true },
        });
      }
      await loadData();
      setSuccessMessage(doctor.active ? "Врач деактивирован." : "Врач активирован.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка обновления статуса");
    } finally {
      setIsDeletingId(null);
    }
  };

  const busy = loading || isSaving || isDeletingId !== null;
  const serviceNameById = React.useMemo(
    () => Object.fromEntries(services.map((service) => [service.id, service.name])),
    [services]
  );

  return (
    <div className="page-enter space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-[#0f172a]">Врачи</h2>
          <p className="mt-1 text-sm text-[#64748b]">
            Управление персоналом клиники, услугами и процентами выплат.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-5 text-sm font-semibold text-white shadow-[0_4px_14px_-6px_rgba(22,163,74,0.45)] transition duration-200 hover:bg-[#22c55e] hover:shadow-[0_6px_20px_-8px_rgba(22,163,74,0.5)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={openCreate}
            disabled={busy}
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Добавить врача
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]">
          {successMessage}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#64748b] shadow-sm">
          Загрузка врачей...
        </div>
      ) : doctors.length === 0 ? (
        <ListEmptyState
          icon={Stethoscope}
          title="Пока нет врачей"
          description="Добавьте врачей в справочник, чтобы назначать услуги и вести записи."
          actionLabel="Добавить"
          onAction={openCreate}
          showAction={canManage}
          actionDisabled={busy}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {doctors.map((doctor) => (
            <li key={doctor.id}>
              <article className="group rounded-[14px] border border-[#e2e8f0] bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-18px_rgba(15,23,42,0.18)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[#0f172a]">{doctor.name}</h3>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#64748b]">
                      <Stethoscope className="h-3.5 w-3.5 text-[#94a3b8]" strokeWidth={1.75} />
                      {doctor.speciality}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      doctor.active
                        ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
                        : "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
                    }`}
                  >
                    {doctor.active ? "Активен" : "Не активен"}
                  </span>
                </div>

                <div className="mt-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-[#94a3b8]">Процент врача</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[#0f172a]">{doctor.percent}%</p>
                </div>

                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-[#94a3b8]">Услуги</p>
                  <DoctorServicesChips
                    doctorId={doctor.id}
                    serviceIds={doctor.serviceIds ?? []}
                    serviceNameById={serviceNameById}
                  />
                </div>

                {canManage && (
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#f1f5f9] pt-3">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center rounded-lg border border-[#e2e8f0] bg-white px-2.5 text-xs font-medium text-[#0f172a] transition hover:bg-[#f1f5f9] disabled:opacity-50"
                      onClick={() => openEdit(doctor)}
                      disabled={busy}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition disabled:opacity-50 ${
                        doctor.active
                          ? "border border-[#fecaca] bg-[#fef2f2] text-[#991b1b] hover:bg-[#fee2e2]"
                          : "border border-[#bbf7d0] bg-[#f0fdf4] text-[#166534] hover:bg-[#dcfce7]"
                      }`}
                      onClick={() => void handleToggleDoctorActive(doctor)}
                      disabled={busy}
                    >
                      {isDeletingId === doctor.id ? "..." : doctor.active ? "Деактивировать" : "Активировать"}
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
          className="w-full max-w-2xl rounded-[20px] border border-[#e2e8f0] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.22)]"
        >
            <h3 className="text-lg font-semibold text-[#0f172a]">
              {editingDoctorId ? "Редактировать врача" : "Добавить врача"}
            </h3>
            {formError && (
              <div className="mt-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]">
                {formError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-sm text-[#334155]">
                Имя *
                <input
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  aria-label="Имя врача"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                Специальность *
                <input
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.speciality}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, speciality: event.target.value }))
                  }
                  aria-label="Специальность"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                Процент (0-100) *
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.percent}
                  onChange={(event) => setFormState((prev) => ({ ...prev, percent: event.target.value }))}
                  aria-label="Процент"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                Телефон
                <PhoneInput
                  defaultCountry998Prefix={false}
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.phone}
                  onChange={(normalized) => setFormState((prev) => ({ ...prev, phone: normalized }))}
                  placeholder="+998 90 123 45 67"
                  aria-label="Телефон врача"
                  disabled={isSaving}
                />
              </label>
              <label className="text-sm text-[#334155]">
                Дата рождения
                <input
                  type="date"
                  className="mt-1 h-11 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-1 focus:ring-[#16a34a]/25"
                  value={formState.birthDate}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, birthDate: event.target.value }))
                  }
                  aria-label="Дата рождения врача"
                  disabled={isSaving}
                />
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm text-[#334155]">
                <input
                  type="checkbox"
                  checked={formState.active}
                  onChange={(event) => setFormState((prev) => ({ ...prev, active: event.target.checked }))}
                  disabled={isSaving}
                  className="h-4 w-4 rounded border-[#cbd5e1] text-[#16a34a] focus:ring-[#16a34a]/30"
                />
                Активен
              </label>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-[#334155]">Услуги (multi-select)</p>
              <div className="mt-2">
                <MultiSelect
                  options={services}
                  value={formState.serviceIds}
                  onChange={(next) => setFormState((prev) => ({ ...prev, serviceIds: next }))}
                  labelKey="name"
                  placeholder="Найти услугу..."
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#0f172a] transition hover:bg-[#f1f5f9] disabled:opacity-50"
                onClick={closeModal}
                disabled={isSaving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#16a34a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#22c55e] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void saveDoctor()}
                disabled={isSaving}
              >
                {isSaving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
};
