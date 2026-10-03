import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import type { MyLead, MyLeadsPage as MyLeadsPageData } from "../api/leadsTypes";

const mocks = vi.hoisted(() => ({ mine: vi.fn() }));
// Real Russian texts from ru.json, so the assertions read like the screen («Показать ещё»).
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
// Only `mine` exists here: a call to any staff endpoint would throw.
vi.mock("../api/leadsApi", () => ({ leadsApi: { mine: mocks.mine } }));
import { MyLeadsPage } from "./MyLeadsPage";

const lead = (id: number, overrides: Partial<MyLead> = {}): MyLead => ({
  id,
  receivedAt: "2026-10-02T06:15:00.000Z",
  fullName: `Тестовый Лид ${id}`,
  phone: "998901234567",
  sourceName: "Instagram",
  stage: "new",
  ...overrides,
});
const firstPage: MyLeadsPageData = {
  items: [
    lead(52),
    lead(51, { fullName: null, phone: "79161234567", sourceName: "Facebook", stage: "no_answer" }),
    lead(50, { stage: "visited" }),
  ],
  nextBeforeId: null,
};

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mine.mockResolvedValue(firstPage);
});
afterEach(() => {
  if (view) act(() => view.unmount());
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const rows = () => view.root.findAllByType("li");
const cells = (row: ReactTestInstance) =>
  ["received", "name", "phone", "source", "stage"].map((cell) => textOf(row.findByProps({ "data-cell": cell })));
const render = async () => {
  await act(async () => {
    view = create(<MyLeadsPage />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};

describe("contractor's leads page", () => {
  it("loads the contractor's own leads once and shows date, name, phone, source and stage", async () => {
    await render();
    expect(mocks.mine).toHaveBeenCalledTimes(1);
    expect(mocks.mine).toHaveBeenCalledWith();
    expect(textOf(view.root.findByType("h2"))).toBe("Мои лиды");

    const received = formatDateTimeRu("2026-10-02T06:15:00.000Z");
    expect(rows().map(cells)).toEqual([
      [received, "Тестовый Лид 52", "+998 90 123 45 67", "Instagram", "Новый"],
      [received, "Без имени", "+79161234567", "Facebook", "Не дозвонились"],
      [received, "Тестовый Лид 50", "+998 90 123 45 67", "Instagram", "Пришёл"],
    ]);
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it("is read-only: no links and no buttons", async () => {
    await render();
    expect(rows()).toHaveLength(3);
    expect(view.root.findAllByType("a")).toHaveLength(0);
    expect(view.root.findAllByType("button")).toHaveLength(0);
    expect(view.root.findAllByType("select")).toHaveLength(0);
    expect(view.root.findAllByType("input")).toHaveLength(0);
  });

  it("«Показать ещё» asks for the page before nextBeforeId and appends it", async () => {
    mocks.mine
      .mockResolvedValueOnce({ ...firstPage, nextBeforeId: 50 })
      .mockResolvedValueOnce({ items: [lead(49), lead(48)], nextBeforeId: null });
    await render();
    expect(rows()).toHaveLength(3);
    await click(buttons("Показать ещё")[0]);
    expect(mocks.mine).toHaveBeenCalledTimes(2);
    expect(mocks.mine).toHaveBeenLastCalledWith({ beforeId: 50 });
    expect(rows().map((row) => textOf(row.findByProps({ "data-cell": "name" })))).toEqual([
      "Тестовый Лид 52", "Без имени", "Тестовый Лид 50", "Тестовый Лид 49", "Тестовый Лид 48",
    ]);
    expect(buttons("Показать ещё")).toHaveLength(0);
  });

  it("keeps the rows and «Показать ещё» when the next page fails, and says why", async () => {
    mocks.mine.mockResolvedValueOnce({ ...firstPage, nextBeforeId: 50 }).mockRejectedValueOnce(new Error("Нет связи с сервером"));
    await render();
    await click(buttons("Показать ещё")[0]);
    expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Нет связи с сервером");
    expect(rows()).toHaveLength(3);
    expect(buttons("Показать ещё")).toHaveLength(1);
  });

  it("shows the empty state for an empty list", async () => {
    mocks.mine.mockResolvedValue({ items: [], nextBeforeId: null });
    await render();
    expect(textOf(view.root)).toContain("Лиды появятся здесь после подключения вашей таблицы");
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(view.root.findAllByType("button")).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });

  it("shows the error block with «Повторить» instead of the empty state when the list fails", async () => {
    mocks.mine.mockRejectedValueOnce(new Error("Нет связи с сервером"));
    await render();
    const alert = view.root.findByProps({ role: "alert" });
    expect(textOf(alert)).toContain("Не удалось загрузить лиды");
    expect(textOf(alert)).toContain("Нет связи с сервером");
    expect(textOf(view.root)).not.toContain("Лиды появятся здесь");
    expect(rows()).toHaveLength(0);

    await click(buttons("Повторить")[0]);
    expect(mocks.mine).toHaveBeenCalledTimes(2);
    expect(mocks.mine).toHaveBeenLastCalledWith();
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(rows()).toHaveLength(3);
  });
});
