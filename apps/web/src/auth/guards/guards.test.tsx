import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: { isAuthenticated: false, isLoading: true, error: null as string | null } }));
vi.mock("../AuthContext", () => ({ useAuth: () => mocks.auth }));
import { GuestRoute } from "./GuestRoute";
import { ProtectedRoute } from "./ProtectedRoute";

let view: ReactTestRenderer | undefined;
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

const render = (Guard: typeof ProtectedRoute, auth: typeof mocks.auth) => {
  mocks.auth = auth;
  act(() => {
    view = create(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Guard>
          <span>page</span>
        </Guard>
      </MemoryRouter>,
    );
  });
  return JSON.stringify(view!.toJSON());
};

describe.each([
  ["ProtectedRoute", ProtectedRoute],
  ["GuestRoute", GuestRoute],
])("%s while the session is being restored", (_name, Guard) => {
  it("shows only the loading screen", () => {
    const html = render(Guard, { isAuthenticated: false, isLoading: true, error: null });
    expect(html).toContain("Loading...");
    expect(html).not.toContain("page");
  });

  it("says why it is taking long when the API does not answer", () => {
    const html = render(Guard, { isAuthenticated: false, isLoading: true, error: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." });
    expect(html).toContain("Loading...");
    expect(html).toContain("Нет связи с сервером.");
    expect(html).not.toContain("page");
  });
});
