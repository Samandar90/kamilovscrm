import { afterEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../../../../index.html?raw";
import { markTvBooted } from "./tvDevice";

// The watchdog is a plain inline script in index.html, outside the bundle: it must work when the main chunk never loads.
const source = /<script id="tv-boot-watchdog">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? "";

type Timer = { callback: () => void; ms: number };
/** Runs the inline script against a stand-in window; the script may touch nothing but `window`. */
const boot = (pathname: string, onLine = true) => {
  const timers: Timer[] = [];
  const win = {
    location: { pathname, reload: vi.fn() },
    navigator: { onLine },
    setTimeout: vi.fn((callback: () => void, ms: number) => timers.push({ callback, ms })),
    __qtvBooted: undefined as boolean | undefined,
  };
  new Function("window", source)(win);
  /** Fires the most recently armed timer. */
  const fire = () => timers[timers.length - 1].callback();
  return { win, timers, fire };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TV boot watchdog (index.html)", () => {
  it("is an inline script in plain ES5 that does not wait for modules", () => {
    expect(source.trim()).not.toBe("");
    expect(source).not.toMatch(/=>|\bconst\b|\blet\b|`|\?\.|\?\?/);
  });

  it("reloads a TV page after 120 s when the app never booted", () => {
    const { win, timers, fire } = boot("/tv/K7M2Q-9XR4P");
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(120_000);
    expect(win.location.reload).not.toHaveBeenCalled();
    fire();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("stands down once the TV app has mounted (markTvBooted)", () => {
    const { win, timers, fire } = boot("/tv");
    vi.stubGlobal("window", win);
    markTvBooted();
    expect(win.__qtvBooted).toBe(true);
    fire();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
  });

  it("re-arms instead of reloading while the device is offline", () => {
    const { win, timers, fire } = boot("/TV/K7M2Q-9XR4P", false);
    fire();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(timers).toHaveLength(2);
    expect(timers[1].ms).toBe(120_000);

    win.navigator.onLine = true;
    fire();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("arms no timer outside the TV routes", () => {
    for (const pathname of ["/", "/login", "/queue", "/tvx", "/tv-old", "/settings/tv"]) {
      const { win, timers } = boot(pathname);
      expect(timers).toHaveLength(0);
      expect(win.setTimeout).not.toHaveBeenCalled();
    }
    expect(boot("/Tv").timers).toHaveLength(1);
  });
});
