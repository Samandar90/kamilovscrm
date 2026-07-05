import React from "react";
import { useTranslation } from "react-i18next";

type OptionBase = {
  id: number;
  [key: string]: unknown;
};

type MultiSelectProps<TOption extends OptionBase> = {
  options: TOption[];
  value: number[];
  onChange: (next: number[]) => void;
  labelKey: keyof TOption & string;
  placeholder: string;
  disabled?: boolean;
};

const SEARCH_DEBOUNCE_MS = 250;

export function MultiSelect<TOption extends OptionBase>({
  options,
  value,
  onChange,
  labelKey,
  placeholder,
  disabled = false,
}: MultiSelectProps<TOption>) {
  const { t } = useTranslation();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  React.useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const getLabel = React.useCallback(
    (option: TOption): string => {
      const raw = option[labelKey];
      if (typeof raw === "string") return raw;
      if (typeof raw === "number") return String(raw);
      return `#${option.id}`;
    },
    [labelKey]
  );

  const selectedOptions = React.useMemo(
    () => options.filter((option) => value.includes(option.id)),
    [options, value]
  );

  const filteredOptions = React.useMemo(() => {
    const selectedSet = new Set(value);
    const available = options.filter((option) => !selectedSet.has(option.id));
    if (!debouncedQuery) return available;
    return available.filter((option) => getLabel(option).toLowerCase().includes(debouncedQuery));
  }, [options, value, debouncedQuery, getLabel]);

  const addOption = (id: number) => {
    if (disabled) return;
    if (!value.includes(id)) {
      onChange([...value, id]);
    }
    setSearchQuery("");
    setDebouncedQuery("");
    setOpen(false);
  };

  const removeOption = (id: number) => {
    if (disabled) return;
    onChange(value.filter((item) => item !== id));
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 100);
          }}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          className="h-11 w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:bg-white focus:ring-2 focus:ring-[#16a34a]/20 disabled:cursor-not-allowed disabled:opacity-60"
        />

        {selectedOptions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-medium text-[#166534]"
              >
                <span>{getLabel(option)}</span>
                <button
                  type="button"
                  onClick={() => removeOption(option.id)}
                  disabled={disabled}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[#166534] transition hover:bg-[#dcfce7] disabled:cursor-not-allowed"
                  aria-label={t("components.remove", { label: getLabel(option) })}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[#64748b]">{t("components.noSelection")}</p>
        )}
      </div>

      <div
        className={`absolute left-0 right-0 top-full z-[10100] mt-2 origin-top rounded-xl border border-[#e2e8f0] bg-white shadow-lg shadow-slate-900/12 transition duration-150 ${
          open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="max-h-60 overflow-y-auto p-2">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => addOption(option.id)}
                disabled={disabled}
                className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-[#0f172a] transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {getLabel(option)}
              </button>
            ))
          ) : open && searchQuery.length > 0 ? (
            <div className="px-3 py-2.5 text-sm text-[#64748b]">{t("components.notFound")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

