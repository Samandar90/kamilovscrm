import React from "react";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import { appointmentsFlowApi, type Appointment, type Service } from "../api/appointmentsFlowApi";
import { catalogPrice, toServiceLineInputs, type ServiceLineDraft } from "../utils/serviceLines";
import { ServiceLinesPicker } from "./ServiceLinesPicker";

type Props = {
  appointment: Appointment;
  token: string;
  canEditPrices: boolean;
  onClose: () => void;
  onSaved: (updated: Appointment) => void;
};

/** Changes the services of a booked visit (PUT /appointments/:id/services). */
export const AppointmentServicesModal: React.FC<Props> = ({
  appointment,
  token,
  canEditPrices,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [services, setServices] = React.useState<Service[]>([]);
  const [lines, setLines] = React.useState<ServiceLineDraft[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const knownNames = React.useMemo(
    () => Object.fromEntries((appointment.services ?? []).map((line) => [line.serviceId, line.name])),
    [appointment.services]
  );

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      appointmentsFlowApi.listServices(token, appointment.doctorId),
      appointmentsFlowApi.listAppointmentAssignedServices(token, appointment.id),
    ])
      .then(([doctorServices, booked]) => {
        if (cancelled) return;
        setServices(doctorServices);
        if (booked.length > 0) {
          setLines(booked.map((line) => ({ serviceId: line.serviceId, price: Math.round(line.price) })));
          return;
        }
        // Legacy visits without service lines: start from the booked primary service.
        const primary = doctorServices.find((service) => service.id === appointment.serviceId);
        const price = appointment.price ?? (primary ? catalogPrice(primary) : 0);
        setLines([{ serviceId: appointment.serviceId, price: Math.round(price) }]);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : t("serviceLines.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, appointment.id, appointment.doctorId, appointment.serviceId, appointment.price, t]);

  const save = async () => {
    if (lines.length === 0) {
      setError(t("serviceLines.empty"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await appointmentsFlowApi.replaceAppointmentServices(
        token,
        appointment.id,
        toServiceLineInputs(lines, canEditPrices)
      );
      onSaved(updated);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("serviceLines.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(88dvh,640px)] w-[min(480px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="appointment-services-title" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-800">
            <ListChecks className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="appointment-services-title" className="text-base font-semibold text-slate-900">
              {t("serviceLines.editTitle")}
            </h2>
            <p className="mt-0.5 text-xs leading-snug text-slate-500">{t("serviceLines.editSubtitle")}</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ServiceLinesPicker
            id="appointment-services"
            services={services}
            lines={lines}
            onChange={setLines}
            canEditPrice={canEditPrices}
            disabled={saving}
            hint={loading ? t("appointments.loadingServices") : null}
            knownNames={knownNames}
          />
          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || lines.length === 0}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
};
