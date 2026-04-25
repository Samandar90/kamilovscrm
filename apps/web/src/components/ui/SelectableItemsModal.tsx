import React from "react";
import { Search, X } from "lucide-react";
import { Modal } from "./Modal";

type SelectableOption = {
  id: number;
  name: string;
};

type SelectableItemsModalProps = {
  isOpen: boolean;
  title: string;
  options: SelectableOption[];
  selectedIds: number[];
  onClose: () => void;
  onSave: (nextIds: number[]) => void;
  searchPlaceholder?: string;
  disabled?: boolean;
};

const SEARCH_DEBOUNCE_MS = 250;

export const SelectableItemsModal: React.FC<SelectableItemsModalProps> = ({
  isOpen,
  title,
  options,
  selectedIds,
  onClose,
  onSave,
  searchPlaceholder = "Поиск...",
  disabled = false,
}) => {
  const [draftSelectedIds, setDraftSelectedIds] = React.useState<number[]>(selectedIds);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    if (!isOpen) return;
    setDraftSelectedIds(selectedIds);
    setSearch("");
    setDebouncedSearch("");
  }, [isOpen, selectedIds]);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  const selectedMap = React.useMemo(
    () => new Map(options.map((option) => [option.id, option.name])),
    [options]
  );

  const selectedChips = React.useMemo(
    () =>
      draftSelectedIds
        .map((id) => ({ id, name: selectedMap.get(id) ?? `#${id}` })),
    [draftSelectedIds, selectedMap]
  );

  const filtered = React.useMemo(() => {
    if (!debouncedSearch) return options;
    return options.filter((option) => option.name.toLowerCase().includes(debouncedSearch));
  }, [options, debouncedSearch]);

  const toggleId = (id: number) => {
    setDraftSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const removeId = (id: number) => {
    setDraftSelectedIds((prev) => prev.filter((v) => v !== id));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-2xl rounded-[20px] border border-[#e2e8f0] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(15,23,42,0.22)]"
    >
      <h3 className="text-lg font-semibold text-[#0f172a]">{title}</h3>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[#64748b]">
          Выбрано: {draftSelectedIds.length}
        </p>
        {selectedChips.length > 0 ? (
          <div className="mt-2 flex max-h-[64px] flex-wrap items-center gap-1.5 overflow-y-auto">
            {selectedChips.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-0.5 text-xs font-medium text-[#166534]"
              >
                <span>{item.name}</span>
                <button
                  type="button"
                  onClick={() => removeId(item.id)}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-[#dcfce7]"
                  aria-label={`Удалить ${item.name}`}
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#94a3b8]">Ничего не выбрано</p>
        )}
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 w-full rounded-xl border border-[#e2e8f0] bg-white pl-10 pr-3 text-sm text-[#0f172a] outline-none transition focus:border-[#16a34a] focus:ring-2 focus:ring-[#16a34a]/20"
          disabled={disabled}
        />
      </div>

      <div className="mt-3 max-h-[320px] overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-2">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-[#64748b]">Ничего не найдено</p>
        ) : (
          filtered.map((option) => {
            const checked = draftSelectedIds.includes(option.id);
            return (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#0f172a] transition hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleId(option.id)}
                  className="h-4 w-4 rounded border-[#cbd5e1] text-[#16a34a] focus:ring-[#16a34a]/30"
                  disabled={disabled}
                />
                <span className="min-w-0 truncate">{option.name}</span>
              </label>
            );
          })
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#0f172a] transition hover:bg-[#f1f5f9]"
          onClick={onClose}
          disabled={disabled}
        >
          Отмена
        </button>
        <button
          type="button"
          className="rounded-xl bg-[#16a34a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#22c55e] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onSave(draftSelectedIds)}
          disabled={disabled}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
};
