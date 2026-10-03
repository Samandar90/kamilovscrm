import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, UserRole } from "../auth/types";

const mocks = vi.hoisted(() => {
  const rendered: string[] = [];
  return {
    user: null as PublicUser | null,
    /** Names of the page stubs that were rendered, in order. */
    rendered,
    /** Path the protected layout was last rendered at. */
    path: null as string | null,
    /** A page that renders its own name instead of loading the real module. */
    page: (name: string) => () => {
      rendered.push(name);
      return `page:${name}`;
    },
  };
});
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isAuthenticated: mocks.user !== null, isLoading: false }),
}));
vi.mock("../layouts/MainLayout", async () => {
  const router = await import("react-router-dom");
  return {
    MainLayout: ({ children }: { children: React.ReactNode }) => {
      mocks.path = router.useLocation().pathname;
      return children;
    },
  };
});
// The real pages pull the HTTP client, charts and PDF code, and some of them start requests on mount: the router is
// tested with stubs, so nothing here loads them or reaches the network.
vi.mock("../shared/ui/PageLoader", () => ({ PageLoader: () => "loading" }));
vi.mock("../modules/dashboard/pages/DashboardPage", () => ({ DashboardPage: mocks.page("dashboard") }));
vi.mock("../modules/patients/pages/PatientsPage", () => ({ PatientsPage: mocks.page("patients") }));
vi.mock("../modules/appointments/pages/AppointmentsPage", () => ({ AppointmentsPage: mocks.page("appointments") }));
vi.mock("../modules/billing/pages/InvoiceDetailsPage", () => ({ InvoiceDetailsPage: mocks.page("invoice") }));
vi.mock("../modules/billing/pages/InvoicesPage", () => ({ InvoicesPage: mocks.page("invoices") }));
vi.mock("../modules/billing/pages/CashDeskPage", () => ({ CashDeskPage: mocks.page("cash-desk") }));
vi.mock("../modules/billing/pages/CashShiftPage", () => ({ CashShiftPage: mocks.page("cash-shift") }));
vi.mock("../modules/billing/pages/PaymentsReadOnlyPage", () => ({ PaymentsReadOnlyPage: mocks.page("payments") }));
vi.mock("../modules/expenses/pages/ExpensesPage", () => ({ ExpensesPage: mocks.page("expenses") }));
vi.mock("../modules/reports/pages/ReportsPage", () => ({ ReportsPage: mocks.page("reports") }));
vi.mock("../modules/system/pages/ArchitecturePage", () => ({ ArchitecturePage: mocks.page("architecture") }));
vi.mock("../modules/platform/pages/PlatformPage", () => ({ PlatformPage: mocks.page("platform") }));
vi.mock("../modules/landing/LandingPage", () => ({ LandingPage: mocks.page("landing") }));
vi.mock("../modules/users/pages/UsersPage", () => ({ UsersPage: mocks.page("users") }));
vi.mock("../modules/attendance/pages/AttendancePage", () => ({ AttendancePage: mocks.page("attendance") }));
vi.mock("../modules/call-center/pages/CallCenterPage", () => ({ CallCenterPage: mocks.page("call-center") }));
vi.mock("../modules/queue/pages/QueuePage", () => ({ QueuePage: mocks.page("queue") }));
vi.mock("../modules/leads/pages/LeadsPage", () => ({ LeadsPage: mocks.page("leads") }));
vi.mock("../modules/leads/pages/MyLeadsPage", () => ({ MyLeadsPage: mocks.page("my-leads") }));
vi.mock("../modules/services/pages/ServicesPage", () => ({ ServicesPage: mocks.page("services") }));
vi.mock("../modules/doctors/pages/DoctorsPage", () => ({ DoctorsPage: mocks.page("doctors") }));
vi.mock("../modules/auth/pages/LoginPage", () => ({ LoginPage: mocks.page("login") }));
vi.mock("../modules/auth/pages/RegisterPage", () => ({ RegisterPage: mocks.page("register") }));
vi.mock("../modules/ai-assistant/pages/AIAssistantPage", () => ({ AIAssistantPage: mocks.page("ai-assistant") }));
vi.mock("../modules/doctor-workspace/pages/DoctorWorkspacePage", () => ({ DoctorWorkspacePage: mocks.page("doctor-workspace") }));
vi.mock("../modules/my-services/pages/MyServicesPage", () => ({ MyServicesPage: mocks.page("my-services") }));
vi.mock("../modules/questionnaires/pages/QuestionnairesPage", () => ({ QuestionnairesPage: mocks.page("questionnaires") }));
import { AppRouter, RoleAwareHomeRedirect } from "./AppRouter";

