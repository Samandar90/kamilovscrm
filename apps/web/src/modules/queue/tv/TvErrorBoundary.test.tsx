import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TvErrorBoundary } from "./TvErrorBoundary";

function Boom(): React.ReactElement {
  throw new Error("malformed payload");
}

const reload = vi.fn();
let online: boolean;
let view: ReactTestRenderer | undefined;
const html = () => JSON.stringify(view!.toJSON());

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  online = true;
  // React reports every error a boundary catches through console.error; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // Delegate lazily so the fake timers installed above are used.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
    location: { reload },
  });
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (children: React.ReactNode) => {
  await act(async () => {
    view = create(<TvErrorBoundary>{children}</TvErrorBoundary>);
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("TvErrorBoundary", () => {
  it("renders the TV while nothing fails", async () => {
    await mount(<span>board</span>);
    expect(html()).toContain("board");
    await advance(120_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("replaces a crashed TV with a bilingual notice and reloads the page a minute later", async () => {
    await mount(<Boom />);
    expect(html()).toContain("Экран перезагружается…");
    await advance(59_999);
    expect(reload).not.toHaveBeenCalled();
    await advance(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("catches a TV chunk that fails to load", async () => {
    const Lazy = React.lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    await mount(
      <React.Suspense fallback={null}>
        <Lazy />
      </React.Suspense>,
    );
    expect(html()).toContain("Экран перезагружается");
    await advance(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for the network before reloading, so the TV never lands on the browser's offline page", async () => {
    online = false;
    await mount(<Boom />);
    await advance(180_000);
    expect(reload).not.toHaveBeenCalled();
    online = true;
    await advance(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("drops the pending reload when unmounted", async () => {
    await mount(<Boom />);
    act(() => view!.unmount());
    view = undefined;
    await advance(60_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
