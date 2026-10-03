import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../../locales/ru.json";
import uz from "../../../locales/uz.json";
import { formatDateTimeRu } from "../../../utils/formatDateTime";
import type { LeadSheetCheck, LeadSource, LeadSourcesManage, LeadSyncResult, LeadSyncStatus } from "../api/leadsTypes";

const mocks = vi.hoisted(() => ({
  sourcesManage: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  checkSource: vi.fn(),
  syncSource: vi.fn(),
}));
// Real Russian texts from ru.json, so the assertions read like the screen («Проверить таблицу»).
vi.mock("react-i18next", async () => {
  const texts = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], texts);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
vi.mock("../api/leadsApi", () => ({
  leadsApi: {
    sourcesManage: mocks.sourcesManage,
    createSource: mocks.createSource,
    updateSource: mocks.updateSource,
    checkSource: mocks.checkSource,
    syncSource: mocks.syncSource,
  },
}));
// Modal portals into document.body, which does not exist in the node test environment.
vi.mock("../../../ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
import { LEAD_SYNC_STATUS_KEYS, LeadSourcesPanel } from "./LeadSourcesPanel";

// A made-up sheet id: no real spreadsheet is named in the tests.
const SHEET_URL = "https://docs.google.com/spreadsheets/d/test-sheet-id-000000000000/edit#gid=0";
const instagram: LeadSource = {
  id: 3, name: "Instagram", marketerUserId: 12, marketerName: "Тестовый Таргетолог", sheetUrl: SHEET_URL,
  columnMap: null, syncEnabled: true, lastSyncAt: "2026-10-03T07:05:00.000Z", lastSyncStatus: "ok",
  lastSyncRows: 14, lastSyncSkipped: 2, leadsCount: 12,
  createdAt: "2026-10-01T05:00:00.000Z", updatedAt: "2026-10-03T07:05:00.000Z",
};
const facebook: LeadSource = {
  id: 4, name: "Facebook", marketerUserId: null, marketerName: null, sheetUrl: null,
  columnMap: null, syncEnabled: false, lastSyncAt: null, lastSyncStatus: null,
  lastSyncRows: null, lastSyncSkipped: null, leadsCount: 0,
  createdAt: "2026-10-02T05:00:00.000Z", updatedAt: "2026-10-02T05:00:00.000Z",
};
const manage: LeadSourcesManage = {
  items: [instagram, facebook],
  marketers: [
    { id: 12, fullName: "Тестовый Таргетолог", username: "target1" },
    { id: 13, fullName: "Второй Таргетолог", username: "target2" },
  ],
};
const checkOk: LeadSheetCheck = {
  status: "ok", headers: ["Дата", "Имя", "Телефон", "Город"], detected: { phone: "Телефон", name: "Имя" },
  rows: 14, valid: 12, skipped: 2,
};
const rejected = (message: string, status: number) => Object.assign(new Error(message), { status });

let view: ReactTestRenderer;
const onClose = vi.fn();
const onChanged = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.sourcesManage.mockResolvedValue(manage);
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const rows = () => view.root.findAllByType("li");
const byId = (id: string) => view.root.findByProps({ id });
const alerts = () => view.root.findAllByProps({ role: "alert" }).map(textOf);
const switches = () => view.root.findAll((node) => node.type === "input" && node.props.role === "switch");
const optionTexts = (id: string) => byId(id).findAllByType("option").map(textOf);
const render = async () => {
  await act(async () => {
    view = create(<LeadSourcesPanel onClose={onClose} onChanged={onChanged} />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};
const type = (id: string, value: string) => act(() => byId(id).props.onChange({ target: { value } }));

describe("lead sources panel", () => {
  it("lists the clinic's sources with the contractor, the sheet, the reading state, the last read and the counts", async () => {
    await render();
    expect(mocks.sourcesManage).toHaveBeenCalledTimes(1);
    const [first, second] = rows().map(textOf);
    expect(rows()).toHaveLength(2);

    expect(first).toContain("Instagram");
    expect(first).toContain("Таргетолог: Тестовый Таргетолог");
    expect(first).toContain("Таблица подключена");
    expect(first).toContain("Чтение включено");
    expect(first).toContain(formatDateTimeRu("2026-10-03T07:05:00.000Z"));
    expect(first).toContain("Прочитано");
    expect(first).toContain("строк 14, без телефона 2");
    expect(first).toContain("Лидов: 12");

    expect(second).toContain("Facebook");
    expect(second).toContain("Таргетолог: не привязан");
    expect(second).toContain("Таблица не подключена");
    expect(second).toContain("Чтение выключено");
    expect(second).toContain("Таблица ещё не читалась");
    expect(second).toContain("Лидов: 0");

    // The sheet link is for the form only: the list does not print it.
    expect(textOf(view.root)).not.toContain("test-sheet-id");
    act(() => view.root.findByProps({ "aria-label": "Закрыть" }).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the error with «Повторить» instead of «Источников пока нет» when the load fails", async () => {
    mocks.sourcesManage.mockRejectedValueOnce(new Error("Нет связи с сервером"));
    await render();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("Не удалось загрузить источники: Нет связи с сервером");
    expect(textOf(view.root)).not.toContain("Источников пока нет");
    expect(rows()).toHaveLength(0);

    await click(buttons("Повторить")[0]);
    expect(mocks.sourcesManage).toHaveBeenCalledTimes(2);
    expect(alerts()).toEqual([]);
    expect(rows()).toHaveLength(2);
  });

  it("says that there are no sources yet for an empty list", async () => {
    mocks.sourcesManage.mockResolvedValue({ items: [], marketers: [] });
    await render();
    expect(textOf(view.root)).toContain("Источников пока нет");
    expect(alerts()).toEqual([]);
  });

  it("keeps the reading switch and the sheet actions disabled until the source has a sheet", async () => {
    await render();
    const [withSheet, withoutSheet] = switches();
    expect(withSheet.props.checked).toBe(true);
    expect(withSheet.props.disabled).toBe(false);
    expect(withoutSheet.props.checked).toBe(false);
    expect(withoutSheet.props.disabled).toBe(true);
    expect(buttons("Проверить таблицу").map((button) => button.props.disabled)).toEqual([false, true]);
    expect(buttons("Прочитать сейчас").map((button) => button.props.disabled)).toEqual([false, true]);
    expect(buttons("Изменить").map((button) => button.props.disabled)).toEqual([false, false]);
  });

  it("the reading switch saves syncEnabled and shows the source the API returned", async () => {
    mocks.updateSource.mockResolvedValue({ ...instagram, syncEnabled: false });
    await render();
    await act(async () => {
      switches()[0].props.onChange();
      await settle();
    });
    expect(mocks.updateSource).toHaveBeenCalledTimes(1);
    expect(mocks.updateSource).toHaveBeenCalledWith(3, { syncEnabled: false });
    expect(switches()[0].props.checked).toBe(false);
    expect(textOf(rows()[0])).toContain("Чтение выключено");
  });

  it("adds a source through the form: name, contractor from the list, sheet link", async () => {
    mocks.createSource.mockResolvedValue({ ...facebook, id: 5, name: "TikTok", marketerUserId: 13, marketerName: "Второй Таргетолог", sheetUrl: SHEET_URL });
    await render();
    await click(buttons("Добавить источник")[0]);

    expect(optionTexts("lead-source-marketer")).toEqual([
      "не привязан", "Тестовый Таргетолог (target1)", "Второй Таргетолог (target2)",
    ]);
    expect(textOf(view.root)).toContain("Таблица должна быть открыта по ссылке для чтения");

    type("lead-source-name", "  TikTok ");
    type("lead-source-marketer", "13");
    type("lead-source-sheet", ` ${SHEET_URL} `);
    await click(buttons("Сохранить")[0]);

    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    expect(mocks.createSource).toHaveBeenCalledWith({ name: "TikTok", marketerUserId: 13, sheetUrl: SHEET_URL });
    expect(view.root.findAllByProps({ id: "lead-source-name" })).toHaveLength(0);
    expect(rows()).toHaveLength(3);
    expect(textOf(rows()[2])).toContain("TikTok");
    expect(textOf(rows()[2])).toContain("Таргетолог: Второй Таргетолог");
    expect(textOf(view.root)).toContain("Источник сохранён");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not send a source without a name; an empty contractor and link go as null", async () => {
    mocks.createSource.mockResolvedValue({ ...facebook, id: 5, name: "TikTok" });
    await render();
    await click(buttons("Добавить источник")[0]);
    await click(buttons("Сохранить")[0]);
    expect(alerts()).toEqual(["Укажите название источника"]);
    expect(mocks.createSource).not.toHaveBeenCalled();

    type("lead-source-name", "TikTok");
    await click(buttons("Сохранить")[0]);
    expect(mocks.createSource).toHaveBeenCalledWith({ name: "TikTok", marketerUserId: null, sheetUrl: null });
  });

  it("shows the API's message for a 422 and keeps the form open", async () => {
    mocks.createSource.mockRejectedValue(rejected("Не удалось распознать ссылку на Google-таблицу", 422));
    await render();
    await click(buttons("Добавить источник")[0]);
    type("lead-source-name", "TikTok");
    type("lead-source-sheet", "таблица таргетолога");
    await click(buttons("Сохранить")[0]);

    expect(alerts()).toEqual(["Не удалось распознать ссылку на Google-таблицу"]);
    expect(byId("lead-source-name").props.value).toBe("TikTok");
    expect(rows()).toHaveLength(2);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("«Изменить» opens the form with the source's values and sends only what changed", async () => {
    mocks.updateSource.mockImplementation(async (id: number, patch: Partial<LeadSource>) => ({ ...instagram, ...patch, id, marketerName: null }));
    await render();
    await click(buttons("Изменить")[0]);
    expect(byId("lead-source-name").props.value).toBe("Instagram");
    expect(byId("lead-source-marketer").props.value).toBe("12");
    expect(byId("lead-source-sheet").props.value).toBe(SHEET_URL);

    type("lead-source-name", "Instagram Reels");
    type("lead-source-marketer", "");
    await click(buttons("Сохранить")[0]);

    // The sheet link was not touched: sending it again is not needed, and a changed link resets the columns.
    expect(mocks.updateSource).toHaveBeenCalledTimes(1);
    expect(mocks.updateSource.mock.calls[0]).toStrictEqual([3, { name: "Instagram Reels", marketerUserId: null }]);
    expect(textOf(rows()[0])).toContain("Instagram Reels");
    expect(textOf(rows()[0])).toContain("Таргетолог: не привязан");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("an emptied sheet link is sent as null; an untouched form sends nothing", async () => {
    mocks.updateSource.mockResolvedValue({ ...instagram, sheetUrl: null, syncEnabled: false });
    await render();
    await click(buttons("Изменить")[0]);
    await click(buttons("Сохранить")[0]);
    expect(mocks.updateSource).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ id: "lead-source-name" })).toHaveLength(0);

    await click(buttons("Изменить")[0]);
    type("lead-source-sheet", "  ");
    await click(buttons("Сохранить")[0]);
    expect(mocks.updateSource.mock.calls[0]).toStrictEqual([3, { sheetUrl: null }]);
    expect(textOf(rows()[0])).toContain("Таблица не подключена");
    expect(switches()[0].props.disabled).toBe(true);
  });

  it("keeps a contractor who is no longer in the list visible in the form", async () => {
    mocks.sourcesManage.mockResolvedValue({ ...manage, marketers: [manage.marketers[1]] });
    await render();
    await click(buttons("Изменить")[0]);
    expect(optionTexts("lead-source-marketer")).toEqual(["не привязан", "Тестовый Таргетолог", "Второй Таргетолог (target2)"]);
    expect(byId("lead-source-marketer").props.value).toBe("12");
  });

  it("«Проверить таблицу» shows the status, the headers, the detected columns and the row counts", async () => {
    mocks.checkSource.mockResolvedValue(checkOk);
    await render();
    await click(buttons("Проверить таблицу")[0]);

    expect(mocks.checkSource).toHaveBeenCalledWith(3);
    const report = textOf(rows()[0].findByProps({ "data-report": "check" }));
    expect(report).toContain("Проверка таблицы: Прочитано");
    expect(report).toContain("строк 14, с телефоном 12, без телефона 2");
    expect(report).toContain("Заголовки: Дата, Имя, Телефон, Город");
    expect(report).toContain("Найденные колонки: телефон — Телефон, имя — Имя");
    expect(byId("lead-source-3-phone-column").props.value).toBe("Телефон");
    expect(byId("lead-source-3-name-column").props.value).toBe("Имя");
    // The same header cannot be both columns.
    expect(optionTexts("lead-source-3-phone-column")).toEqual(["Выберите колонку", "Дата", "Имя", "Телефон", "Город"]);
    expect(optionTexts("lead-source-3-name-column")).toEqual(["Без колонки имени", "Дата", "Имя", "Город"]);
    // Nothing to save while the columns are the ones the reader found itself.
    expect(buttons("Сохранить колонки")[0].props.disabled).toBe(true);
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });

  it("another column chosen by the superadmin is saved as columnMap and the sheet is checked again", async () => {
    mocks.checkSource
      .mockResolvedValueOnce(checkOk)
      .mockResolvedValueOnce({ ...checkOk, detected: { phone: "Город", name: "Имя" }, valid: 0, skipped: 14 });
    mocks.updateSource.mockResolvedValue({ ...instagram, columnMap: { phone: "Город", name: "Имя" } });
    await render();
    await click(buttons("Проверить таблицу")[0]);
    type("lead-source-3-phone-column", "Город");
    expect(buttons("Сохранить колонки")[0].props.disabled).toBe(false);
    await click(buttons("Сохранить колонки")[0]);

    expect(mocks.updateSource).toHaveBeenCalledTimes(1);
    expect(mocks.updateSource).toHaveBeenCalledWith(3, { columnMap: { phone: "Город", name: "Имя" } });
    expect(mocks.checkSource).toHaveBeenCalledTimes(2);
    expect(textOf(rows()[0].findByProps({ "data-report": "check" }))).toContain("строк 14, с телефоном 0, без телефона 14");
  });

  it("when the columns are not found the superadmin picks them from the headers", async () => {
    mocks.checkSource
      .mockResolvedValueOnce({
        status: "columns_not_found", headers: ["Контакт", "Клиент ФИО"], detected: { phone: null, name: null },
        rows: 0, valid: 0, skipped: 0,
      })
      .mockResolvedValueOnce({
        status: "ok", headers: ["Контакт", "Клиент ФИО"], detected: { phone: "Контакт", name: null },
        rows: 3, valid: 3, skipped: 0,
      });
    mocks.updateSource.mockResolvedValue({ ...instagram, columnMap: { phone: "Контакт", name: null } });
    await render();
    await click(buttons("Проверить таблицу")[0]);

    const report = () => textOf(rows()[0].findByProps({ "data-report": "check" }));
    expect(report()).toContain("Проверка таблицы: Не найдена колонка телефона или имени");
    expect(report()).toContain("Заголовки: Контакт, Клиент ФИО");
    expect(report()).toContain("Найденные колонки: телефон — не найдена, имя — не найдена");
    expect(byId("lead-source-3-phone-column").props.value).toBe("");
    expect(byId("lead-source-3-name-column").props.value).toBe("");
    // Without a phone column there is nothing to save.
    expect(buttons("Сохранить колонки")[0].props.disabled).toBe(true);

    type("lead-source-3-phone-column", "Контакт");
    await click(buttons("Сохранить колонки")[0]);
    expect(mocks.updateSource).toHaveBeenCalledWith(3, { columnMap: { phone: "Контакт", name: null } });
    expect(report()).toContain("Проверка таблицы: Прочитано");
    expect(report()).toContain("строк 3, с телефоном 3, без телефона 0");
  });

  it("a sheet that cannot be read is shown by its status, without headers and without the column pickers", async () => {
    mocks.checkSource.mockResolvedValue({
      status: "no_access", headers: [], detected: { phone: null, name: null }, rows: 0, valid: 0, skipped: 0,
    });
    await render();
    await click(buttons("Проверить таблицу")[0]);
    const report = textOf(rows()[0].findByProps({ "data-report": "check" }));
    expect(report).toBe("Проверка таблицы: Нет доступа: таблица не открыта по ссылке");
    expect(buttons("Сохранить колонки")).toHaveLength(0);
    expect(alerts()).toEqual([]);
  });

  it("«Прочитать сейчас» reads the sheet, tells what was added and refreshes the row", async () => {
    const result: LeadSyncResult = { status: "ok", rows: 20, added: 5, duplicates: 14, skipped: 1 };
    mocks.syncSource.mockResolvedValue(result);
    await render();
    mocks.sourcesManage.mockResolvedValue({
      ...manage,
      items: [{ ...instagram, lastSyncAt: "2026-10-03T08:00:00.000Z", lastSyncRows: 20, lastSyncSkipped: 1, leadsCount: 17 }, facebook],
    });
    await click(buttons("Прочитать сейчас")[0]);

    expect(mocks.syncSource).toHaveBeenCalledWith(3);
    expect(textOf(rows()[0].findByProps({ "data-report": "sync" }))).toBe(
      "Таблица прочитана: новых лидов 5, уже были 14, без телефона 1"
    );
    expect(mocks.sourcesManage).toHaveBeenCalledTimes(2);
    expect(textOf(rows()[0])).toContain("строк 20, без телефона 1");
    expect(textOf(rows()[0])).toContain("Лидов: 17");
    // The page behind the panel reloads its list.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a read that failed is shown by its status and adds nothing", async () => {
    mocks.syncSource.mockResolvedValue({ status: "no_access", rows: 0, added: 0, duplicates: 0, skipped: 0 });
    await render();
    await click(buttons("Прочитать сейчас")[0]);
    expect(textOf(rows()[0].findByProps({ "data-report": "sync" }))).toBe("Нет доступа: таблица не открыта по ссылке");
    expect(textOf(view.root)).not.toContain("Таблица прочитана");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the API's message when an action is rejected", async () => {
    mocks.syncSource.mockRejectedValue(rejected("Сначала укажите ссылку на таблицу", 422));
    await render();
    await click(buttons("Прочитать сейчас")[0]);
    expect(alerts()).toEqual(["Сначала укажите ссылку на таблицу"]);
    expect(rows()).toHaveLength(2);
  });

  it("ignores other actions while one is running", async () => {
    let finish!: (value: LeadSyncResult) => void;
    mocks.syncSource.mockReturnValue(new Promise<LeadSyncResult>((resolve) => (finish = resolve)));
    await render();
    await click(buttons("Прочитать сейчас")[0]);
    await click(buttons("Прочитать сейчас")[0]);
    await click(buttons("Проверить таблицу")[0]);
    expect(mocks.syncSource).toHaveBeenCalledTimes(1);
    expect(mocks.checkSource).not.toHaveBeenCalled();
    expect(switches().every((input) => input.props.disabled === true)).toBe(true);
    expect(buttons("Изменить").every((button) => button.props.disabled === true)).toBe(true);

    await act(async () => {
      finish({ status: "empty", rows: 0, added: 0, duplicates: 0, skipped: 0 });
      await settle();
    });
    expect(textOf(rows()[0].findByProps({ "data-report": "sync" }))).toBe("В таблице пока нет строк");
    expect(buttons("Изменить").some((button) => button.props.disabled === true)).toBe(false);
  });
});

describe("texts of the sheet read statuses", () => {
  const STATUSES: LeadSyncStatus[] = [
    "ok", "empty", "no_access", "not_found", "columns_not_found", "too_large", "timeout", "http_error",
  ];
  const textAt = (texts: unknown, key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], texts);

  it("has a key for every status", () => {
    expect(Object.keys(LEAD_SYNC_STATUS_KEYS).sort()).toEqual([...STATUSES].sort());
  });

  it.each(STATUSES)("%s has a Russian and an Uzbek text", (status) => {
    const key = LEAD_SYNC_STATUS_KEYS[status];
    const russian = textAt(ru, key);
    const uzbek = textAt(uz, key);
    expect(typeof russian).toBe("string");
    expect(typeof uzbek).toBe("string");
    expect((russian as string).trim()).not.toBe("");
    expect((uzbek as string).trim()).not.toBe("");
    expect(uzbek).not.toBe(russian);
  });
});
