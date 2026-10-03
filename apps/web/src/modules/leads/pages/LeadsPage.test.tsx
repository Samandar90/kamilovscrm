import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../../../auth/types";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import type { Lead, LeadsPage as LeadsPageData } from "../api/leadsTypes";

type DetailsProps = { lead: Lead; onChange: (lead: Lead) => void; onConflict: () => void };
type SourcesPanelProps = { onClose: () => void; onChanged: () => void };
const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  list: vi.fn(),
  sources: vi.fn(),
  update: vi.fn(),
  details: null as DetailsProps | null,
  panel: null as SourcesPanelProps | null,
}));
// Real Russian texts from ru.json, so the assertions read like the screen («Взять в работу»).
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
// The real api/http needs VITE_API_URL and initialises i18next; the page only needs its error class.
vi.mock("../../../api/http", () => ({ HttpError: class HttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
} }));
vi.mock("../api/leadsApi", () => ({ leadsApi: { list: mocks.list, sources: mocks.sources, update: mocks.update } }));
vi.mock("../components/LeadDetails", () => ({
  LeadDetails: (props: DetailsProps) => {
    mocks.details = props;
    return <div id="lead-details" data-lead-id={props.lead.id} />;
  },
}));
vi.mock("../components/LeadSourcesPanel", () => ({
  LeadSourcesPanel: (props: SourcesPanelProps) => {
    mocks.panel = props;
    return <div id="lead-sources-panel" />;
  },
}));
import { HttpError } from "../../../api/http";
import { LeadsPage } from "./LeadsPage";

