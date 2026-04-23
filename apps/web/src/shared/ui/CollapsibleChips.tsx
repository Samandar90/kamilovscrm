import React from "react";

type CollapsibleChipsProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  maxVisible?: number;
  className?: string;
};

export function CollapsibleChips<T>({
  items,
  renderItem,
  maxVisible = 2,
  className = "mt-2",
}: CollapsibleChipsProps<T>): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState(false);

  if (items.length === 0) {
    return null;
  }

  const hiddenCount = Math.max(0, items.length - maxVisible);
  const visibleItems = expanded ? items : items.slice(0, maxVisible);

  return (
    <div
      className={`${className} overflow-hidden transition-all duration-300 ease-out ${
        expanded ? "max-h-64" : "max-h-10"
      }`}
    >
      <div className="flex flex-wrap gap-2">
        {visibleItems.map((item, index) => renderItem(item, index))}

        {!expanded && hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
            aria-label={`Показать еще ${hiddenCount}`}
          >
            +{hiddenCount}
          </button>
        ) : null}

        {expanded && hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
          >
            Свернуть
          </button>
        ) : null}
      </div>
    </div>
  );
}
