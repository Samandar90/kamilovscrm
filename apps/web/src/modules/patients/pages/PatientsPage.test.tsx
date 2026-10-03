import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestJson: vi.fn(), role: "manager" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("../../../api/http", () => ({ requestJson: mocks.requestJson }));
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ token: "isolated-test", user: { id: 1, role: mocks.role } }) }));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock("../../../shared/ui/PhoneInput", () => ({ PhoneInput: () => null }));
vi.mock("../../questionnaires/components/PatientQuestionnairesPanel", () => ({ PatientQuestionnairesPanel: () => null }));
import { PatientsPage } from "./PatientsPage";

const patients = [
  { id: 1, fullName: "Алиев Сардор", phone: "+998901112233", birthDate: "1990-05-01", gender: "male", source: null, notes: null, createdAt: "2026-09-01T05:00:00.000Z" },
  { id: 2, fullName: "Юсупова Мадина", phone: "+998912223344", birthDate: null, gender: "female", source: null, notes: null, createdAt: "2026-09-02T05:00:00.000Z" },
];
const LAST_VISITS = "/api/appointments/last-visits";

let view: ReactTestRenderer;
/** Answer per address; an Error is thrown, every other address answers with an empty list. */
let answers: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "manager";
  answers = { "/api/patients": patients, [LAST_VISITS]: [{ patientId: 1, lastVisitAt: "2026-10-02 09:30:00" }] };
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.requestJson.mockImplementation(async (path: string) => {
    const answer = path in answers ? answers[path] : [];
    if (answer instanceof Error) throw answer;
    return answer;
  });
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.unstubAllGlobals();
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
/** Renders the page and lets its chain of requests finish inside act. */
const render = async () => {
  await act(async () => {
    view = create(<PatientsPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const requestedPaths = () => mocks.requestJson.mock.calls.map(([path]) => path);
/** Desktop table: full name → text of the last visit cell. */
const lastVisitCells = () =>
  Object.fromEntries(
    view.root.findByType("tbody").findAllByType("tr").map((row) => {
      const cells = row.findAllByType("td");
      return [textOf(cells[0]), textOf(cells[3])];
    })
  );

describe("last visit on the Patients page", () => {
  it("asks the server for the last visits and does not download the appointment list", async () => {
    await render();
    expect(requestedPaths()).toEqual(["/api/patients", LAST_VISITS, "/api/invoices"]);
  });

  it("shows the last visit of each patient and a dash for a patient without visits", async () => {
    await render();
    expect(lastVisitCells()).toEqual({ "Алиев Сардор": "02.10.2026, 09:30:00", "Юсупова Мадина": "—" });
  });

  it("keeps the patient list and warns when the last visits fail to load", async () => {
    answers[LAST_VISITS] = new Error("Сервис временно недоступен");
    await render();
    expect(textOf(view.root)).toContain(
      "Не удалось загрузить через API: записи визитов. Список пациентов — из API; блоки «последний визит» и «долг» могут быть неполными."
    );
    expect(lastVisitCells()).toEqual({ "Алиев Сардор": "—", "Юсупова Мадина": "—" });
  });

  it("names the visits and the invoices in one warning when neither loads", async () => {
    answers[LAST_VISITS] = new Error("Сервис временно недоступен");
    answers["/api/invoices"] = new Error("Сервис временно недоступен");
    await render();
    expect(textOf(view.root)).toContain("Не удалось загрузить через API: записи визитов и счета для расчёта долгов.");
  });

  it("does not ask for invoices for a role that sees no debts", async () => {
    mocks.role = "reception";
    await render();
    expect(requestedPaths()).toEqual(["/api/patients", LAST_VISITS]);
  });
});
