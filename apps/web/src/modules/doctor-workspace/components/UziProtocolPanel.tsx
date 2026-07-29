import React from "react";
import { FileText, Printer, RotateCcw, X } from "lucide-react";
import {
  UZI_CATEGORY_LABELS,
  uziTemplatesApi,
  type UziTemplateCategory,
  type UziTemplateSummary,
} from "../api/uziTemplatesApi";
import { UZI_EDITOR_CSS, UZI_PRINT_CSS, buildUziProtocolCss } from "./uziProtocolStyles";

type Props = {
  token: string | null;
  doctorId: number | null;
  appointmentId: number;
  patientName: string;
  patientBirth: string | null;
  clinicName: string;
  clinicLogoUrl: string;
  primaryColor: string;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const draftKey = (appointmentId: number, templateId: string): string =>
  `uzi-draft:${appointmentId}:${templateId}`;

const formatBirth = (raw: string | null): string => {
  if (!raw) return "";
  const parsed = new Date(raw.includes(" ") ? raw.replace(" ", "T") : raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("ru-RU");
};

const CATEGORY_ORDER: UziTemplateCategory[] = [
  "obstetrics",
  "gynecology",
  "breast",
  "urology",
  "abdomen",
  "thyroid",
];

export const UziProtocolPanel: React.FC<Props> = ({
  token,
  doctorId,
  appointmentId,
  patientName,
  patientBirth,
  clinicName,
  clinicLogoUrl,
  primaryColor,
}) => {
  const [enabled, setEnabled] = React.useState(false);
  const [templates, setTemplates] = React.useState<UziTemplateSummary[]>([]);
  const [activeId, setActiveId] = React.useState<string>("");
  const [activeTitle, setActiveTitle] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const editorRef = React.useRef<HTMLDivElement | null>(null);
  /** Исходный HTML шаблона — для кнопки «Сбросить». */
  const pristineRef = React.useRef<string>("");

  const css = React.useMemo(() => buildUziProtocolCss(primaryColor), [primaryColor]);

  const headerHtml = React.useMemo(
    () => `
    <div class="uzi-head" contenteditable="false">
      <img src="${escapeHtml(clinicLogoUrl)}" alt="" />
      <div class="uzi-head-text">
        <div class="uzi-clinic">${escapeHtml(clinicName)}</div>
        <div class="uzi-clinic-sub">Ультразвуковая диагностика</div>
      </div>
    </div>`,
    [clinicLogoUrl, clinicName]
  );

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  React.useEffect(() => {
    if (!token || !doctorId) {
      setEnabled(false);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const response = await uziTemplatesApi.list(token, doctorId);
        if (!mounted) return;
        setEnabled(response.enabled);
        setTemplates(response.templates);
      } catch {
        if (mounted) setEnabled(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token, doctorId]);

  const fillPlaceholders = React.useCallback(
    (html: string): string =>
      html
        .replace(/\{\{patientName\}\}/g, escapeHtml(patientName))
        .replace(/\{\{patientBirth\}\}/g, escapeHtml(formatBirth(patientBirth)))
        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("ru-RU")),
    [patientName, patientBirth]
  );

  const openTemplate = async (templateId: string) => {
    if (!token || !doctorId || !templateId) return;
    setLoading(true);
    setError(null);
    try {
      const template = await uziTemplatesApi.getById(token, doctorId, templateId);
      const filled = fillPlaceholders(template.html);
      pristineRef.current = filled;

      const saved = window.localStorage.getItem(draftKey(appointmentId, templateId));
      const body = saved ?? filled;

      setActiveId(templateId);
      setActiveTitle(template.title);
      // innerHTML ставим императивно: contenteditable нельзя перерисовывать из React —
      // иначе каретка прыгает и правки теряются.
      window.requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = headerHtml + body;
        }
      });
      if (saved) setNotice("Восстановлен сохранённый черновик");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось загрузить протокол"
      );
    } finally {
      setLoading(false);
    }
  };

  /** Тело без «шапки»: шапка добавляется заново при каждом открытии. */
  const readBody = (): string => {
    const root = editorRef.current;
    if (!root) return "";
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelector(".uzi-head")?.remove();
    return clone.innerHTML;
  };

  const saveDraft = React.useCallback(() => {
    if (!activeId) return;
    const body = readBody();
    if (!body) return;
    try {
      window.localStorage.setItem(draftKey(appointmentId, activeId), body);
    } catch {
      /* localStorage может быть переполнен — не мешаем работе врача */
    }
  }, [activeId, appointmentId]);

  React.useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(saveDraft, 5000);
    return () => {
      window.clearInterval(timer);
      saveDraft();
    };
  }, [activeId, saveDraft]);

  const resetToTemplate = () => {
    if (!editorRef.current || !activeId) return;
    editorRef.current.innerHTML = headerHtml + pristineRef.current;
    try {
      window.localStorage.removeItem(draftKey(appointmentId, activeId));
    } catch {
      /* игнорируем */
    }
    setNotice("Возвращён исходный бланк");
  };

  const closeTemplate = () => {
    saveDraft();
    setActiveId("");
    setActiveTitle("");
    if (editorRef.current) editorRef.current.innerHTML = "";
  };

  const print = () => {
    const root = editorRef.current;
    if (!root) return;
    saveDraft();
    const win = window.open("", "_blank");
    if (!win) {
      setError("Браузер заблокировал окно печати — разрешите всплывающие окна");
      return;
    }
    const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(activeTitle)} — ${escapeHtml(patientName)}</title>
    <style>${css}${UZI_PRINT_CSS}</style>
  </head>
  <body>
    <div class="uzi-sheet">${root.innerHTML}</div>
  </body>
</html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Даём логотипу догрузиться, иначе печать уходит без картинки.
    window.setTimeout(() => win.print(), 350);
  };

  if (!enabled) return null;

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: templates.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="space-y-2">
      <style>{UZI_EDITOR_CSS}</style>
      <style>{css}</style>

      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-900">Протоколы УЗИ</h2>
      </div>

      <select
        value={activeId}
        onChange={(e) => void openTemplate(e.target.value)}
        disabled={loading}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none"
      >
        <option value="">Выберите протокол…</option>
        {grouped.map((group) => (
          <optgroup key={group.category} label={UZI_CATEGORY_LABELS[group.category]}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {loading ? <p className="text-sm text-slate-500">Загрузка бланка…</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {notice ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}

      {activeId ? (
        <>
          <p className="text-xs text-slate-500">
            Бланк редактируется прямо на странице — можно менять любой текст, цифры и строки
            заключения. Черновик сохраняется автоматически.
          </p>

          <div className="uzi-editor-scroll">
            <div
              ref={editorRef}
              className="uzi-sheet uzi-editor-page"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={saveDraft}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={print}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white"
            >
              <Printer className="h-4 w-4" />
              Печать
            </button>
            <button
              type="button"
              onClick={resetToTemplate}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
            >
              <RotateCcw className="h-4 w-4" />
              Сбросить
            </button>
            <button
              type="button"
              onClick={closeTemplate}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
            >
              <X className="h-4 w-4" />
              Закрыть
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};
