import React from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Patient } from "../api/appointmentsFlowApi";
import { appointmentsFlowApi } from "../api/appointmentsFlowApi";
import { modalComboboxInputClass, modalComboboxWrapperClass } from "../utils/modalFieldClasses";

const DEBOUNCE_MS = 300;
/** Модалка `Modal.tsx` — контейнер z-[10000]; панель должна быть выше, иначе список не виден. */
const DROPDOWN_PORTAL_Z = 10_100;

const dropdownListClass =
  "max-h-56 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200/90 bg-white py-1.5 shadow-lg shadow-slate-900/15 ring-1 ring-slate-200/80";

function phoneLine(phone: string | null | undefined): string | null {
  if (!phone || phone.trim() === "") return null;
  return phone;
}

function secondaryLine(p: Patient, t: any): string {
  const tel = phoneLine(p.phone);
  if (tel) return tel;
  if (p.birthDate) return `${t("appointments.birthDate", { defaultValue: "Birth date" })}: ${p.birthDate}`;
  return `ID · #${p.id}`;
}

export type PatientAutocompleteInputProps = {
  id: string;
  query: string;
  selectedPatient: Patient | null;
  token: string | null;
  onQueryChange: (query: string) => void;
  onSelectPatient: (patient: Patient | null) => void;
  onCreateRequested?: (query: string) => void;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  /** Override input classes (e.g. quick modal Apple-style controls) */
  inputClassName?: string;
  /** Override wrapper div (default includes mt-2) */
  wrapperClassName?: string;
};

type MenuRect = { top: number; left: number; width: number };

export const PatientAutocompleteInput: React.FC<PatientAutocompleteInputProps> = ({
  id,
  query,
  selectedPatient,
  token,
  onQueryChange,
  onSelectPatient,
  onCreateRequested,
  disabled = false,
  inputRef,
  placeholder = "Имя или телефон",
  inputClassName,
  wrapperClassName,
}) => {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = React.useState(false);
  /** Chrome/Edge часто игнорируют autoComplete="off" внутри <form>; readOnly до первого фокуса отключает подсказки браузера. */
  const [browserFillUnlocked, setBrowserFillUnlocked] = React.useState(false);
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  /** Результаты GET /api/patients?search= */
  const [suggestions, setSuggestions] = React.useState<Patient[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [menuRect, setMenuRect] = React.useState<MenuRect | null>(null);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const lastPickedRef = React.useRef<{ id: number; name: string } | null>(null);
  const listId = `${id}-suggestions`;

  const showPanel = listOpen && !disabled && query.trim().length > 0;
  const queryTrim = query.trim();

  const updateMenuRect = React.useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuRect({
      top: r.bottom + 6,
      left: r.left,
      width: Math.max(r.width, 200),
    });
  }, []);

  React.useEffect(() => {
    if (!selectedPatient) lastPickedRef.current = null;
  }, [selectedPatient]);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  React.useEffect(() => {
    if (disabled) {
      setListOpen(false);
      setBrowserFillUnlocked(false);
    }
  }, [disabled]);

  React.useLayoutEffect(() => {
    if (!showPanel) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    const onMove = () => updateMenuRect();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [showPanel, updateMenuRect, query, searchLoading, suggestions.length]);

  React.useEffect(() => {
    if (!token || !debouncedQuery) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }

    const ac = new AbortController();
    setSuggestions([]);
    setSearchLoading(true);

    void appointmentsFlowApi
      .listPatients(token, { signal: ac.signal, search: debouncedQuery })
      .then((rows) => {
        if (ac.signal.aborted) return;
        setSuggestions(rows);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const aborted =
          (typeof err === "object" &&
            err !== null &&
            "name" in err &&
            (err as { name: string }).name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (aborted) return;
        setSuggestions([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setSearchLoading(false);
      });

    return () => ac.abort();
  }, [debouncedQuery, token]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setListOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handleInputChange = (next: string) => {
    const lock = lastPickedRef.current;
    if (selectedPatient && lock?.id === selectedPatient.id && next === lock.name) {
      onQueryChange(next);
      return;
    }
    if (selectedPatient) {
      lastPickedRef.current = null;
      onSelectPatient(null);
      onQueryChange(next);
      return;
    }
    onQueryChange(next);
  };

  const pickPatient = (p: Patient) => {
    lastPickedRef.current = { id: p.id, name: p.fullName };
    onSelectPatient(p);
    onQueryChange(p.fullName);
    setListOpen(false);
  };

  const getSecondaryLine = (p: Patient) => secondaryLine(p, t);

  const pickCreateNew = () => {
    lastPickedRef.current = null;
    onSelectPatient(null);
    onQueryChange(queryTrim);
    onCreateRequested?.(queryTrim);
    setListOpen(false);
  };

  const itemBase =
    "mx-1 flex w-[calc(100%-0.5rem)] flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35";

  const dropdown =
    showPanel && menuRect && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className={dropdownListClass}
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              zIndex: DROPDOWN_PORTAL_Z,
            }}
          >
            {searchLoading ? (
              <li
                className="mx-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-[#6b7280]"
                role="status"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" aria-hidden />
                {t("appointments.searching")}
              </li>
            ) : null}

            {!searchLoading &&
              suggestions.map((p) => {
                const secondary = getSecondaryLine(p);
                const isActive = selectedPatient?.id === p.id;
                return (
                  <li key={p.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`${itemBase} border border-transparent ${
                        isActive
                          ? "border-emerald-200 bg-emerald-50 text-[#111827]"
                          : "text-[#111827] hover:border-slate-200 hover:bg-slate-50 active:bg-slate-100"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickPatient(p)}
                    >
                      <span className="font-semibold text-[#111827]">{p.fullName}</span>
                      <span className="text-xs text-[#6b7280]">{secondary}</span>
                    </button>
                  </li>
                );
              })}

            {!searchLoading && suggestions.length === 0 && queryTrim ? (
              <li role="presentation" className="pt-0.5">
                <div className="mx-1 px-3 py-1.5 text-xs text-[#6b7280]" role="status">
                  {t("appointments.noPatientsFound")}
                </div>
                {onCreateRequested ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={`create-patient-option ${itemBase} border border-dashed border-emerald-300/80 bg-emerald-50/60 text-[#111827] hover:bg-emerald-50`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={pickCreateNew}
                  >
                    <span className="font-semibold text-emerald-800">{t("appointments.createPatient")}</span>
                    <span className="text-xs font-normal text-[#6b7280]">«{queryTrim}»</span>
                  </button>
                ) : null}
              </li>
            ) : null}
          </ul>,
          document.body
        )
      : null;

  const inputLoading = searchLoading && queryTrim.length > 0;

  return (
    <div ref={rootRef} className={`${wrapperClassName ?? modalComboboxWrapperClass} z-0`.trim()}>
      <div className="relative z-10">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="search"
          name={`crm-patient-search-${id}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          readOnly={disabled ? true : !browserFillUnlocked}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (!disabled) setBrowserFillUnlocked(true);
            setListOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setListOpen(false);
          }}
          className={`${inputClassName ?? modalComboboxInputClass} ${
            selectedPatient ? "border-[#22c55e] ring-1 ring-[#22c55e]/20" : ""
          } ${inputLoading ? "pr-9" : ""}`}
        />
        {inputLoading ? (
          <Loader2
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-600"
            aria-hidden
          />
        ) : null}
      </div>
      {dropdown}
    </div>
  );
};
