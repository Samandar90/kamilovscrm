import { describe, expect, it } from "vitest";
import { CABINETS_PER_PAGE, gridColumns, hasQueue, pageCabinets, waitingRowsShown } from "./tvLayout";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("pageCabinets", () => {
  it("keeps up to nine cabinets on one page", () => {
    expect(CABINETS_PER_PAGE).toBe(9);
    expect(pageCabinets([], 0)).toEqual({ page: [], pageCount: 1 });
    expect(pageCabinets(range(9), 0)).toEqual({ page: range(9), pageCount: 1 });
    expect(pageCabinets(range(9), 5)).toEqual({ page: range(9), pageCount: 1 });
  });

  it("splits more cabinets into pages of nine and wraps the page index", () => {
    expect(pageCabinets(range(20), 0)).toEqual({ page: range(9), pageCount: 3 });
    expect(pageCabinets(range(20), 1).page).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(pageCabinets(range(20), 2).page).toEqual([19, 20]);
    expect(pageCabinets(range(20), 3).page).toEqual(range(9));
    expect(pageCabinets(range(20), -1).page).toEqual([19, 20]);
  });
});

describe("gridColumns", () => {
  it.each([
    [0, 1], [1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [12, 3],
  ])("%i cabinets → %i columns", (count, columns) => {
    expect(gridColumns(count)).toBe(columns);
  });
});

describe("waitingRowsShown", () => {
  it.each([
    [1, 5], [2, 5], [3, 4],
  ])("%i grid rows → %i waiting rows", (gridRows, shown) => {
    expect(waitingRowsShown(gridRows)).toBe(shown);
  });
});

describe("hasQueue", () => {
  it("is true while a patient is being served or called", () => {
    expect(hasQueue({ current: { code: "К-05", name: null, state: "serving" }, waitingCount: 0 })).toBe(true);
    expect(hasQueue({ current: { code: "К-06", name: null, state: "called" }, waitingCount: 0 })).toBe(true);
  });

  it("is true while patients wait, even if nobody is called yet", () => {
    expect(hasQueue({ current: null, waitingCount: 1 })).toBe(true);
  });

  it("is false for a doctor who has finished everyone or has nobody", () => {
    expect(hasQueue({ current: null, waitingCount: 0 })).toBe(false);
  });
});
