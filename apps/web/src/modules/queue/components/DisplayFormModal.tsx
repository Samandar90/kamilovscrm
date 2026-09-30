import React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../../ui/Modal";
import {
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
} from "../../appointments/utils/modalFieldClasses";
import { queueApi } from "../api/queueApi";
import type { QueueDisplay, QueueDisplayInput, QueueDisplayLanguage } from "../api/queueTypes";

/** Row of GET /api/doctors — only the fields the screen settings need. */
export type DisplayDoctor = { id: number; name: string; room?: string | null; active?: boolean };

const NAME_MAX = 100;

/** Literal keys (not a template literal) so `npm run check-i18n` verifies every one of them. */
export const DISPLAY_LANGUAGE_KEYS: Record<QueueDisplayLanguage, string> = {
  uz_ru: "queue.displays.languages.uz_ru",
  uz: "queue.displays.languages.uz",
  ru: "queue.displays.languages.ru",
};
const LANGUAGES: QueueDisplayLanguage[] = ["uz_ru", "uz", "ru"];

type Props = {
  /** null — a new screen. */
  display: QueueDisplay | null;
  doctors: DisplayDoctor[];
  onClose: () => void;
  /** `code` is the one-time screen code returned by create; null after an edit. */
  onSaved: (display: QueueDisplay, code: string | null) => void;
};

export function DisplayFormModal({ display, doctors, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(display?.name ?? "");
  const [pickDoctors, setPickDoctors] = React.useState(display?.doctorIds != null);
  const [selected, setSelected] = React.useState<number[]>(display?.doctorIds ?? []);
  const [showNames, setShowNames] = React.useState(display?.showNames ?? true);
  const [language, setLanguage] = React.useState<QueueDisplayLanguage>(display?.language ?? "uz_ru");
  const [voiceEnabled, setVoiceEnabled] = React.useState(display?.voiceEnabled ?? true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Inactive doctors are offered only when this screen already lists them.
  const choices = doctors.filter((doctor) => doctor.active !== false || selected.includes(doctor.id));
  const shown = pickDoctors
    ? choices.filter((doctor) => selected.includes(doctor.id))
    : doctors.filter((doctor) => doctor.active !== false);
  const withoutRoom = shown.filter((doctor) => !doctor.room?.trim());

  const toggleDoctor = (id: number, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev.filter((value) => value !== id), id] : prev.filter((value) => value !== id)));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("queue.displays.form.nameRequired"));
      return;
    }
    // Drop ids of doctors that no longer exist (the API rejects unknown doctors with 400); keep all if the list failed to load.
    const doctorIds = selected
      .filter((id) => doctors.length === 0 || doctors.some((doctor) => doctor.id === id))
      .sort((a, b) => a - b);
    if (pickDoctors && doctorIds.length === 0) {
      setError(t("queue.displays.form.doctorsRequired"));
      return;
    }
    const input: QueueDisplayInput = {
      name: trimmed,
      doctorIds: pickDoctors ? doctorIds : null,
      showNames,
      language,
      voiceEnabled,
    };
    setSaving(true);
    setError(null);
    try {
      if (display) {
        onSaved(await queueApi.updateDisplay(display.id, input), null);
      } else {
        const created = await queueApi.createDisplay(input);
        onSaved(created.display, created.code);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const checkboxClass = "h-4 w-4 accent-emerald-600";

  return (
    <Modal
      isOpen
      onClose={saving ? () => undefined : onClose}
      backdropClassName="modal-backdrop-enter fixed inset-0 bg-black/[0.12]"
      className="flex max-h-[min(94dvh,780px)] w-[min(560px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-20px_rgba(15,23,42,0.22)]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="queue-display-form-title" className="flex min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 id="queue-display-form-title" className="text-base font-semibold text-slate-900">
            {display ? t("queue.displays.form.editTitle") : t("queue.displays.form.createTitle")}
          </h2>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="queue-display-name" className={modalLabelClass}>
              {t("queue.displays.form.name")}
            </label>
            <input
              id="queue-display-name"
              className={modalInputClass}
              value={name}
              maxLength={NAME_MAX}
              placeholder={t("queue.displays.form.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
          </div>

          <fieldset className="space-y-2" disabled={saving}>
            <legend className={modalLabelClass}>{t("queue.displays.form.doctors")}</legend>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                id="queue-display-all-doctors"
                type="radio"
                name="queue-display-doctors"
                className={checkboxClass}
                checked={!pickDoctors}
                onChange={() => setPickDoctors(false)}
              />
              {t("queue.displays.form.allDoctors")}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                id="queue-display-pick-doctors"
                type="radio"
                name="queue-display-doctors"
                className={checkboxClass}
                checked={pickDoctors}
                onChange={() => setPickDoctors(true)}
              />
              {t("queue.displays.form.pickDoctors")}
            </label>
            {pickDoctors ? (
              choices.length ? (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
                  {choices.map((doctor) => (
                    <li key={doctor.id}>
                      <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={selected.includes(doctor.id)}
                          onChange={(event) => toggleDoctor(doctor.id, event.target.checked)}
                          aria-label={doctor.name}
                        />
                        <span className="min-w-0 flex-1 truncate">{doctor.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {doctor.room?.trim()
                            ? t("doctors.roomShort", { room: doctor.room.trim() })
                            : t("queue.displays.form.noRoom")}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">{t("queue.displays.form.noDoctors")}</p>
              )
            ) : null}
          </fieldset>

          {withoutRoom.length ? (
            <div
              className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              role="note"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {t("queue.displays.form.noRoomWarning", { names: withoutRoom.map((doctor) => doctor.name).join(", ") })}
              </span>
            </div>
          ) : null}

          <div>
            <label htmlFor="queue-display-language" className={modalLabelClass}>
              {t("queue.displays.form.language")}
            </label>
            <select
              id="queue-display-language"
              className={modalSelectClass}
              value={language}
              onChange={(event) => setLanguage(event.target.value as QueueDisplayLanguage)}
              disabled={saving}
            >
              {LANGUAGES.map((value) => (
                <option key={value} value={value}>
                  {t(DISPLAY_LANGUAGE_KEYS[value])}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              id="queue-display-show-names"
              type="checkbox"
              className={checkboxClass}
              checked={showNames}
              onChange={(event) => setShowNames(event.target.checked)}
              disabled={saving}
            />
            {t("queue.displays.form.showNames")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              id="queue-display-voice"
              type="checkbox"
              className={checkboxClass}
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
              disabled={saving}
            />
            {t("queue.displays.form.voice")}
          </label>

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
