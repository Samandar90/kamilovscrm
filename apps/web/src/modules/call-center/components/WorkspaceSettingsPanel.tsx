import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Eye, Save, SlidersHorizontal } from "lucide-react";
import { workspaceApi, type Counts, type WorkspaceSettings } from "../api/workspaceApi";

export function WorkspaceSettingsPanel({ settings, onSaved, onDirty }: {
  settings: WorkspaceSettings; onSaved: (settings: WorkspaceSettings) => void; onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(settings);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [preview, setPreview] = React.useState<Counts | null>(null);
  const [saved, setSaved] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  React.useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  React.useEffect(() => () => onDirty(false), [onDirty]);
  const change = <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value })); setPreview(null); setSaved(false);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const value = await workspaceApi.saveSettings(draft); setDraft(value); onSaved(value); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : t("callWorkspace.saveError")); }
    finally { setBusy(false); }
  };
  const showPreview = async () => {
    setBusy(true); setError("");
    try { setPreview(await workspaceApi.preview(draft)); }
    catch (e) { setError(e instanceof Error ? e.message : t("callWorkspace.saveError")); }
    finally { setBusy(false); }
  };
  return <form className="cc-settings" onSubmit={(e) => void submit(e)}>
    <header className="cc-section-heading"><div><span className="cc-eyebrow">{t("callWorkspace.clinicSettings")}</span><h2>{t("callWorkspace.settingsTitle")}</h2><p>{t("callWorkspace.settingsHint")}</p></div><SlidersHorizontal size={24} /></header>
    <fieldset disabled={busy}>
      <legend>{t("callWorkspace.campaigns")}</legend>
      <div className="cc-campaign-grid">{(["recall", "followup", "reminder"] as const).map((campaign) => {
        const enabledKey = `${campaign}Enabled` as const;
        const daysKey = `${campaign}Days` as const;
        return <section className={`cc-campaign-card ${draft[enabledKey] ? "is-enabled" : ""}`} key={campaign}>
          <div className="cc-campaign-head"><h3>{t(`callWorkspace.segments.${campaign}`)}</h3>
            <label className="cc-switch"><input type="checkbox" checked={draft[enabledKey]} onChange={(e) => change(enabledKey, e.target.checked)} aria-label={t(`callWorkspace.segments.${campaign}`)} /><span /></label>
          </div><p>{t(`callWorkspace.campaignHints.${campaign}`)}</p>
          <label className="cc-field"><span>{t(`callWorkspace.dayLabels.${campaign}`)}</span><input type="number" min={campaign === "reminder" ? 0 : 1} max={campaign === "recall" ? 3650 : 365} required value={Number.isNaN(draft[daysKey]) ? "" : draft[daysKey]} onChange={(e) => change(daysKey, e.target.value === "" ? NaN : Number(e.target.value))} /></label>
          {preview && <div className="cc-preview-count"><strong>{preview[campaign]}</strong> {t("callWorkspace.matches")}</div>}
        </section>;
      })}</div>
    </fieldset>
    <div className="cc-settings-columns">
      <fieldset disabled={busy}><legend>{t("callWorkspace.retrySettings")}</legend><p className="cc-muted">{t("callWorkspace.retryHint")}</p>
        <div className="cc-form-grid">
          <label className="cc-field"><span>{t("callWorkspace.workStart")}</span><input type="time" required value={draft.workStart} onChange={(e) => change("workStart", e.target.value)} /></label>
          <label className="cc-field"><span>{t("callWorkspace.workEnd")}</span><input type="time" required value={draft.workEnd} onChange={(e) => change("workEnd", e.target.value)} /></label>
          <label className="cc-field"><span>{t("callWorkspace.retryMinutes")}</span><input type="number" min={5} max={10080} required value={Number.isNaN(draft.retryMinutes) ? "" : draft.retryMinutes} onChange={(e) => change("retryMinutes", e.target.value === "" ? NaN : Number(e.target.value))} /></label>
          <label className="cc-field"><span>{t("callWorkspace.maxAttempts")}</span><input type="number" min={1} max={20} required value={Number.isNaN(draft.maxAttempts) ? "" : draft.maxAttempts} onChange={(e) => change("maxAttempts", e.target.value === "" ? NaN : Number(e.target.value))} /></label>
        </div><p className="cc-help">{t("callWorkspace.timezone")}</p>
      </fieldset>
      <fieldset disabled={busy}><legend>{t("callWorkspace.script")}</legend><p className="cc-muted">{t("callWorkspace.scriptHint")}</p>
        <label className="cc-field"><span className="cc-sr-only">{t("callWorkspace.script")}</span><textarea rows={5} maxLength={4000} required value={draft.script} onChange={(e) => change("script", e.target.value)} /></label>
        <div className="cc-template-tokens">{["patient", "doctor", "lastVisit", "nextVisit"].map((key) => <button type="button" key={key} onClick={() => change("script", `${draft.script} {${key}}`)}>{`{${key}}`}</button>)}</div>
      </fieldset>
    </div>
    {error && <p className="cc-error" role="alert">{error}</p>}
    {saved && <p className="cc-success" role="status"><Check size={16} />{t("callWorkspace.settingsSaved")}</p>}
    <footer className="cc-settings-footer"><p>{t("callWorkspace.settingsScope")}</p><div>
      <button type="button" className="cc-btn" disabled={busy} onClick={() => void showPreview()}><Eye size={16} />{t("callWorkspace.preview")}</button>
      <button type="submit" className="cc-btn cc-btn-primary" disabled={busy || !dirty}><Save size={16} />{busy ? t("callWorkspace.saving") : t("callWorkspace.saveSettings")}</button>
    </div></footer>
  </form>;
}
