import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplay } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  listDisplays: vi.fn(),
  createDisplay: vi.fn(),
  updateDisplay: vi.fn(),
  deleteDisplay: vi.fn(),
  rotateCode: vi.fn(),
  confirm: vi.fn(() => true),
}));
const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../api/http", () => ({ requestJson: mocks.requestJson }));
vi.mock("../api/queueApi", () => ({
  queueApi: {
    listDisplays: mocks.listDisplays,
    createDisplay: mocks.createDisplay,
    updateDisplay: mocks.updateDisplay,
    deleteDisplay: mocks.deleteDisplay,
    rotateCode: mocks.rotateCode,
  },
}));
// Modal portals into document.body, which does not exist in the node test environment.
vi.mock("../../../ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
import { DisplaysPanel } from "./DisplaysPanel";

const hall: QueueDisplay = {
  id: 1, name: "Холл", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
  createdAt: "2026-09-30T05:00:00.000Z", updatedAt: "2026-09-30T05:00:00.000Z",
};
const floor2: QueueDisplay = {
  id: 2, name: "2 этаж", doctorIds: [3, 4], showNames: false, language: "ru", voiceEnabled: false,
  createdAt: "2026-09-30T05:00:00.000Z", updatedAt: "2026-09-30T05:00:00.000Z",
};
const doctors = [
  { id: 3, name: "Karimov Aziz", room: "5", active: true },
  { id: 4, name: "Aliyeva Nodira", room: null, active: true },
];

let view: ReactTestRenderer;
const onClose = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal("window", { setTimeout, clearTimeout, confirm: mocks.confirm, location: { origin: "https://crm.test" } });
  mocks.listDisplays.mockResolvedValue([hall, floor2]);
  mocks.requestJson.mockResolvedValue(doctors);
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const rows = () => view.root.findAllByType("li").map(textOf);
const render = async () => {
  await act(async () => {
    view = create(<DisplaysPanel onClose={onClose} />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
const tvLinks = (href: string) => view.root.findAll((node) => node.type === "a" && node.props.href === href);

describe("TV screens panel", () => {
  it("lists the clinic's screens with their doctors and settings", async () => {
    await render();
    expect(mocks.requestJson).toHaveBeenCalledWith("/api/doctors");
    const [first, second] = rows();
    expect(first).toContain("Холл");
    expect(first).toContain("queue.displays.allDoctors");
    expect(first).toContain("queue.displays.languages.uz_ru");
    expect(first).toContain("queue.displays.namesOn");
    expect(first).toContain("queue.displays.voiceOn");
    expect(second).toContain("Karimov Aziz, Aliyeva Nodira");
    expect(second).toContain("queue.displays.languages.ru");
    expect(second).toContain("queue.displays.namesOff");
    expect(second).toContain("queue.displays.voiceOff");
    act(() => view.root.findByProps({ "aria-label": "common.close" }).props.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creating a screen shows the returned code and its /tv link once, until dismissed", async () => {
    mocks.createDisplay.mockResolvedValue({
      display: { ...hall, id: 3, name: "Холл 2" },
      code: "K7M2Q-9XR4P",
    });
    await render();
    await click(buttons("queue.displays.add")[0]);
    act(() => view.root.findByProps({ id: "queue-display-name" }).props.onChange({ target: { value: "  Холл 2 " } }));
    await click(buttons("common.save")[0]);

    expect(mocks.createDisplay).toHaveBeenCalledWith({
      name: "Холл 2", doctorIds: null, showNames: true, language: "uz_ru", voiceEnabled: true,
    });
    expect(view.root.findAllByProps({ id: "queue-display-name" })).toHaveLength(0);
    expect(occurrences(textOf(view.root), "K7M2Q-9XR4P")).toBe(1);
    expect(tvLinks("https://crm.test/tv/K7M2Q-9XR4P")).toHaveLength(1);
    expect(view.root.findAllByProps({ value: "https://crm.test/tv/K7M2Q-9XR4P" })).toHaveLength(1);
    expect(rows()).toHaveLength(3);

    await click(buttons("queue.displays.done")[0]);
    expect(occurrences(textOf(view.root), "K7M2Q-9XR4P")).toBe(0);
    expect(tvLinks("https://crm.test/tv/K7M2Q-9XR4P")).toHaveLength(0);
  });

  it("does not send a screen without a name or, in pick mode, without doctors", async () => {
    await render();
    await click(buttons("queue.displays.add")[0]);
    await click(buttons("common.save")[0]);
    expect(textOf(view.root)).toContain("queue.displays.form.nameRequired");

    act(() => view.root.findByProps({ id: "queue-display-name" }).props.onChange({ target: { value: "Холл 2" } }));
    act(() => view.root.findByProps({ id: "queue-display-pick-doctors" }).props.onChange());
    await click(buttons("common.save")[0]);
    expect(textOf(view.root)).toContain("queue.displays.form.doctorsRequired");
    expect(mocks.createDisplay).not.toHaveBeenCalled();
  });

  it("asks before issuing a new code and then shows only the new code", async () => {
    mocks.rotateCode.mockResolvedValue({ display: hall, code: "ABCDE-23456" });
    await render();

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("queue.displays.rotate")[0]);
    expect(mocks.confirm).toHaveBeenCalledWith('queue.displays.confirmRotate {"name":"Холл"}');
    expect(mocks.rotateCode).not.toHaveBeenCalled();

    await click(buttons("queue.displays.rotate")[0]);
    expect(mocks.rotateCode).toHaveBeenCalledWith(1);
    expect(occurrences(textOf(view.root), "ABCDE-23456")).toBe(1);
    expect(tvLinks("https://crm.test/tv/ABCDE-23456")).toHaveLength(1);
  });

  it("deletes a screen only after window.confirm", async () => {
    mocks.deleteDisplay.mockResolvedValue({ success: true, id: 2 });
    await render();

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("common.delete")[1]);
    expect(mocks.confirm).toHaveBeenCalledWith('queue.displays.confirmDelete {"name":"2 этаж"}');
    expect(mocks.deleteDisplay).not.toHaveBeenCalled();

    await click(buttons("common.delete")[1]);
    expect(mocks.deleteDisplay).toHaveBeenCalledWith(2);
    expect(rows()).toHaveLength(1);
    expect(textOf(view.root)).toContain("queue.displays.deleted");
  });

  it("warns about selected doctors without a cabinet and saves the edited doctor list", async () => {
    mocks.updateDisplay.mockImplementation(async (id: number, patch: Partial<QueueDisplay>) => ({ ...floor2, ...patch, id }));
    await render();
    await click(buttons("common.edit")[1]);

    const warnings = () => view.root.findAll((node) => node.type === "div" && node.props.role === "note").map(textOf);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("Aliyeva Nodira");
    expect(warnings()[0]).not.toContain("Karimov Aziz");

    act(() => view.root.findByProps({ "aria-label": "Aliyeva Nodira" }).props.onChange({ target: { checked: false } }));
    expect(warnings()).toHaveLength(0);
    await click(buttons("common.save")[0]);

    expect(mocks.updateDisplay).toHaveBeenCalledWith(2, {
      name: "2 этаж", doctorIds: [3], showNames: false, language: "ru", voiceEnabled: false,
    });
    expect(textOf(view.root)).toContain("queue.displays.saved");
    expect(rows()[1]).toContain("Karimov Aziz");
    expect(rows()[1]).not.toContain("Aliyeva Nodira");
  });
});
