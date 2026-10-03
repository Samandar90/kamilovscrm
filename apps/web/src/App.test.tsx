import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./router/AppRouter", () => ({ AppRouter: () => <span>staff</span> }));
vi.mock("./auth/AuthContext", () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./modules/queue/tv/TvApp", () => ({ TvApp: () => <span>tv</span> }));
vi.mock("./modules/app-update/AppUpdateWatcher", () => ({ AppUpdateWatcher: () => <span>update-watcher</span> }));
import App from "./App";

let view: ReactTestRenderer | undefined;
const open = async (path: string) => {
  await act(async () => {
    view = create(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>,
    );
  });
  return JSON.stringify(view!.toJSON());
};
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
});

describe("App", () => {
  it("keeps staff pages on the deployed version", async () => {
    for (const path of ["/", "/login", "/appointments", "/queue"]) {
      const html = await open(path);
      expect(html).toContain("staff");
      expect(html).toContain("update-watcher");
      act(() => view!.unmount());
      view = undefined;
    }
  });

  it("never mounts the update watcher on the TV screen: a hall TV reloads only at night", async () => {
    for (const path of ["/tv", "/tv/K7M2Q-9XR4P", "/TV/K7M2Q-9XR4P"]) {
      const html = await open(path);
      expect(html).toContain("tv");
      expect(html).not.toContain("update-watcher");
      expect(html).not.toContain("staff");
      act(() => view!.unmount());
      view = undefined;
    }
  });
});
