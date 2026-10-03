import React from "react";
import { Copy, ExternalLink, KeyRound, Pencil, Plus, Trash2, Tv, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestJson } from "../../../api/http";
import { queueApi } from "../api/queueApi";
import type { QueueDisplay } from "../api/queueTypes";
import { DISPLAY_LANGUAGE_KEYS, DisplayFormModal, type DisplayDoctor } from "./DisplayFormModal";

/** A code is known only right after create / rotate-code: the API stores just its hash. */
type RevealedCode = { displayId: number; name: string; code: string };

const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const chip = "rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600";

/** Superadmin panel on the Queue page: TV screens list, create/edit, one-time code, new code, delete. */
export function DisplaysPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [displays, setDisplays] = React.useState<QueueDisplay[]>([]);
  const [doctors, setDoctors] = React.useState<DisplayDoctor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ display: QueueDisplay | null } | null>(null);
  const [revealed, setRevealed] = React.useState<RevealedCode | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      queueApi.listDisplays(),
      // Doctors only feed names and the "no cabinet" warning: their failure must not hide the screens.
      requestJson<DisplayDoctor[]>("/api/doctors").catch(() => [] as DisplayDoctor[]),
    ])
      .then(([list, doctorRows]) => {
        if (cancelled) return;
        setDisplays(list);
        setDoctors(doctorRows);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : t("queue.displays.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const doctorNames = (ids: number[] | null): string =>
    ids === null
      ? t("queue.displays.allDoctors")
      : ids.map((id) => doctors.find((doctor) => doctor.id === id)?.name ?? `#${id}`).join(", ");

  const reveal = (display: QueueDisplay, code: string) => {
    setRevealed({ displayId: display.id, name: display.name, code });
    setCopyState("idle");
  };

  const rotate = async (display: QueueDisplay) => {
    if (busyId !== null || !window.confirm(t("queue.displays.confirmRotate", { name: display.name }))) return;
    setBusyId(display.id);
    setError(null);
    try {
      const result = await queueApi.rotateCode(display.id);
      setDisplays((prev) => prev.map((row) => (row.id === result.display.id ? result.display : row)));
      reveal(result.display, result.code);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.actionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (display: QueueDisplay) => {
    if (busyId !== null || !window.confirm(t("queue.displays.confirmDelete", { name: display.name }))) return;
    setBusyId(display.id);
    setError(null);
    try {
      await queueApi.deleteDisplay(display.id);
      setDisplays((prev) => prev.filter((row) => row.id !== display.id));
      setRevealed((current) => (current?.displayId === display.id ? null : current));
      setNotice(t("queue.displays.deleted"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("queue.displays.actionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const origin = window.location.origin;
  const link = revealed ? `${origin}/tv/${revealed.code}` : "";

  const copyLink = async () => {
    try {
      // Clipboard needs a secure context (https or localhost); otherwise the link stays selectable below.
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
      aria-labelledby="queue-displays-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Tv className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="queue-displays-title" className="text-base font-semibold text-slate-900">
              {t("queue.displays.title")}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{t("queue.displays.subtitle")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditor({ display: null })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("queue.displays.add")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {revealed ? (
        <div data-reload-hold className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-emerald-900">{t("queue.displays.codeTitle", { name: revealed.name })}</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-[0.18em] text-slate-900">{revealed.code}</p>
          <p className="mt-2 text-xs text-emerald-900/80">{t("queue.displays.codeHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={link}
              aria-label={t("queue.displays.linkLabel")}
              onFocus={(event) => event.target.select()}
              className="h-9 min-w-[14rem] flex-1 rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-slate-800"
            />
            <button type="button" onClick={() => void copyLink()} className={secondaryButton}>
              <Copy className="h-4 w-4" aria-hidden />
              {t("queue.displays.copyLink")}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("queue.displays.openScreen")}
            </a>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              {t("queue.displays.done")}
            </button>
          </div>
          {copyState === "copied" ? (
            <p className="mt-2 text-xs text-emerald-800">{t("queue.displays.copied")}</p>
          ) : copyState === "failed" ? (
            <p className="mt-2 text-xs text-rose-700">{t("queue.displays.copyFailed")}</p>
          ) : null}
        </div>
      ) : null}

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
          {[0, 1].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : displays.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {t("queue.displays.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {displays.map((display) => (
            <li
              key={display.id}
              className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{display.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{doctorNames(display.doctorIds)}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  <span className={chip}>{t(DISPLAY_LANGUAGE_KEYS[display.language])}</span>
                  <span className={chip}>{display.showNames ? t("queue.displays.namesOn") : t("queue.displays.namesOff")}</span>
                  <span className={chip}>{display.voiceEnabled ? t("queue.displays.voiceOn") : t("queue.displays.voiceOff")}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditor({ display })}
                  disabled={busyId !== null}
                  className={secondaryButton}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => void rotate(display)}
                  disabled={busyId !== null}
                  className={secondaryButton}
                >
                  <KeyRound className="h-4 w-4" aria-hidden />
                  {t("queue.displays.rotate")}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(display)}
                  disabled={busyId !== null}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">{t("queue.displays.tvHint", { url: `${origin}/tv` })}</p>

      {editor ? (
        <DisplayFormModal
          display={editor.display}
          doctors={doctors}
          onClose={() => setEditor(null)}
          onSaved={(saved, code) => {
            setEditor(null);
            setDisplays((prev) =>
              prev.some((row) => row.id === saved.id)
                ? prev.map((row) => (row.id === saved.id ? saved : row))
                : [...prev, saved]
            );
            if (code) reveal(saved, code);
            else setNotice(t("queue.displays.saved"));
          }}
        />
      ) : null}
    </section>
  );
}
