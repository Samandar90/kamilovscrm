import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Service } from "../api/appointmentsFlowApi";
import { MoneyInput } from "../../../shared/ui/MoneyInput";
import { formatSum } from "../../../utils/formatMoney";
import { modalSelectClassInline } from "../utils/modalFieldClasses";
import {
  catalogPrice,
  draftLineFor,
  totalDurationMinutes,
  totalPrice,
  type ServiceLineDraft,
} from "../utils/serviceLines";

type Props = {
  id: string;
  /** Services the doctor offers — the only ones that can be added. */
  services: Service[];
  lines: ServiceLineDraft[];
  onChange: (lines: ServiceLineDraft[]) => void;
  canEditPrice: boolean;
  disabled?: boolean;
  /** Replaces the add control, e.g. "select a doctor first" or "loading". */
  hint?: string | null;
  /** Names of booked services the doctor no longer offers (editing an existing visit). */
  knownNames?: Record<number, string>;
  selectClassName?: string;
};

/** Multi-service selection for a visit: the first line is the primary service. */
export const ServiceLinesPicker: React.FC<Props> = ({
  id,
  services,
  lines,
  onChange,
  canEditPrice,
  disabled = false,
  hint = null,
  knownNames = {},
  selectClassName = modalSelectClassInline,
}) => {
  const { t } = useTranslation();
  const servicesById = React.useMemo(
    () => Object.fromEntries(services.map((service) => [service.id, service])) as Record<number, Service>,
    [services]
  );
  const selectedIds = new Set(lines.map((line) => line.serviceId));
  const addable = services.filter((service) => !selectedIds.has(service.id));
  const duration = totalDurationMinutes(lines, servicesById);
  // Booked services the doctor no longer offers have no known duration here; the API knows it.
  const durationIsPartial = lines.some((line) => !servicesById[line.serviceId]);

  const addService = (serviceId: number) => {
    const service = servicesById[serviceId];
    if (service && !selectedIds.has(serviceId)) onChange([...lines, draftLineFor(service)]);
  };
  const removeService = (serviceId: number) => onChange(lines.filter((line) => line.serviceId !== serviceId));
  const setPrice = (serviceId: number, price: number) =>
    onChange(lines.map((line) => (line.serviceId === serviceId ? { ...line, price } : line)));

  return (
    <div className="space-y-2">
      {hint ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-sm text-slate-500">{hint}</p>
      ) : (
        <select
          id={id}
          className={selectClassName}
          value=""
          disabled={disabled || addable.length === 0}
          aria-label={t("serviceLines.add")}
          onChange={(event) => addService(Number(event.target.value))}
        >
          <option value="">
            {addable.length === 0 ? t("serviceLines.allAdded") : `+ ${t("serviceLines.add")}`}
          </option>
          {addable.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} · {t("serviceLines.minutes", { count: service.duration })} ·{" "}
              {formatSum(catalogPrice(service))}
            </option>
          ))}
        </select>
      )}

      {lines.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {lines.map((line, index) => {
            const service = servicesById[line.serviceId];
            const name = service?.name ?? knownNames[line.serviceId] ?? `#${line.serviceId}`;
            return (
              <li key={line.serviceId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900" title={name}>
                    {name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {index === 0 ? (
                      <span className="mr-1.5 rounded-full bg-emerald-50 px-1.5 py-px font-semibold text-emerald-700">
                        {t("serviceLines.primary")}
                      </span>
                    ) : null}
                    {service
                      ? t("serviceLines.minutes", { count: service.duration })
                      : t("serviceLines.notOffered")}
                  </p>
                </div>
                {canEditPrice ? (
                  <MoneyInput
                    id={`${id}-price-${line.serviceId}`}
                    mode="integer"
                    value={line.price}
                    onChange={(next) => setPrice(line.serviceId, next)}
                    disabled={disabled}
                    className="h-9 w-32 rounded-lg border border-slate-200 bg-white px-2.5 text-right text-sm text-slate-900 outline-none transition focus:border-emerald-500/55 focus:ring-2 focus:ring-emerald-500/20"
                  />
                ) : (
                  <span className="text-sm font-medium text-slate-700">{formatSum(line.price)}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeService(line.serviceId)}
                  disabled={disabled}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  aria-label={t("serviceLines.remove", { name })}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {lines.length > 0 ? (
        <p className="flex justify-between text-xs font-medium text-slate-600">
          <span>
            {t("serviceLines.total")}:{" "}
            {t(durationIsPartial ? "serviceLines.minutesAtLeast" : "serviceLines.minutes", { count: duration })}
          </span>
          <span>{formatSum(totalPrice(lines))}</span>
        </p>
      ) : null}
    </div>
  );
};
