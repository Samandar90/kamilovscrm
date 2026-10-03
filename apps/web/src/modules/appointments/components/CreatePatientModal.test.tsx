import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createPatient: vi.fn(), onCreated: vi.fn(), onError: vi.fn() }));
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
// Modal portals into document.body, which does not exist in the node test environment.
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock("../api/appointmentsFlowApi", () => ({ appointmentsFlowApi: { createPatient: mocks.createPatient } }));
import { CreatePatientModal } from "./CreatePatientModal";

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPatient.mockResolvedValue({ id: 77, fullName: "Тестовый Пациент" });
});
afterEach(() => {
  if (view) act(() => view.unmount());
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const phoneInput = () => view.root.findByProps({ type: "tel" });
const render = async (extra: Partial<React.ComponentProps<typeof CreatePatientModal>> = {}) => {
  await act(async () => {
    view = create(
      <CreatePatientModal
        open
        token="isolated-test"
        initialName="Тестовый Пациент"
        submitting={false}
        onClose={() => undefined}
        onCreated={mocks.onCreated}
        onError={mocks.onError}
        {...extra}
      />
    );
    await settle();
  });
};
const submit = async () => {
  const button = view.root.findAllByType("button").find((item) => textOf(item) === "appointments.create")!;
  await act(async () => {
    button.props.onClick();
    await settle();
  });
};

describe("create patient dialog", () => {
  it("starts with an empty phone and sends no source unless told to", async () => {
    await render();
    expect(phoneInput().props.value).toBe("");
    act(() => phoneInput().props.onChange({ target: { value: "+998901234567", selectionStart: 13 } }));
    await submit();
    expect(mocks.createPatient).toHaveBeenCalledTimes(1);
    expect(mocks.createPatient.mock.calls[0]).toStrictEqual([
      "isolated-test",
      { fullName: "Тестовый Пациент", phone: "+998901234567", birthDate: null, gender: "male" },
    ]);
    expect(mocks.onCreated).toHaveBeenCalledWith({ id: 77, fullName: "Тестовый Пациент" });
  });

  it("starts with the given phone and sends the given source", async () => {
    await render({ initialPhone: "+998901234567", source: "advertising" });
    expect(String(phoneInput().props.value).replace(/\D/g, "")).toBe("998901234567");
    await submit();
    expect(mocks.createPatient.mock.calls[0]).toStrictEqual([
      "isolated-test",
      { fullName: "Тестовый Пациент", phone: "+998901234567", birthDate: null, gender: "male", source: "advertising" },
    ]);
  });

  it("shows the error it is given inside the dialog", async () => {
    await render();
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    act(() => view.unmount());
    await render({ error: "appointments.patientNameTooShort" });
    expect(textOf(view.root.findByProps({ role: "alert" }))).toBe("appointments.patientNameTooShort");
  });
});
