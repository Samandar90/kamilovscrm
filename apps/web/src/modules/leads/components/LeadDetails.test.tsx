import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../../../auth/types";
import type { Lead } from "../api/leadsTypes";

type ModalProps = {
  open: boolean;
  token: string | null;
  initialName: string;
  initialPhone?: string;
  source?: string;
  error?: string | null;
  onClose: () => void;
  onCreated: (patient: { id: number; fullName: string }) => void;
  onError: (message: string | null) => void;
};
const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  update: vi.fn(),
  patientMatches: vi.fn(),
  setPatient: vi.fn(),
  onChange: vi.fn(),
  onConflict: vi.fn(),
  modal: null as ModalProps | null,
  /** Rights taken away for one test: every role that works with leads has both of them today. */
  denied: new Set<"patients.create" | "appointments.create">(),
}));
// Real Russian texts from ru.json, so the assertions read like the screen («Привязать»).
vi.mock("react-i18next", async () => {
  const ru = (await import("../../../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "ru" } }) };
});
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: mocks.user }) }));
vi.mock("../../../auth/roleGroups", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../auth/roleGroups")>();
  return {
    ...original,
    canCreatePatients: (role: UserRole | undefined | null) =>
      !mocks.denied.has("patients.create") && original.canCreatePatients(role),
    canCreateAppointments: (role: UserRole | undefined | null) =>
      !mocks.denied.has("appointments.create") && original.canCreateAppointments(role),
  };
});
// The real api/http needs VITE_API_URL and initialises i18next; the component only needs its error class.
vi.mock("../../../api/http", () => ({ HttpError: class HttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
} }));
vi.mock("../api/leadsApi", () => ({
  leadsApi: { update: mocks.update, patientMatches: mocks.patientMatches, setPatient: mocks.setPatient },
}));
vi.mock("../../appointments/components/CreatePatientModal", () => ({
  CreatePatientModal: (props: ModalProps) => {
    mocks.modal = props;
    return props.open ? <div id="create-patient-modal" /> : null;
  },
}));
import { HttpError } from "../../../api/http";
import { LeadDetails } from "./LeadDetails";

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: 52,
  createdAt: "2026-10-02T06:15:00.000Z",
  fullName: "Тестовый Лид",
  phone: "998901234567",
  extra: {},
  status: "in_progress",
  stage: "in_progress",
  note: null,
  sourceId: 3,
  sourceName: "Instagram",
  patientId: null,
  patientName: null,
  staffUpdatedAt: null,
  staffUpdatedByName: null,
  ...overrides,
});
const linked = (overrides: Partial<Lead> = {}): Lead => lead({ patientId: 9, patientName: "Тестовый Пациент", ...overrides });

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.modal = null;
  mocks.denied.clear();
});
afterEach(() => {
  if (view) act(() => view.unmount());
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const buttons = (label: string) => view.root.findAllByType("button").filter((b) => textOf(b) === label);
const actionButtons = () => view.root.findAll((node) => node.type === "button" && node.props["data-action"] !== undefined);
const statusSelect = () => view.root.findByProps({ id: "lead-status-52" });
const noteField = () => view.root.findByProps({ id: "lead-note-52" });
const element = (current: Lead) => <LeadDetails lead={current} onChange={mocks.onChange} onConflict={mocks.onConflict} />;
const renderAs = async (role: UserRole, current: Lead = lead()) => {
  mocks.user = { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  await act(async () => {
    view = create(element(current));
    await settle();
  });
};
const click = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onClick();
    await settle();
  });
};
const type = (node: ReactTestInstance, value: string) => act(() => node.props.onChange({ target: { value } }));

