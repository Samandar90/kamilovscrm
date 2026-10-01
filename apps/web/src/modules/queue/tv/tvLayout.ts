/** At most 9 cabinet cards fit a 16:9 screen at a readable size; more cabinets rotate through pages. */
export const CABINETS_PER_PAGE = 9;

/** Page `pageIndex` (any integer; wraps around) of `items`; pageCount is at least 1. */
export function pageCabinets<T>(items: T[], pageIndex: number): { page: T[]; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / CABINETS_PER_PAGE));
  const safeIndex = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
  const index = ((safeIndex % pageCount) + pageCount) % pageCount;
  const start = index * CABINETS_PER_PAGE;
  return { page: items.slice(start, start + CABINETS_PER_PAGE), pageCount };
}

/** Grid columns for `count` cards: 0–1 → 1, 2–4 → 2, 5 and more → 3. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** Waiting rows (code + name) a cabinet card lists: four when the page has three rows of cards (7–9 cabinets), else five. */
export function waitingRowsShown(gridRows: number): number {
  return gridRows >= 3 ? 4 : 5;
}
