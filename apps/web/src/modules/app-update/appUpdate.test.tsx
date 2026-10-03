import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_INTERVAL_MS, IDLE_RELOAD_MS, PENDING_TICK_MS } from "./updateWatcher";

const mocks = vi.hoisted(() => ({ writing: false }));
vi.mock("../../api/http", () => ({ hasUnfinishedRequests: () => mocks.writing }));

type Handler = (event?: unknown) => void;
type Registry = Map<string, Set<Handler>>;

const page = (script: string) => `<script type="module" crossorigin src="/assets/${script}"></script>`;

/** Stand-ins for the tab's document, window and navigator with real listener registries, and for the web server. */
function fakeBrowser() {
  const registries = { document: new Map() as Registry, window: new Map() as Registry };
  const add = (registry: Registry) => (type: string, handler: Handler) => {
    registry.set(type, (registry.get(type) ?? new Set()).add(handler));
  };
  const remove = (registry: Registry) => (type: string, handler: Handler) => {
    registry.get(type)?.delete(handler);
  };
  const stored = new Map<string, string>();
  const browser = {
    visibility: "visible",
    online: true,
    dialogOpen: false,
    deployed: page("index-OLD.js"),
    reload: vi.fn(),
    fetch: vi.fn(async (_url: string, _init?: RequestInit) => new Response(browser.deployed, { status: 200 })),
    /** Number of listeners the app has registered. */
    listenerCount: () =>
      [registries.document, registries.window].reduce(
        (total, registry) => total + Array.from(registry.values()).reduce((sum, handlers) => sum + handlers.size, 0),
        0,
      ),
    fire: (target: "document" | "window", type: string, element: object | null = null) =>
      registries[target].get(type)?.forEach((handler) => handler({ target: element })),
  };
  vi.stubGlobal("document", {
    get visibilityState() {
      return browser.visibility;
    },
    addEventListener: add(registries.document),
    removeEventListener: remove(registries.document),
    querySelector: () => (browser.dialogOpen ? {} : null),
    getElementsByTagName: (tag: string) =>
      tag === "script" ? [{ getAttribute: (name: string) => (name === "src" ? "/assets/index-OLD.js" : null) }] : [],
  });
  vi.stubGlobal("window", {
    location: { reload: browser.reload },
    addEventListener: add(registries.window),
    removeEventListener: remove(registries.window),
    dispatchEvent: () => true,
    sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) },
  });
  vi.stubGlobal("navigator", {
    get onLine() {
      return browser.online;
    },
  });
  vi.stubGlobal("fetch", browser.fetch);
  return browser;
}

let browser: ReturnType<typeof fakeBrowser>;
let appUpdate: typeof import("./appUpdate");
let stop: (() => void) | undefined;
let view: ReactTestRenderer | undefined;