describe("lead details", () => {
  describe("sheet columns", () => {
    it("shows the other sheet columns as «заголовок: значение» text lines", async () => {
      await renderAs("operator", lead({
        extra: { "Город": "Ташкент", "Комментарий": "<b>срочно</b> https://example.test/a?b=1" },
      }));
      const lines = view.root.findAll((node) => node.type === "li" && node.props["data-extra"] !== undefined);
      expect(lines.map(textOf)).toEqual(["Город: Ташкент", "Комментарий: <b>срочно</b> https://example.test/a?b=1"]);
      // Cell text is never turned into markup or a link.
      expect(view.root.findAllByType("b")).toHaveLength(0);
      expect(view.root.findAllByType("a")).toHaveLength(0);
      expect(view.root.findAll((node) => node.props.dangerouslySetInnerHTML !== undefined)).toHaveLength(0);
    });

    it("leaves the block out when the sheet had no other columns", async () => {
      await renderAs("operator");
      expect(textOf(view.root)).not.toContain("Из таблицы");
    });
  });

  describe("status and note", () => {
    it("offers every status staff may set and starts from the stored one", async () => {
      await renderAs("operator", lead({ status: "no_answer", stage: "no_answer" }));
      const options = statusSelect().findAllByType("option");
      expect(options.map((option) => option.props.value)).toEqual(["in_progress", "no_answer", "booked", "declined", "invalid"]);
      expect(options.map(textOf)).toEqual(["В работе", "Не дозвонились", "Записан", "Отказ", "Некачественный"]);
      expect(statusSelect().props.value).toBe("no_answer");
    });

    it("shows «Новый» for a new lead without letting anyone choose it", async () => {
      await renderAs("operator", lead({ status: "new", stage: "new" }));
      const options = statusSelect().findAllByType("option");
      expect(options.map((option) => [option.props.value, option.props.disabled === true])).toEqual([
        ["new", true], ["in_progress", false], ["no_answer", false], ["booked", false], ["declined", false], ["invalid", false],
      ]);
      expect(statusSelect().props.value).toBe("new");
    });

    it("saves only the note when only the note changed", async () => {
      const saved = lead({ note: "перезвонить в 15:00" });
      mocks.update.mockResolvedValue(saved);
      await renderAs("operator");
      expect(buttons("Сохранить")[0].props.disabled).toBe(true);

      type(noteField(), "  перезвонить в 15:00 ");
      expect(buttons("Сохранить")[0].props.disabled).toBe(false);
      await click(buttons("Сохранить")[0]);
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update.mock.calls[0]).toStrictEqual([52, { note: "перезвонить в 15:00" }]);
      expect(mocks.onChange).toHaveBeenCalledWith(saved);

      // The parent hands the saved lead back: nothing is left to save.
      await act(async () => {
        view.update(element(saved));
        await settle();
      });
      expect(noteField().props.value).toBe("перезвонить в 15:00");
      expect(buttons("Сохранить")[0].props.disabled).toBe(true);
    });

    it("keeps an unsaved note when the lead's status changes outside the form", async () => {
      const taken = lead({ status: "in_progress", stage: "in_progress" });
      mocks.update.mockResolvedValue(lead({ note: "перезвонить после обеда" }));
      await renderAs("operator", lead({ status: "new", stage: "new" }));
      type(noteField(), "перезвонить после обеда");

      // «Взять в работу» in the row, or linking a patient, hands the same lead back with another status.
      await act(async () => {
        view.update(element(taken));
        await settle();
      });
      expect(statusSelect().props.value).toBe("in_progress");
      expect(noteField().props.value).toBe("перезвонить после обеда");
      expect(buttons("Сохранить")[0].props.disabled).toBe(false);

      await click(buttons("Сохранить")[0]);
      expect(mocks.update.mock.calls[0]).toStrictEqual([52, { note: "перезвонить после обеда" }]);
    });

    it("sends the status with the status it replaces", async () => {
      mocks.update.mockResolvedValue(lead({ status: "no_answer", stage: "no_answer" }));
      await renderAs("reception");
      type(statusSelect(), "no_answer");
      await click(buttons("Сохранить")[0]);
      expect(mocks.update.mock.calls[0]).toStrictEqual([52, { status: "no_answer", expectedStatus: "in_progress" }]);
    });

    it("saves the status and the note together and clears an emptied note", async () => {
      mocks.update.mockResolvedValue(lead({ status: "declined", stage: "declined" }));
      await renderAs("manager", lead({ note: "думает" }));
      expect(noteField().props.value).toBe("думает");
      type(statusSelect(), "declined");
      type(noteField(), "   ");
      await click(buttons("Сохранить")[0]);
      expect(mocks.update.mock.calls[0]).toStrictEqual([52, { status: "declined", expectedStatus: "in_progress", note: null }]);
    });

    it("hands a 409 to the page instead of showing a stale form", async () => {
      mocks.update.mockRejectedValue(new HttpError("Статус лида уже изменён", 409));
      await renderAs("operator");
      type(statusSelect(), "booked");
      await click(buttons("Сохранить")[0]);
      expect(mocks.onConflict).toHaveBeenCalledTimes(1);
      expect(mocks.onChange).not.toHaveBeenCalled();
      expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    });

    it("shows the server's message when saving fails and keeps what was typed", async () => {
      mocks.update.mockRejectedValue(new HttpError("Заметка слишком длинная", 400));
      await renderAs("operator");
      type(noteField(), "текст");
      await click(buttons("Сохранить")[0]);
      expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Заметка слишком длинная");
      expect(noteField().props.value).toBe("текст");
      expect(mocks.onChange).not.toHaveBeenCalled();
      expect(mocks.onConflict).not.toHaveBeenCalled();
    });

    it("explains a badge that comes from the linked patient's appointment", async () => {
      await renderAs("operator", linked({ stage: "booked" }));
      expect(textOf(view.root)).toContain("«Записан» показан по записи привязанного пациента.");
      act(() => view.unmount());
      await renderAs("operator", linked());
      expect(textOf(view.root)).not.toContain("показан по записи привязанного пациента");
    });
  });

  describe("patient, not linked", () => {
    it("«Найти пациента» lists the candidates and «Привязать» links the chosen one", async () => {
      mocks.patientMatches.mockResolvedValue({
        items: [
          { id: 9, fullName: "Тестовый Пациент", phone: "+998901234567" },
          { id: 12, fullName: "Тестовая Пациентка", phone: null },
        ],
      });
      const updated = linked();
      mocks.setPatient.mockResolvedValue(updated);
      await renderAs("operator");
      expect(mocks.patientMatches).not.toHaveBeenCalled();

      await click(buttons("Найти пациента")[0]);
      expect(mocks.patientMatches).toHaveBeenCalledWith(52);
      const candidates = view.root.findAll((node) => node.type === "li" && node.props["data-match"] !== undefined);
      expect(candidates.map(textOf)).toEqual(["Тестовый Пациент+998901234567Привязать", "Тестовая ПациенткаПривязать"]);

      await click(buttons("Привязать")[1]);
      expect(mocks.setPatient).toHaveBeenCalledWith(52, 12);
      expect(mocks.onChange).toHaveBeenCalledWith(updated);
    });

    it("says when nobody has this phone", async () => {
      mocks.patientMatches.mockResolvedValue({ items: [] });
      await renderAs("operator");
      await click(buttons("Найти пациента")[0]);
      expect(textOf(view.root)).toContain("Пациентов с таким номером не найдено");
      expect(buttons("Привязать")).toHaveLength(0);
    });

    it("shows why the search failed", async () => {
      mocks.patientMatches.mockRejectedValue(new HttpError("Доступ запрещён", 403));
      await renderAs("operator");
      await click(buttons("Найти пациента")[0]);
      expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("Доступ запрещён");
    });

    it("«Создать пациента» opens the patient form with the lead's name, phone and the advertising source, then links", async () => {
      const updated = linked({ patientId: 77 });
      mocks.setPatient.mockResolvedValue(updated);
      await renderAs("reception");
      expect(view.root.findAllByProps({ id: "create-patient-modal" })).toHaveLength(0);

      await click(buttons("Создать пациента")[0]);
      expect(view.root.findAllByProps({ id: "create-patient-modal" })).toHaveLength(1);
      expect(mocks.modal).toMatchObject({
        open: true,
        token: "isolated-test",
        initialName: "Тестовый Лид",
        initialPhone: "+998901234567",
        source: "advertising",
      });

      // The form reports its own validation message; it is shown inside the dialog.
      act(() => mocks.modal?.onError("Имя пациента слишком короткое"));
      expect(mocks.modal?.error).toBe("Имя пациента слишком короткое");

      await act(async () => {
        mocks.modal?.onCreated({ id: 77, fullName: "Тестовый Лид" });
        await settle();
      });
      expect(mocks.setPatient).toHaveBeenCalledWith(52, 77);
      expect(mocks.onChange).toHaveBeenCalledWith(updated);
      expect(view.root.findAllByProps({ id: "create-patient-modal" })).toHaveLength(0);
    });

    it("starts the form with an empty name for a lead without one", async () => {
      await renderAs("reception", lead({ fullName: null }));
      await click(buttons("Создать пациента")[0]);
      expect(mocks.modal?.initialName).toBe("");
    });

    it("hides «Создать пациента» from a role that cannot create patients", async () => {
      mocks.denied.add("patients.create");
      await renderAs("operator");
      expect(buttons("Создать пациента")).toHaveLength(0);
      expect(buttons("Найти пациента")).toHaveLength(1);
    });
  });

  describe("patient, linked", () => {
    it("shows the patient, the booking link and «Отвязать»", async () => {
      const updated = lead();
      mocks.setPatient.mockResolvedValue(updated);
      await renderAs("operator", linked());
      expect(textOf(view.root)).toContain("Тестовый Пациент");
      expect(buttons("Найти пациента")).toHaveLength(0);
      expect(buttons("Создать пациента")).toHaveLength(0);
      const book = view.root.findByType("a");
      expect(book.props.href).toBe("/appointments?patientId=9");
      expect(textOf(book)).toBe("Записать на приём");

      await click(buttons("Отвязать")[0]);
      expect(mocks.setPatient).toHaveBeenCalledWith(52, null);
      expect(mocks.onChange).toHaveBeenCalledWith(updated);
    });

    it("names a patient the list gave no name for by number", async () => {
      await renderAs("operator", linked({ patientName: null }));
      expect(textOf(view.root)).toContain("Пациент #9");
    });

    it("hides «Записать на приём» from a role that cannot create appointments", async () => {
      mocks.denied.add("appointments.create");
      await renderAs("operator", linked());
      expect(view.root.findAllByType("a")).toHaveLength(0);
      expect(buttons("Отвязать")).toHaveLength(1);
    });
  });

  it("ignores a second press while the first request is running", async () => {
    let finish!: (value: Lead) => void;
    mocks.setPatient.mockReturnValue(new Promise<Lead>((resolve) => (finish = resolve)));
    await renderAs("operator", linked());
    await click(buttons("Отвязать")[0]);
    await click(buttons("Отвязать")[0]);
    expect(mocks.setPatient).toHaveBeenCalledTimes(1);
    expect(actionButtons().every((button) => button.props.disabled === true)).toBe(true);
    await act(async () => {
      finish(lead());
      await settle();
    });
    expect(mocks.onChange).toHaveBeenCalledTimes(1);
  });

  it("gives a role without leads update the texts only", async () => {
    await renderAs("director", linked({ note: "думает", extra: { "Город": "Ташкент" } }));
    expect(textOf(view.root)).toContain("Город: Ташкент");
    expect(textOf(view.root)).toContain("думает");
    expect(textOf(view.root)).toContain("Тестовый Пациент");
    expect(actionButtons()).toHaveLength(0);
    expect(view.root.findAllByType("button")).toHaveLength(0);
    expect(view.root.findAllByType("select")).toHaveLength(0);
    expect(view.root.findAllByType("textarea")).toHaveLength(0);
  });
});
