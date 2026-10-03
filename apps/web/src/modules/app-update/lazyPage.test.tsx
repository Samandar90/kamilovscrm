import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recover: vi.fn(() => true) }));
vi.mock("./appUpdate", () => ({ recoverFromMissingChunk: mocks.recover }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => `t:${key}` }) }));
import { ChunkLoadError, LazyPageBoundary, lazyPage } from "./lazyPage";

const reload = vi.fn();
let view: ReactTestRenderer | undefined;
const html = () => JSON.stringify(view!.toJSON());

beforeEach(() => {
  mocks.recover.mockReset().mockReturnValue(true);
  reload.mockClear();
  // React reports every error a boundary catches through console.error; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What the router renders for a lazy page. */
const mount = async (page: React.ReactNode) => {
  await act(async () => {
    view = create(
      <LazyPageBoundary>
        <React.Suspense fallback={<span>loading</span>}>{page}</React.Suspense>
      </LazyPageBoundary>,
    );
  });
};
const staleChunk = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://crm.test/assets/QueuePage-OLD.js"));

describe("lazyPage with LazyPageBoundary", () => {
  it("renders the page once its chunk has loaded", async () => {
    const Page = lazyPage(() => Promise.resolve({ default: () => <span>queue</span> }));
    await mount(<Page />);
    expect(html()).toContain("queue");
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("reloads the tab when the chunk cannot be loaded, and shows the loader meanwhile instead of a blank screen", async () => {
    const Page = lazyPage<React.ComponentType>(staleChunk);
    await mount(<Page />);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
    expect(html()).toContain("t:common.loading");
    expect(html()).not.toContain("t:appUpdate.pageLoadFailed");
  });

  it("offers a reload by hand when reloading by itself is not going to help", async () => {
    mocks.recover.mockReturnValue(false);
    const Page = lazyPage<React.ComponentType>(staleChunk);
    await mount(<Page />);
    expect(html()).toContain("t:appUpdate.pageLoadFailed");
    const button = view!.root.findByType("button");
    expect(button.children).toEqual(["t:common.actions.refresh"]);
    expect(reload).not.toHaveBeenCalled();
    button.props.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the browser's reason in the error it raises", async () => {
    const reason = new TypeError("Importing a module script failed.");
    const caught: unknown[] = [];
    class Catcher extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const Page = lazyPage<React.ComponentType>(() => Promise.reject(reason));
    await act(async () => {
      view = create(
        <Catcher>
          <React.Suspense fallback={null}>
            <Page />
          </React.Suspense>
        </Catcher>,
      );
    });
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(ChunkLoadError);
    expect((caught[0] as ChunkLoadError).cause).toBe(reason);
    expect((caught[0] as ChunkLoadError).message).toContain("Importing a module script failed.");
  });

  it.each([
    ["an error that is not about a chunk", new Error("render bug")],
    ["a thrown value that is not an error at all", null],
  ])("passes on %s, as if the boundary were not there", async (_name, bug) => {
    function Broken(): React.ReactElement {
      throw bug;
    }
    const caught: unknown[] = [];
    class Catcher extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? <span>outer</span> : this.props.children;
      }
    }
    await act(async () => {
      view = create(
        <Catcher>
          <LazyPageBoundary>
            <Broken />
          </LazyPageBoundary>
        </Catcher>,
      );
    });
    expect(caught).toEqual([bug]);
    expect(html()).toContain("outer");
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});