/** A fresh tab: the module keeps one watcher for the whole tab. */
const openTab = async (production: boolean) => {
  vi.stubEnv("PROD", production);
  vi.resetModules();
  appUpdate = await import("./appUpdate");
  stop = appUpdate.startAppUpdateWatch();
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.writing = false;
  browser = fakeBrowser();
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("startAppUpdateWatch", () => {
  it("does nothing on the dev server", async () => {
    await openTab(false);
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS * 3);
    expect(browser.fetch).not.toHaveBeenCalled();
    expect(browser.listenerCount()).toBe(0);
  });

  it("asks the web origin for index.html past the cache, once in 10 minutes", async () => {
    await openTab(true);
    await advance(CHECK_INTERVAL_MS);
    expect(browser.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = browser.fetch.mock.calls[0];
    expect(url).toBe("/index.html");
    expect(init).toMatchObject({ cache: "no-cache" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(browser.reload).not.toHaveBeenCalled();
  });

  it("reloads a hidden tab once a new version is deployed", async () => {
    await openTab(true);
    browser.visibility = "hidden";
    browser.fire("document", "visibilitychange");
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS);
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("takes an answer that is not 200 for no answer", async () => {
    await openTab(true);
    browser.visibility = "hidden";
    browser.fire("document", "visibilitychange");
    browser.fetch.mockImplementation(async () => new Response(page("index-NEW.js"), { status: 503 }));
    await advance(CHECK_INTERVAL_MS);
    expect(browser.fetch).toHaveBeenCalledTimes(1);
    expect(browser.reload).not.toHaveBeenCalled();
  });

  it("holds the reload while a dialog is open or a write is in flight, and reloads on the next page change", async () => {
    await openTab(true);
    browser.dialogOpen = true;
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS);
    appUpdate.notifyPageChanged();
    expect(browser.reload).not.toHaveBeenCalled();

    browser.dialogOpen = false;
    mocks.writing = true;
    appUpdate.notifyPageChanged();
    expect(browser.reload).not.toHaveBeenCalled();

    mocks.writing = false;
    appUpdate.notifyPageChanged();
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("holds the reload over a field the user changed, until the field is gone", async () => {
    await openTab(true);
    const notes = {
      tagName: "TEXTAREA",
      isConnected: true,
      parentElement: null,
      getAttribute: () => null,
      hasAttribute: () => false,
      value: "Амоксициллин 500 мг",
    };
    browser.fire("document", "focusin", notes);
    notes.value = "";
    browser.fire("document", "input", notes);
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS);
    appUpdate.notifyPageChanged();
    expect(browser.reload).not.toHaveBeenCalled();

    notes.isConnected = false;
    appUpdate.notifyPageChanged();
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("takes a click, a key, a scroll and a mouse move for the user being there", async () => {
    await openTab(true);
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS - 1000);
    browser.fire("window", "pointerdown");
    await advance(1000);
    // Each event must push the reload back by another five minutes.
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"]) {
      browser.fire("window", type);
      await advance(IDLE_RELOAD_MS - PENDING_TICK_MS);
      expect(browser.reload).not.toHaveBeenCalled();
    }
    await advance(PENDING_TICK_MS * 2);
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("removes its listeners and timers when stopped", async () => {
    await openTab(true);
    expect(browser.listenerCount()).toBeGreaterThan(0);
    stop!();
    expect(browser.listenerCount()).toBe(0);
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS * 3);
    expect(browser.fetch).not.toHaveBeenCalled();
  });
});

describe("useUpdateAvailable", () => {
  it("turns true when a new version is deployed", async () => {
    await openTab(true);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(appUpdate.useUpdateAvailable());
      return null;
    }
    await act(async () => {
      view = create(<Probe />);
    });
    browser.dialogOpen = true; // keeps the tab from reloading, so that the flag can be read
    browser.deployed = page("index-NEW.js");
    await advance(CHECK_INTERVAL_MS);
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });
});

describe("reloadToNewVersion", () => {
  it("reloads at once when nothing would be lost", async () => {
    await openTab(true);
    const ask = vi.fn(() => false);
    appUpdate.reloadToNewVersion(ask);
    expect(ask).not.toHaveBeenCalled();
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("asks first over unsaved work and stays on a no", async () => {
    await openTab(true);
    mocks.writing = true;
    const ask = vi.fn(() => false);
    appUpdate.reloadToNewVersion(ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(browser.reload).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    appUpdate.reloadToNewVersion(ask);
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });
});

describe("recoverFromMissingChunk", () => {
  it("reloads the tab once and refuses a second time right after", async () => {
    await openTab(true);
    expect(appUpdate.recoverFromMissingChunk()).toBe(true);
    expect(browser.reload).toHaveBeenCalledTimes(1);
    expect(appUpdate.recoverFromMissingChunk()).toBe(false);
    expect(browser.reload).toHaveBeenCalledTimes(1);
  });

  it("refuses while a write is in flight or a dialog is open", async () => {
    await openTab(true);
    mocks.writing = true;
    expect(appUpdate.recoverFromMissingChunk()).toBe(false);
    mocks.writing = false;
    browser.dialogOpen = true;
    expect(appUpdate.recoverFromMissingChunk()).toBe(false);
    expect(browser.reload).not.toHaveBeenCalled();
  });
});
