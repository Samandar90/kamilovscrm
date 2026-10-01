import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestJson: vi.fn(), doctors: [] as unknown[] }));
const translate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../api/http", () => ({ requestJson: mocks.requestJson }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, role: "superadmin" } }) }));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock("../../../components/ui/SelectableItemsModal", () => ({ SelectableItemsModal: () => null }));
vi.mock("../../../shared/ui/PhoneInput", () => ({ PhoneInput: () => null }));
import { DoctorsPage } from "./DoctorsPage";

const doctorRows = [
  { id: 1, name: "Karimov Aziz", speciality: "Терапевт", percent: 30, active: true, serviceIds: [], room: "5", queuePrefix: "К" },
  { id: 2, name: "Aliyeva Nodira", speciality: "ЛОР", percent: 20, active: true, serviceIds: [], room: null, queuePrefix: null },
  { id: 3, name: "Rahimov Bek", speciality: "Хирург", percent: 25, active: true, serviceIds: [], room: "12", queuePrefix: null },
];

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.doctors = doctorRows;
  vi.stubGlobal("window", { setTimeout, clearTimeout, innerWidth: 1280, confirm: vi.fn(() => true) });
  mocks.requestJson.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === "/api/services") return [];
    if (path === "/api/doctors" && !options?.method) return mocks.doctors;
    return { id: 1 };
  });
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const render = async () => {
  await act(async () => {
    view = create(<DoctorsPage />);
  });
};
/** Clicks and lets the async handler (request + reload) finish inside act. */
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const type = (props: Record<string, string>, value: string) =>
  act(() => {
    view.root.findByProps(props).props.onChange({ target: { value } });
  });
const writes = (method: string) =>
  mocks.requestJson.mock.calls.filter(([, options]) => options?.method === method);

describe("doctor cabinet and queue letter", () => {
  it("shows the cabinet and the letter on the doctor card", async () => {
    await render();
    const cards = view.root.findAllByType("article").map(textOf);
    expect(cards[0]).toContain('doctors.roomShort {"room":"5"} · К');
    expect(cards[1]).not.toContain("doctors.roomShort");
    expect(cards[2]).toContain('doctors.roomShort {"room":"12"}');
    expect(cards[2]).not.toContain("·");
  });

  it("prefills both fields on edit, upper-cases the letter and saves them", async () => {
    await render();
    act(() => {
      buttons("common.edit")[0].props.onClick();
    });
    expect(view.root.findByProps({ id: "doctor-room" }).props.value).toBe("5");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("К");

    // No maxLength on the letter field: typing after the stored letter gives "Кб", and the last letter wins.
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.maxLength).toBeUndefined();
    type({ id: "doctor-queue-prefix" }, "Кб");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("Б");
    type({ id: "doctor-queue-prefix" }, "кУ");
    expect(view.root.findByProps({ id: "doctor-queue-prefix" }).props.value).toBe("У");
    type({ id: "doctor-room" }, " 7А ");
    await click(buttons("common.save")[0]);

    const [path, options] = writes("PUT")[0];
    expect(path).toBe("/api/doctors/1");
    expect(options.body).toMatchObject({ room: "7А", queuePrefix: "У" });
  });

  it("sends null for an empty cabinet and letter", async () => {
    await render();
    act(() => {
      buttons("doctors.addDoctor")[0].props.onClick();
    });
    type({ "aria-label": "Имя врача" }, "Yusupova Dilnoza");
    type({ "aria-label": "Специальность" }, "Педиатр");
    await click(buttons("common.save")[0]);

    const [path, options] = writes("POST")[0];
    expect(path).toBe("/api/doctors");
    expect(options.body).toMatchObject({ room: null, queuePrefix: null });
  });

  it("blocks saving a cabinet longer than 20 characters", async () => {
    await render();
    act(() => {
      buttons("doctors.addDoctor")[0].props.onClick();
    });
    type({ "aria-label": "Имя врача" }, "Yusupova Dilnoza");
    type({ "aria-label": "Специальность" }, "Педиатр");
    type({ id: "doctor-room" }, "x".repeat(21));
    await click(buttons("common.save")[0]);

    expect(textOf(view.root)).toContain("doctors.validation.roomTooLong");
    expect(writes("POST")).toHaveLength(0);
  });
});
