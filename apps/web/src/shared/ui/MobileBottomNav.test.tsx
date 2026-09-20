import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "../../auth/types";

const mocks = vi.hoisted(() => ({ user: null as PublicUser | null }));
const translate = (key: string) => `t:${key}`;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
import { MobileBottomNav } from "./MobileBottomNav";

let view: ReactTestRenderer;
beforeEach(() => {
  mocks.user = { id: 1, username: "Test User", role: "superadmin", isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  // The open drawer listens for Escape on window; tests run in node without a DOM.
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => view.unmount()); vi.unstubAllGlobals(); });

describe("mobile 'more' drawer", () => {
  it("labels every link with its own translated labelKey", () => {
    act(() => { view = create(<MemoryRouter initialEntries={["/dashboard"]}><MobileBottomNav /></MemoryRouter>); });
    act(() => view.root.findByProps({ "aria-haspopup": "dialog" }).props.onClick());
    const labels = view.root.findByProps({ role: "dialog" }).findAllByType("li").map(li => li.findByType("span").children.join(""));
    expect(labels).not.toHaveLength(0);
    expect(labels.filter(label => !/^t:\w+(\.\w+)+$/.test(label))).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
