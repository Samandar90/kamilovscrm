import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../auth/types";

const mocks = vi.hoisted(() => ({ user: null as PublicUser | null }));
const translate = (key: string) => `t:${key}`;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: mocks.user, logout: vi.fn() }) }));
vi.mock("../hooks/useClinic", () => ({ useClinic: () => ({ clinic: { name: "Test Clinic" } }) }));
// The layout's blocks have their own tests or need a browser: only the header title is checked here.
vi.mock("../components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../shared/ui/MobileBottomNav", () => ({ MobileBottomNav: () => null }));
vi.mock("../components/SubscriptionNotice", () => ({ SubscriptionNotice: () => null }));
vi.mock("../components/ImpersonationBanner", () => ({ ImpersonationBanner: () => null }));
vi.mock("../components/ChangePasswordModal", () => ({ ChangePasswordModal: () => null }));
vi.mock("../components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("../shared/ui/Logo", () => ({ Logo: () => null }));
import { MainLayout } from "./MainLayout";

let view: ReactTestRenderer;
const page = { title: "" };
beforeEach(() => {
  page.title = "";
  vi.stubGlobal("document", page);
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
});

const titleAt = (path: string, role: UserRole) => {
  mocks.user = { id: 1, username: "Test User", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
  act(() => {
    view = create(
      <MemoryRouter initialEntries={[path]}>
        <MainLayout>{null}</MainLayout>
      </MemoryRouter>
    );
  });
  return view.root.findByType("h1").children.join("");
};

describe("page title in the header", () => {
  it("names the contractor's page «Мои лиды», not the dashboard", () => {
    expect(titleAt("/my-leads", "marketer")).toBe("t:pages.myLeads");
    expect(page.title).toBe("Test Clinic — t:pages.myLeads");
  });
  it("keeps the titles of the staff pages", () => {
    expect(titleAt("/leads", "operator")).toBe("t:pages.leads");
  });
  it("keeps «Мои услуги» for /my-services", () => {
    expect(titleAt("/my-services", "doctor")).toBe("t:pages.myServices");
  });
});
