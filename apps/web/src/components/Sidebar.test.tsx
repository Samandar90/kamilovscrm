import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../auth/types";

const mocks = vi.hoisted(() => ({ user: null as PublicUser | null }));
const translate = (key: string) => `t:${key}`;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../hooks/usePlatformAccess", () => ({ usePlatformAccess: () => ({ isPlatformAdmin: false, loading: false }) }));
vi.mock("../shared/ui/Logo", () => ({ Logo: () => null }));
import { Sidebar } from "./Sidebar";

let view: ReactTestRenderer;
const consoleError = vi.spyOn(console, "error");
afterEach(() => { act(() => view.unmount()); consoleError.mockClear(); });
afterAll(() => consoleError.mockRestore());

const renderAs = (role: UserRole) => {
  mocks.user = { id: 1, username: "Test User", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  act(() => { view = create(<MemoryRouter><Sidebar /></MemoryRouter>); });
};
/** Each section renders as <div key={sectionKey}><div>{heading}</div>…</div> inside the <nav>. */
const sectionHeadings = () =>
  view.root.findByType("nav").children.map(section => {
    const heading = (section as ReactTestInstance).children[0] as ReactTestInstance;
    return heading.children.join("");
  });
/** The user card at the bottom: the name line, then the role line. */
const userCardLines = () => view.root.findAllByType("p").map(line => line.children.join(""));

describe("sidebar sections", () => {
  it("renders every section under its translated heading without React key warnings", () => {
    renderAs("superadmin");
    expect(sectionHeadings()).toEqual(["t:nav.main", "t:nav.reports", "t:nav.billing", "t:nav.admin"]);
    expect(consoleError).not.toHaveBeenCalled();
  });
  it("keeps each heading with its own section when the role hides other sections", () => {
    renderAs("cashier");
    expect(sectionHeadings()).toEqual(["t:nav.main", "t:nav.billing"]);
  });
});

describe("sidebar for an external contractor", () => {
  it("shows no sections and the translated role name in the user card", () => {
    renderAs("marketer");
    expect(sectionHeadings()).toEqual([]);
    expect(userCardLines()).toEqual(["Test User", "t:users.marketer"]);
    expect(consoleError).not.toHaveBeenCalled();
  });
  it("still names a staff role through the shared label map", () => {
    renderAs("reception");
    expect(userCardLines()).toEqual(["Test User", "t:users.receptionist"]);
  });
});
