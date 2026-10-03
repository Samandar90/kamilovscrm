import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../ui/Modal";
import {
  modalHintClass,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
} from "../../appointments/utils/modalFieldClasses";
import { leadsApi } from "../api/leadsApi";
import type { LeadMarketerOption, LeadSource, LeadSourcePatch } from "../api/leadsTypes";

const NAME_MAX = 100;
const SHEET_URL_MAX = 500;

type Props = {
  /** null — a new source. */
  source: LeadSource | null;
  /** Active contractor accounts of the clinic. */
  marketers: LeadMarketerOption[];
  onClose: () => void;
  onSaved: (source: LeadSource) => void;
};

const marketerLabel = (marketer: LeadMarketerOption): string =>
  marketer.fullName && marketer.fullName !== marketer.username
    ? `${marketer.fullName} (${marketer.username})`
    : marketer.username;

/** Name, contractor and sheet link of a lead source. The link is parsed by the API: a refusal is shown as it came. */
export function LeadSourceFormModal({ source, marketers, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(source?.name ?? "");
  const [marketerId, setMarketerId] = React.useState<number | null>(source?.marketerUserId ?? null);
  const [sheetUrl, setSheetUrl] = React.useState(source?.sheetUrl ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The bound account may have been switched off since: it stays in the list instead of turning into «не привязан».
  const boundId = source?.marketerUserId ?? null;
  const boundMissing = boundId !== null && !marketers.some((marketer) => marketer.id === boundId);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("leads.sources.form.nameRequired"));
      return;
    }
    const link = sheetUrl.trim() || null;
    // Only what changed: an untouched contractor is not checked again, an untouched link does not reset the columns.
    const patch: LeadSourcePatch = {};
    if (source) {
      if (trimmed !== source.name) patch.name = trimmed;
      if (marketerId !== source.marketerUserId) patch.marketerUserId = marketerId;
      if (link !== source.sheetUrl) patch.sheetUrl = link;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        source
          ? await leadsApi.updateSource(source.id, patch)
          : await leadsApi.createSource({ name: trimmed, marketerUserId: marketerId, sheetUrl: link })
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("leads.sources.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(94dvh,780px)] w-[min(560px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="lead-source-form-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="lead-source-form-title" className="text-base font-semibold text-slate-900">
            {source ? t("leads.sources.form.editTitle") : t("leads.sources.form.createTitle")}
          </h2>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="lead-source-name" className={modalLabelClass}>
              {t("leads.sources.form.name")}
            </label>
            <input
              id="lead-source-name"
              className={modalInputClass}
              value={name}
              maxLength={NAME_MAX}
              placeholder={t("leads.sources.form.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="lead-source-marketer" className={modalLabelClass}>
              {t("leads.sources.form.marketer")}
            </label>
            <select
              id="lead-source-marketer"
              className={modalSelectClass}
              value={marketerId === null ? "" : String(marketerId)}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMarketerId(Number.isInteger(value) && value > 0 ? value : null);
              }}
              disabled={saving}
            >
              <option value="">{t("leads.sources.notBound")}</option>
              {boundMissing ? <option value={String(boundId)}>{source?.marketerName ?? `#${boundId}`}</option> : null}
              {marketers.map((marketer) => (
                <option key={marketer.id} value={String(marketer.id)}>
                  {marketerLabel(marketer)}
                </option>
              ))}
            </select>
            <p className={modalHintClass}>{t("leads.sources.form.marketerHint")}</p>
          </div>

          <div>
            <label htmlFor="lead-source-sheet" className={modalLabelClass}>
              {t("leads.sources.form.sheet")}
            </label>
            <input
              id="lead-source-sheet"
              className={modalInputClass}
              value={sheetUrl}
              maxLength={SHEET_URL_MAX}
              inputMode="url"
              autoComplete="off"
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(event) => setSheetUrl(event.target.value)}
              disabled={saving}
            />
            <p className={modalHintClass}>{t("leads.sources.form.sheetHint")}</p>
          </div>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
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
            disabled={saving}
            className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
