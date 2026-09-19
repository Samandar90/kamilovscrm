import React from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import { formatSum } from "../../../utils/formatMoney";
import type { Service } from "../../appointments/api/appointmentsFlowApi";
import { catalogPrice } from "../../appointments/utils/serviceLines";

type Props = {
  services: Service[];
  busyId: number | null;
  onClose: () => void;
  onAdd: (serviceId: number) => void;
};

export const AddFromCatalogModal: React.FC<Props> = ({ services, busyId, onClose, onAdd }) => {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? services.filter((service) => service.name.toLowerCase().includes(normalized))
    : services;

  return (
    <Modal
      isOpen
      onClose={onClose}
      className="flex max-h-[min(85dvh,620px)] w-[min(480px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="catalog-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="catalog-title" className="text-base font-semibold text-slate-900">
            {t("myServices.catalogTitle")}
          </h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("myServices.searchPlaceholder")}
              aria-label={t("myServices.searchPlaceholder")}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500/55 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-slate-500">
              {services.length === 0 ? t("myServices.catalogEmpty") : t("myServices.noMatches")}
            </li>
          ) : (
            visible.map((service) => (
              <li key={service.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{service.name}</p>
                  <p className="text-xs text-slate-500">
                    {t("serviceLines.minutes", { count: service.duration })} · {formatSum(catalogPrice(service))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(service.id)}
                  disabled={busyId !== null}
                  className="h-9 shrink-0 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyId === service.id ? t("common.saving") : t("common.add")}
                </button>
              </li>
            ))
          )}
        </ul>
        <footer className="flex shrink-0 justify-end border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </Modal>
  );
};