const lead = (id: number, overrides: Partial<Lead> = {}): Lead => ({
  id,
  createdAt: "2026-10-02T06:15:00.000Z",
  fullName: `Тестовый Лид ${id}`,
  phone: "998901234567",
  extra: {},
  status: "new",
  stage: "new",
  note: null,
  sourceId: 3,
  sourceName: "Instagram",
  patientId: null,
  patientName: null,
  staffUpdatedAt: null,
  staffUpdatedByName: null,
  ...overrides,
});
const firstPage: LeadsPageData = {
  items: [
    lead(52),
    lead(51, { fullName: null, phone: "79161234567", sourceName: "Facebook", sourceId: 4 }),
    lead(50, { status: "in_progress", stage: "visited", patientId: 9, patientName: "Тестовый Пациент" }),
  ],
  nextBeforeId: null,
};

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.details = null;
  mocks.panel = null;
  mocks.list.mockResolvedValue(firstPage);
  mocks.sources.mockResolvedValue({ items: [{ id: 3, name: "Instagram" }, { id: 4, name: "Facebook" }] });
});
afterEach(() => {
  if (view) act(() => view.unmount());
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const actionButtons = () => view.root.findAll((node) => node.type === "button" && node.props["data-action"] !== undefined);
const rows = () => view.root.findAllByType("li");
const select = (id: string) => view.root.findByProps({ id });
const renderAs = async (role: UserRole) => {
  mocks.user = { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  await act(async () => {
    view = create(<LeadsPage />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};
const choose = async (id: string, value: string) => {
  await act(async () => {
    select(id).props.onChange({ target: { value } });
    await settle();
  });
};

describe("staff leads page", () => {
  it("loads the list and the sources on mount and shows every lead", async () => {
    await renderAs("operator");
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith({});
    expect(mocks.sources).toHaveBeenCalledTimes(1);

    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(textOf(first)).toContain(formatDateTimeRu("2026-10-02T06:15:00.000Z"));
    expect(textOf(first)).toContain("Тестовый Лид 52");
    expect(textOf(first)).toContain("Instagram");
    expect(textOf(first)).toContain("Новый");
    const call = first.findByType("a");
    expect(call.props.href).toBe("tel:+998901234567");
    expect(textOf(call)).toBe("+998 90 123 45 67");

    expect(textOf(second)).toContain("Без имени");
    expect(textOf(second)).toContain("Facebook");
    expect(second.findByType("a").props.href).toBe("tel:+79161234567");
    expect(textOf(second.findByType("a"))).toBe("+79161234567");

    // The badge is the derived stage, not the stored status.
    expect(textOf(third)).toContain("Пришёл");
    expect(textOf(third)).not.toContain("В работе");
  });

  it("shows the error block with «Повторить» instead of the empty state when the list fails", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Нет связи с сервером"));
    await renderAs("operator");
    const alert = view.root.findByProps({ role: "alert" });
    expect(textOf(alert)).toContain("Не удалось загрузить лиды");
    expect(textOf(alert)).toContain("Нет связи с сервером");
    expect(textOf(view.root)).not.toContain("Лидов пока нет");
    expect(rows()).toHaveLength(0);

    await click(buttons("Повторить")[0]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(rows()).toHaveLength(3);
  });

  it("shows the empty state for an empty list", async () => {
    mocks.list.mockResolvedValue({ items: [], nextBeforeId: null });
    await renderAs("operator");
    expect(textOf(view.root)).toContain("Лидов пока нет");
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(buttons("Повторить")).toHaveLength(0);
    expect(buttons("Показать ещё")).toHaveLength(0);
  });

  it("offers every stage in the «Статус» filter, «Пришёл» included, and the clinic's sources", async () => {
    await renderAs("operator");
    const stageOptions = select("leads-filter-stage").findAllByType("option");
    expect(stageOptions.map((option) => option.props.value)).toEqual([
      "", "new", "in_progress", "no_answer", "booked", "visited", "declined", "invalid",
    ]);
    expect(stageOptions.map(textOf)).toEqual([
      "Все статусы", "Новый", "В работе", "Не дозвонились", "Записан", "Пришёл", "Отказ", "Некачественный",
    ]);
    expect(select("leads-filter-source").findAllByType("option").map(textOf)).toEqual(["Все источники", "Instagram", "Facebook"]);
  });

  it("reloads with the chosen filter", async () => {
    await renderAs("operator");
    await choose("leads-filter-stage", "visited");
    expect(mocks.list).toHaveBeenLastCalledWith({ stage: "visited" });
    await choose("leads-filter-source", "4");
    expect(mocks.list).toHaveBeenLastCalledWith({ stage: "visited", sourceId: 4 });
    await choose("leads-filter-stage", "");
    expect(mocks.list).toHaveBeenLastCalledWith({ sourceId: 4 });
    expect(mocks.list).toHaveBeenCalledTimes(4);
    // The sources feed only the filter: they are not asked for again.
    expect(mocks.sources).toHaveBeenCalledTimes(1);
  });

  it("says that nothing matches the filters instead of «Лидов пока нет»", async () => {
    await renderAs("operator");
    mocks.list.mockResolvedValue({ items: [], nextBeforeId: null });
    await choose("leads-filter-stage", "declined");
    expect(textOf(view.root)).toContain("Ничего не найдено");
    expect(textOf(view.root)).not.toContain("Лидов пока нет");
  });

  it("«Показать ещё» asks for the page before nextBeforeId and appends it", async () => {
    mocks.list
      .mockResolvedValueOnce({ ...firstPage, nextBeforeId: 50 })
      .mockResolvedValueOnce({ items: [lead(49), lead(48)], nextBeforeId: null });
    await renderAs("operator");
    expect(rows()).toHaveLength(3);
    await click(buttons("Показать ещё")[0]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith({ beforeId: 50 });
    expect(rows().map((row) => textOf(row.findByProps({ "data-cell": "name" })))).toEqual([
      "Тестовый Лид 52", "Без имени", "Тестовый Лид 50", "Тестовый Лид 49", "Тестовый Лид 48",
    ]);
    expect(buttons("Показать ещё")).toHaveLength(0);
  });

  it("keeps the filters in the «Показать ещё» request", async () => {
    mocks.list.mockResolvedValue({ ...firstPage, nextBeforeId: 50 });
    await renderAs("operator");
    await choose("leads-filter-stage", "new");
    mocks.list.mockResolvedValueOnce({ items: [lead(49)], nextBeforeId: null });
    await click(buttons("Показать ещё")[0]);
    expect(mocks.list).toHaveBeenLastCalledWith({ stage: "new", beforeId: 50 });
    expect(rows()).toHaveLength(4);
  });

  it("ignores «Показать ещё» while the list is being reloaded: the old cursor is not asked for", async () => {
    mocks.list.mockResolvedValueOnce({ ...firstPage, nextBeforeId: 50 });
    await renderAs("operator");
    let finish!: (page: LeadsPageData) => void;
    mocks.list.mockReturnValueOnce(new Promise<LeadsPageData>((resolve) => (finish = resolve)));
    // A page of the old cursor would be appended to the fresh first page.
    mocks.list.mockResolvedValue({ items: [lead(49), lead(48)], nextBeforeId: null });

    await click(view.root.findByProps({ "aria-label": "Обновить" }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(buttons("Показать ещё")[0].props.disabled).toBe(true);
    await click(buttons("Показать ещё")[0]);
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      finish({ items: [lead(53), ...firstPage.items], nextBeforeId: 50 });
      await settle();
    });
    expect(rows().map((row) => textOf(row.findByProps({ "data-cell": "name" })))).toEqual([
      "Тестовый Лид 53", "Тестовый Лид 52", "Без имени", "Тестовый Лид 50",
    ]);
    expect(buttons("Показать ещё")[0].props.disabled).toBe(false);
  });

  it("ignores «Показать ещё» while another filter is being loaded", async () => {
    mocks.list.mockResolvedValueOnce({ ...firstPage, nextBeforeId: 50 });
    await renderAs("operator");
    let finish!: (page: LeadsPageData) => void;
    mocks.list.mockReturnValueOnce(new Promise<LeadsPageData>((resolve) => (finish = resolve)));
    await choose("leads-filter-stage", "new");
    await click(buttons("Показать ещё")[0]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith({ stage: "new" });
    await act(async () => {
      finish({ items: [lead(52)], nextBeforeId: null });
      await settle();
    });
    expect(rows()).toHaveLength(1);
  });

  it("«Взять в работу» moves a new lead to «В работе» only if it is still new", async () => {
    mocks.update.mockResolvedValue(lead(52, { status: "in_progress", stage: "in_progress" }));
    await renderAs("operator");
    // Only the two new leads can be taken.
    expect(buttons("Взять в работу")).toHaveLength(2);
    await click(rows()[0].findByProps({ "data-action": "take" }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(52, { status: "in_progress", expectedStatus: "new" });
    expect(textOf(rows()[0])).toContain("В работе");
    expect(buttons("Взять в работу")).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("ignores a second press while the first one is being saved", async () => {
    let finish!: (value: Lead) => void;
    mocks.update.mockReturnValue(new Promise<Lead>((resolve) => (finish = resolve)));
    await renderAs("operator");
    const take = rows()[0].findByProps({ "data-action": "take" });
    await click(take);
    await click(rows()[1].findByProps({ "data-action": "take" }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(actionButtons().every((button) => button.props.disabled === true)).toBe(true);
    await act(async () => {
      finish(lead(52, { status: "in_progress", stage: "in_progress" }));
      await settle();
    });
    expect(actionButtons().some((button) => button.props.disabled === true)).toBe(false);
  });

  it("says «Лид уже взял коллега» and reloads the list on 409", async () => {
    mocks.update.mockRejectedValue(new HttpError("Статус лида уже изменён", 409));
    await renderAs("reception");
    mocks.list.mockResolvedValue({
      items: [lead(52, { status: "in_progress", stage: "in_progress" }), ...firstPage.items.slice(1)],
      nextBeforeId: null,
    });
    await click(rows()[0].findByProps({ "data-action": "take" }));
    expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Лид уже взял коллега");
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(textOf(rows()[0])).toContain("В работе");
  });

  it("shows the server's message for any other failure and does not reload", async () => {
    mocks.update.mockRejectedValue(new HttpError("Лид не найден", 404));
    await renderAs("manager");
    await click(rows()[0].findByProps({ "data-action": "take" }));
    expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Лид не найден");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("gives a role without leads update no action buttons", async () => {
    await renderAs("director");
    expect(rows()).toHaveLength(3);
    expect(actionButtons()).toHaveLength(0);
    expect(buttons("Взять в работу")).toHaveLength(0);
  });

  it("opens one lead's details at a time and takes the changes they report", async () => {
    await renderAs("superadmin");
    expect(view.root.findAllByProps({ id: "lead-details" })).toHaveLength(0);
    await click(rows()[1].findByProps({ "aria-controls": "lead-details-51" }));
    expect(view.root.findAllByProps({ id: "lead-details" }).map((node) => node.props["data-lead-id"])).toEqual([51]);
    await click(rows()[0].findByProps({ "aria-controls": "lead-details-52" }));
    expect(view.root.findAllByProps({ id: "lead-details" }).map((node) => node.props["data-lead-id"])).toEqual([52]);
    expect(rows()[0].findByProps({ "aria-controls": "lead-details-52" }).props["aria-expanded"]).toBe(true);

    await act(async () => {
      mocks.details?.onChange(lead(52, { status: "declined", stage: "declined", note: "не интересно" }));
      await settle();
    });
    expect(textOf(rows()[0])).toContain("Отказ");
    expect(mocks.details?.lead.note).toBe("не интересно");

    // A colleague changed the lead while the details were open: say so and reload.
    await act(async () => {
      mocks.details?.onConflict();
      await settle();
    });
    expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Лид уже изменил коллега. Список обновлён.");
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await click(rows()[0].findByProps({ "aria-controls": "lead-details-52" }));
    expect(view.root.findAllByProps({ id: "lead-details" })).toHaveLength(0);
  });

  it("refreshes the list with the «Обновить» button", async () => {
    await renderAs("operator");
    await click(view.root.findByProps({ "aria-label": "Обновить" }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith({});
  });

  it("«Обновить» asks for the filter's sources again, so a failed sources request is not left until the page is reopened", async () => {
    mocks.sources.mockRejectedValueOnce(new Error("Нет связи с сервером"));
    await renderAs("operator");
    expect(select("leads-filter-source").findAllByType("option").map(textOf)).toEqual(["Все источники"]);

    await click(view.root.findByProps({ "aria-label": "Обновить" }));
    expect(mocks.sources).toHaveBeenCalledTimes(2);
    expect(select("leads-filter-source").findAllByType("option").map(textOf)).toEqual(["Все источники", "Instagram", "Facebook"]);
  });
});

describe("lead sources on the staff leads page", () => {
  const panels = () => view.root.findAllByProps({ id: "lead-sources-panel" });

  it("opens the sources panel with «Источники» and closes it from the panel, for the superadmin", async () => {
    await renderAs("superadmin");
    expect(panels()).toHaveLength(0);
    const toggle = buttons("Источники")[0];
    expect(toggle.props["aria-expanded"]).toBe(false);

    await click(toggle);
    expect(panels()).toHaveLength(1);
    expect(buttons("Источники")[0].props["aria-expanded"]).toBe(true);

    await act(async () => {
      mocks.panel?.onClose();
      await settle();
    });
    expect(panels()).toHaveLength(0);
  });

  it.each<UserRole>(["reception", "operator", "manager", "director"])("gives %s neither the button nor the panel", async (role) => {
    await renderAs(role);
    expect(buttons("Источники")).toHaveLength(0);
    expect(panels()).toHaveLength(0);
    expect(mocks.panel).toBeNull();
  });

  it("reloads the leads and the filter's sources when the panel reports a change", async () => {
    await renderAs("superadmin");
    await click(buttons("Источники")[0]);
    mocks.sources.mockResolvedValue({ items: [{ id: 3, name: "Instagram" }, { id: 4, name: "Facebook" }, { id: 5, name: "TikTok" }] });
    await act(async () => {
      mocks.panel?.onChanged();
      await settle();
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.sources).toHaveBeenCalledTimes(2);
    expect(select("leads-filter-source").findAllByType("option").map(textOf)).toEqual([
      "Все источники", "Instagram", "Facebook", "TikTok",
    ]);
    // The panel stays open: the superadmin is still working in it.
    expect(panels()).toHaveLength(1);
  });
});
