import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../components/ui/Modal";
import { MoneyInput } from "../../../shared/ui/MoneyInput";
import { modalInputClass, modalLabelClass } from "../../appointments/utils/modalFieldClasses";
import type { OwnServiceInput } from "../api/myServicesApi";

const MAX_NAME_LENGTH = 200;
const MAX_DURATION_MINUTES = 24 * 60;

type Props = {
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: OwnServiceInput) => void;
};

export const CreateOwnServiceModal: React.FC<Props> = ({ saving, error, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState(0);
  const [duration, setDuration] = React.useState("30");
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const minutes = Number(duration);
    if (!trimmed) {
      setFormError(t("services.errors.nameRequired"));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError(t("services.errors.priceInvalid"));
      return;
    }
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
      setFormError(t("services.errors.durationInvalid"));
      return;
    }
    setFormError(null);
    onSubmit({ name: trimmed, price: Math.round(price), duration: minutes });
  };

  const shownError = formError ?? error;

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      className="w-[min(440px,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <form onSubmit={submit} aria-labelledby="own-service-title" noValidate>
        <header className="border-b border-slate-100 px-5 py-4">
          <h2 id="own-service-title" className="text-base font-semibold text-slate-900">
            {t("myServices.createTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{t("myServices.createHint")}</p>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label htmlFor="own-service-name" className={modalLabelClass}>
              {t("services.name")}
            </label>
            <input
              id="own-service-name"
              className={modalInputClass}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="own-service-price" className={modalLabelClass}>
                {t("services.price")}
              </label>
              <MoneyInput
                id="own-service-price"
                mode="integer"
                className={modalInputClass}
                value={price}
                onChange={setPrice}
                disabled={saving}
              />
            </div>
            <div>
              <label htmlFor="own-service-duration" className={modalLabelClass}>
                {t("services.durationLabel")}
              </label>
              <input
                id="own-service-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_DURATION_MINUTES}
                step={5}
                className={modalInputClass}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          {shownError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
              {shownError}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("myServices.createSubmit")}
          </button>
        </footer>
      </form>
    </Modal>
  );
};
