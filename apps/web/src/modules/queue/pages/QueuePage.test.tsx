import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../../../auth/types";
import type { QueueEntry, QueueToday } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  today: vi.fn(),
  call: vi.fn(),
  callNext: vi.fn(),
  updateAppointmentStatus: vi.fn(),
  completeAppointment: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(() => true),
}));
// Real Russian texts from ru.json, so the assertions read like the screen («Вызвать следующего · К-05»).
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
vi.mock("../api/queueApi", () => ({ queueApi: { today: mocks.today, call: mocks.call, callNext: mocks.callNext } }));
vi.mock("../../appointments/api/appointmentsFlowApi", () => ({
  appointmentsFlowApi: {
    updateAppointmentStatus: mocks.updateAppointmentStatus,
    completeAppointment: mocks.completeAppointment,
  },
}));
vi.mock("../components/DisplaysPanel", () => ({ DisplaysPanel: () => <div id="displays-panel" /> }));
import { QueuePage } from "./QueuePage";

const entry = (appointmentId: number, number: number, state: QueueEntry["state"], patientName: string): QueueEntry => ({
  appointmentId,
  doctorId: 10,
  patientId: appointmentId + 100,
  patientName,
  number,
  code: `К-${String(number).padStart(2, "0")}`,
  state,
  startAt: "2026-09-30 10:30:00",
  issuedAt: "2026-09-30T05:40:00.000Z",
  calledAt: state === "called" ? "2026-09-30T05:55:00.000Z" : null,
  callCount: state === "called" ? 1 : 0,
});
const today: QueueToday = {
  date: "2026-09-30",
  timeZone: "Asia/Tashkent",
  serverTime: "2026-09-30T06:00:00.000Z",
  doctors: [
    {
      doctorId: 10,
      doctorName: "Karimov Aziz",
      specialty: "Терапевт",
      room: "5",
      prefix: "К",
      serving: null,
      waiting: [entry(14, 4, "called", "Rahimov Bek"), entry(15, 5, "waiting", "Yusupova Dilnoza")],
      missed: [entry(12, 2, "missed", "Aliyeva Nodira")],
      doneCount: 1,
    },
  ],
};

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout, confirm: mocks.confirm });
  mocks.today.mockResolvedValue(today);
  mocks.callNext.mockResolvedValue({ entry: { ...entry(15, 5, "called", "Yusupova Dilnoza"), callCount: 1 } });
  mocks.updateAppointmentStatus.mockImplementation(async (_token: string, id: number, status: string) => ({
    id, status, queueCode: status === "arrived" ? "К-07" : null,
  }));
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const actionButtons = () => view.root.findAll((node) => node.type === "button" && node.props["data-action"] !== undefined);
const renderAs = async (role: UserRole, extra: Partial<PublicUser> = {}) => {
  mocks.user = { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z", ...extra };
  await act(async () => {
    view = create(<QueuePage />);
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};

describe("staff queue page", () => {
  it("shows the doctor their cabinet and calls the next waiting number", async () => {
    await renderAs("doctor", { doctorId: 10 });
    expect(mocks.today).toHaveBeenCalledTimes(1);
    expect(mocks.today.mock.calls[0][0]).toBeNull();
    const card = view.root.findByType("article");
    expect(card.props["aria-label"]).toBe("Karimov Aziz");
    expect(textOf(card)).toContain("Кабинет 5");
    expect(textOf(card)).toContain("Rahimov Bek");
    expect(textOf(card)).toContain("Запись на 10:30");

    const callNext = buttons("Вызвать следующего · К-05");
    expect(callNext).toHaveLength(1);
    await click(callNext[0]);
    expect(mocks.callNext).toHaveBeenCalledWith(10);
    expect(textOf(view.root)).toContain("Вызван К-05");
    expect(mocks.today).toHaveBeenCalledTimes(2);

    // The called patient gets start / re-call / not came; the doctor does not return missed patients.
    expect(buttons("Начать приём")).toHaveLength(1);
    expect(buttons("Повторить вызов")).toHaveLength(1);
    expect(buttons("Вернуть в очередь")).toHaveLength(0);
    expect(buttons("Экраны")).toHaveLength(0);
  });

  it("starts the visit of the called patient and asks before marking «Не пришёл»", async () => {
    await renderAs("doctor", { doctorId: 10 });
    await click(buttons("Начать приём")[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenLastCalledWith("isolated-test", 14, "in_consultation");

    mocks.confirm.mockReturnValueOnce(false);
    await click(buttons("Не пришёл")[0]);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.updateAppointmentStatus).toHaveBeenCalledTimes(1);

    await click(buttons("Не пришёл")[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenLastCalledWith("isolated-test", 14, "no_show");
  });

  it("shows managers the queue without any action buttons", async () => {
    await renderAs("manager");
    expect(textOf(view.root)).toContain("Yusupova Dilnoza");
    expect(textOf(view.root)).toContain("Aliyeva Nodira");
    expect(actionButtons()).toHaveLength(0);
    expect(buttons("Экраны")).toHaveLength(0);
  });

  it("lets reception return a missed patient to the queue", async () => {
    await renderAs("reception");
    const back = buttons("Вернуть в очередь");
    expect(back).toHaveLength(1);
    await click(back[0]);
    expect(mocks.updateAppointmentStatus).toHaveBeenCalledWith("isolated-test", 12, "arrived");
    expect(textOf(view.root)).toContain("Пациент снова в очереди: К-07");
    expect(mocks.today).toHaveBeenCalledTimes(2);
    // Reception cannot open the doctor's workspace.
    expect(buttons("Открыть приём")).toHaveLength(0);
  });

  it("gives superadmin the «Экраны» button that opens the TV screens panel", async () => {
    await renderAs("superadmin");
    expect(view.root.findAllByProps({ id: "displays-panel" })).toHaveLength(0);
    await click(buttons("Экраны")[0]);
    expect(view.root.findAllByProps({ id: "displays-panel" })).toHaveLength(1);
  });

  it("shows the empty state when no doctor has a queue today", async () => {
    mocks.today.mockResolvedValue({ ...today, doctors: [] });
    await renderAs("reception");
    expect(textOf(view.root)).toContain("Сегодня очереди пока нет");
    expect(view.root.findAllByType("article")).toHaveLength(0);
  });
});