let view: ReactTestRenderer | null = null;
beforeEach(() => {
  mocks.rendered.length = 0;
  mocks.path = null;
  mocks.user = null;
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = null;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const signIn = (role: UserRole | null) => {
  mocks.user = role ? { id: 1, username: "user", role, isActive: true, createdAt: "2026-01-01T00:00:00Z" } : null;
};
const Probe: React.FC = () => <>{`at:${useLocation().pathname}`}</>;
/** What is on the screen: the stubs render plain text, so the whole tree is one string. */
const shown = (): unknown => view!.toJSON();

/** The home element alone, with a probe on every other path: shows where it redirects. */
const renderHome = (role: UserRole) => {
  signIn(role);
  act(() => {
    view = create(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<RoleAwareHomeRedirect />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );
  });
  return shown();
};

/** The whole router at `path`; waits for a lazy page to load. */
const open = async (role: UserRole | null, path: string) => {
  signIn(role);
  await act(async () => {
    view = create(
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    );
    await settle();
  });
  for (let turn = 0; turn < 20 && shown() === "loading"; turn += 1) {
    await act(async () => {
      await settle();
    });
  }
  return shown();
};

describe("home element by role", () => {
  it("sends the external contractor to /my-leads and never renders the dashboard", () => {
    expect(renderHome("marketer")).toBe("at:/my-leads");
    expect(mocks.rendered).toEqual([]);
  });

  it("shows the dashboard to reception", () => {
    expect(renderHome("reception")).toBe("page:dashboard");
  });

  it.each<[UserRole, string]>([
    ["nurse", "at:/appointments"],
    ["cashier", "at:/billing/cash-desk"],
    ["accountant", "at:/reports"],
  ])("still sends %s to its own section", (role, expected) => {
    expect(renderHome(role)).toBe(expected);
    expect(mocks.rendered).toEqual([]);
  });

  it.each<UserRole>(["superadmin", "doctor", "operator", "manager", "director"])("still shows the dashboard to %s", (role) => {
    expect(renderHome(role)).toBe("page:dashboard");
  });
});

describe("routes of the external contractor", () => {
  it("opens /my-leads for the contractor", async () => {
    expect(await open("marketer", "/my-leads")).toBe("page:my-leads");
    expect(mocks.path).toBe("/my-leads");
    expect(mocks.rendered).toEqual(["my-leads"]);
  });

  it.each(["/", "/dashboard", "/leads", "/patients", "/appointments", "/ai-assistant", "/reports", "/users", "/queue", "/billing/cash-desk", "/no-such-page"])(
    "brings the contractor from %s to /my-leads without rendering a staff page",
    async (path) => {
      expect(await open("marketer", path)).toBe("page:my-leads");
      expect(mocks.path).toBe("/my-leads");
      expect(mocks.rendered.filter((name) => name !== "my-leads")).toEqual([]);
    }
  );

  it.each<UserRole>(["superadmin", "reception", "operator", "manager", "director", "doctor"])(
    "does not open /my-leads for %s: the home page instead",
    async (role) => {
      expect(await open(role, "/my-leads")).toBe("page:dashboard");
      expect(mocks.path).toBe("/dashboard");
      expect(mocks.rendered).not.toContain("my-leads");
    }
  );

  it("asks a guest to sign in", async () => {
    expect(await open(null, "/my-leads")).toBe("page:login");
    expect(mocks.rendered).not.toContain("my-leads");
  });
});

describe("staff leads route", () => {
  it.each<UserRole>(["superadmin", "reception", "operator", "manager"])("opens /leads for %s", async (role) => {
    expect(await open(role, "/leads")).toBe("page:leads");
    expect(mocks.path).toBe("/leads");
  });

  it.each<UserRole>(["director", "doctor"])("does not open /leads for %s", async (role) => {
    expect(await open(role, "/leads")).toBe("page:dashboard");
    expect(mocks.rendered).not.toContain("leads");
  });
});
