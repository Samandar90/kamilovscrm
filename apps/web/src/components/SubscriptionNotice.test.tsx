import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../auth/types";
import { SALES_CONTACTS } from "../shared/config/branding";

const mocks = vi.hoisted(() => ({
  user: null as PublicUser | null,
  logout: vi.fn(),
  clinic: { subscriptionStatus: "active", subscriptionDaysLeft: null as number | null },
  listeners: new Map<string, (event: { detail?: string }) => void>(),
}));
// Real Russian texts from ru.json, so the assertions read like the screen.
vi.mock("react-i18next", async () => {
  const ru = (await import("../locales/ru.json")).default as unknown as Record<string, unknown>;
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ru);
    const text = typeof value === "string" ? value : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: mocks.user, logout: mocks.logout }) }));
vi.mock("../hooks/useClinic", () => ({ useClinic: () => ({ clinic: mocks.clinic }) }));
import { PAYMENT_REQUIRED_EVENT, SubscriptionNotice } from "./SubscriptionNotice";

/** What the API says with a 402: the vendor's wording with a date, meant for the clinic's staff. */
const API_MESSAGE = "Подписка клиники истекла 01.10.2026. Продлите подписку.";

let view: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clinic = { subscriptionStatus: "active", subscriptionDaysLeft: null };
  mocks.listeners.clear();
  // The component listens on window; tests run in node without a DOM.
  vi.stubGlobal("window", {
    addEventListener: (name: string, listener: (event: { detail?: string }) => void) => mocks.listeners.set(name, listener),
    removeEventListener: (name: string) => mocks.listeners.delete(name),
  });
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const screen = () => (view.toJSON() === null ? "" : textOf(view.root));
const links = () => view.root.findAllByType("a").map((link) => link.props.href);
const renderAs = (role: UserRole) => {
  mocks.user = { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  act(() => {
    view = create(<SubscriptionNotice />);
  });
};
/** The HTTP client reports a 402 with this event. */
const paymentRequired = (detail: string) => act(() => mocks.listeners.get(PAYMENT_REQUIRED_EVENT)?.({ detail }));

describe("subscription block on 402", () => {
  it("tells an external contractor only to contact the clinic: no vendor contact, no dates", () => {
    renderAs("marketer");
    expect(screen()).toBe("");
    paymentRequired(API_MESSAGE);

    expect(textOf(view.root.findByType("h2"))).toBe("Доступ временно недоступен. Обратитесь в клинику.");
    expect(screen()).not.toContain(API_MESSAGE);
    expect(screen()).not.toContain("Доступ приостановлен");
    expect(screen()).not.toContain("Свяжитесь с нами");
    expect(screen()).not.toContain(SALES_CONTACTS.phone);
    expect(screen()).not.toContain(SALES_CONTACTS.telegram);
    expect(screen()).not.toMatch(/\d/);
    expect(links()).toEqual([]);

    // The only thing left to do on the blocked screen is to sign out.
    const buttons = view.root.findAllByType("button");
    expect(buttons.map(textOf)).toEqual(["Выйти"]);
    act(() => buttons[0].props.onClick());
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the staff block: the API's message and the vendor's contacts", () => {
    renderAs("reception");
    paymentRequired(API_MESSAGE);

    expect(textOf(view.root.findByType("h2"))).toBe("Доступ приостановлен");
    expect(screen()).toContain(API_MESSAGE);
    expect(screen()).toContain("Свяжитесь с нами");
    expect(screen()).not.toContain("Обратитесь в клинику");
    expect(links()).toEqual([SALES_CONTACTS.phoneHref, SALES_CONTACTS.telegramHref]);
    expect(view.root.findAllByType("button").map(textOf)).toEqual(["Выйти"]);
  });

  it("keeps the default text for staff when the API sent none", () => {
    renderAs("superadmin");
    paymentRequired("  ");
    expect(screen()).toContain("Срок подписки истёк. Продлите подписку, чтобы продолжить работу.");
    expect(links()).toEqual([SALES_CONTACTS.phoneHref, SALES_CONTACTS.telegramHref]);
  });
});

describe("trial banner", () => {
  beforeEach(() => {
    mocks.clinic = { subscriptionStatus: "trialing", subscriptionDaysLeft: 5 };
  });

  it("is shown to staff with the vendor's contact", () => {
    renderAs("reception");
    expect(screen()).toContain("Осталось 5 дн. пробного периода");
    expect(links()).toEqual([SALES_CONTACTS.telegramHref]);
  });

  it("is never shown to an external contractor", () => {
    renderAs("marketer");
    expect(view.toJSON()).toBeNull();
  });
});
