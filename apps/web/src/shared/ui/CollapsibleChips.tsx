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
  if (items.length === 0) {
    return null;
  }

  const hiddenCount = Math.max(0, items.length - maxVisible);
  const visibleItems = items.slice(0, maxVisible);

  return (
    <div className={className}>
      <div className="flex max-h-[52px] flex-wrap items-center gap-1.5 overflow-hidden">
        {visibleItems.map((item, index) => renderItem(item, index))}
        {hiddenCount > 0 ? (
          <span
            className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
            aria-label={`Еще ${hiddenCount}`}
          >
            +{hiddenCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}
