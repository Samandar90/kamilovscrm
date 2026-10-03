import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL_MS,
  CHECK_MIN_GAP_MS,
  CHECK_TIMEOUT_MS,
  HIDDEN_RELOAD_MS,
  IDLE_RELOAD_MS,
  PENDING_TICK_MS,
  createUpdateWatcher,
} from "./updateWatcher";

/** index.html of a deployment whose entry script is `script`. */
const page = (script: string) =>
  `<script type="module" crossorigin src="/assets/${script}"></script><link rel="stylesheet" crossorigin href="/assets/index-A.css">`;
/** What the tab under test loaded. */
const LOADED = ["/assets/index-OLD.js", "/assets/index-A.css"];

const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** A tab with the watcher wired to a stand-in browser and a stand-in web server. */
function openTab(loaded: string[] = LOADED) {
  const state = { deployed: page("index-OLD.js"), reachable: true, hanging: false, hidden: false, online: true, busy: false };
  const signals: AbortSignal[] = [];
  let held: Array<() => void> | null = null;
  const fetchIndexHtml = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    if (state.hanging) {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }
    if (held) return new Promise<string>((resolve) => held!.push(() => resolve(state.deployed)));
    return state.reachable ? Promise.resolve(state.deployed) : Promise.reject(new TypeError("Failed to fetch"));
  });
  const reload = vi.fn();
  const watcher = createUpdateWatcher({
    fetchIndexHtml,
    loadedAssets: () => loaded,
    isHidden: () => state.hidden,
    isOnline: () => state.online,
    isBusy: () => state.busy,
    reload,
  });
  const notified = vi.fn();
  const unsubscribe = watcher.subscribe(notified);
  let activity: ReturnType<typeof setInterval> | undefined;
  const rest = () => clearInterval(activity);
  cleanups.push(() => {
    rest();
    watcher.stop();
  });
  return {
    state,
    watcher,
    fetchIndexHtml,
    reload,
    notified,
    unsubscribe,
    signals,
    /** The user keeps clicking and typing. */
    work: () => {
      activity = setInterval(() => watcher.userActive(), 1000);
    },
    /** The user leaves the mouse and the keyboard alone. */
    rest,
    hide: () => {
      state.hidden = true;
      watcher.visibilityChanged();
    },
    show: () => {
      state.hidden = false;
      watcher.visibilityChanged();
    },
    /** A new version goes live. */
    deploy: (script = "index-NEW.js") => {
      state.deployed = page(script);
    },
    /** Answers of the web server are held back until release(). */
    hold: () => {
      held = [];
    },
    release: async () => {
      const waiting = held ?? [];
      held = null;
      waiting.forEach((answer) => answer());
      await advance(0);
    },
  };
}

/** A tab whose user is at work and which has just learnt that a new version is deployed. */
async function tabWithUpdate() {
  const tab = openTab();
  tab.watcher.start();
  tab.work();
  tab.deploy();
  await advance(CHECK_INTERVAL_MS);
  expect(tab.watcher.isUpdateAvailable()).toBe(true);
  expect(tab.reload).not.toHaveBeenCalled();
  expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
  return tab;
}

describe("noticing a new version", () => {
  it("asks for index.html every 10 minutes and not when the tab has just been opened", async () => {
    const tab = openTab();
    tab.watcher.start();
    await advance(CHECK_INTERVAL_MS - 1);
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
    await advance(1);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.watcher.isUpdateAvailable()).toBe(false);
    expect(tab.notified).not.toHaveBeenCalled();
  });

  it("does nothing before start()", async () => {
    const tab = openTab();
    tab.deploy();
    await advance(CHECK_INTERVAL_MS * 3);
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
  });

  it("reports a new version when the deployed page loads other files, and tells its subscribers once", async () => {
    const tab = await tabWithUpdate();
    expect(tab.notified).toHaveBeenCalledTimes(1);
  });

  it("stops asking once it knows, as long as nothing can be reloaded", async () => {
    const tab = await tabWithUpdate();
    tab.state.busy = true;
    tab.rest();
    await advance(CHECK_INTERVAL_MS * 3);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("stays quiet when the page cannot be fetched, and asks again at the next turn", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.deploy();
    tab.state.reachable = false;
    await advance(CHECK_INTERVAL_MS);
    expect(tab.watcher.isUpdateAvailable()).toBe(false);
    tab.state.reachable = true;
    tab.state.busy = true;
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.watcher.isUpdateAvailable()).toBe(true);
  });

  it("takes an answer that is not the app (a proxy's error page) for no answer", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.state.deployed = "<html><body><h1>502 Bad Gateway</h1></body></html>";
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    expect(tab.watcher.isUpdateAvailable()).toBe(false);
  });

  it("gives up a request that hangs after 10 s", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.state.hanging = true;
    await advance(CHECK_INTERVAL_MS + CHECK_TIMEOUT_MS - 1);
    expect(tab.signals[0].aborted).toBe(false);
    await advance(1);
    expect(tab.signals[0].aborted).toBe(true);
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the device is offline", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.state.online = false;
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
  });

  it("asks at once when the tab comes back, but not more than once a minute", async () => {
    const tab = openTab();
    tab.watcher.start();
    await advance(CHECK_MIN_GAP_MS - 1);
    tab.hide();
    tab.show();
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
    await advance(1);
    tab.hide();
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
    tab.show();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    await advance(0);
    tab.hide();
    tab.show();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
  });

  it("never reports a new version when it cannot tell which files the tab itself loaded", async () => {
    const tab = openTab([]);
    tab.watcher.start();
    tab.deploy();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.watcher.isUpdateAvailable()).toBe(false);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("lets a subscriber leave", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.work();
    tab.unsubscribe();
    tab.deploy();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.watcher.isUpdateAvailable()).toBe(true);
    expect(tab.notified).not.toHaveBeenCalled();
  });

  it("stops for good on stop()", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.watcher.stop();
    tab.deploy();
    await advance(CHECK_INTERVAL_MS * 3);
    tab.hide();
    tab.show();
    expect(tab.fetchIndexHtml).not.toHaveBeenCalled();
  });
});

describe("reloading on a page change", () => {
  it("reloads when the user moves to another page, without asking the server again", async () => {
    const tab = await tabWithUpdate();
    tab.watcher.pageChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a page change while no new version is known", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.work();
    await advance(CHECK_INTERVAL_MS);
    tab.watcher.pageChanged();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("does not reload while a dialog is open, input is unsaved or a write is in flight", async () => {
    const tab = await tabWithUpdate();
    tab.state.busy = true;
    tab.watcher.pageChanged();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.state.busy = false;
    tab.watcher.pageChanged();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload while the device is offline: the browser would show its error page", async () => {
    const tab = await tabWithUpdate();
    tab.state.online = false;
    tab.watcher.pageChanged();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("reloads only once", async () => {
    const tab = await tabWithUpdate();
    tab.watcher.pageChanged();
    tab.watcher.pageChanged();
    tab.rest();
    tab.hide();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });
});

describe("reloading a hidden tab", () => {
  it("reloads a tab that has been hidden for a minute, after the server confirms the new version", async () => {
    const tab = await tabWithUpdate();
    tab.hide();
    await advance(HIDDEN_RELOAD_MS - PENDING_TICK_MS);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    await advance(PENDING_TICK_MS * 2);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads a tab hidden for long as soon as it learns of the new version, on that same answer", async () => {
    const tab = openTab();
    tab.watcher.start();
    tab.hide();
    tab.deploy();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a quick switch to another window alone", async () => {
    const tab = await tabWithUpdate();
    tab.hide();
    await advance(HIDDEN_RELOAD_MS - PENDING_TICK_MS);
    tab.show();
    await advance(PENDING_TICK_MS * 4);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
  });

  it("waits while the hidden tab holds unsaved work, without asking the server", async () => {
    const tab = await tabWithUpdate();
    tab.state.busy = true;
    tab.hide();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
    tab.state.busy = false;
    await advance(PENDING_TICK_MS);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("stays put when the server does not answer, and asks no more than once a minute", async () => {
    const tab = await tabWithUpdate();
    tab.state.reachable = false;
    tab.hide();
    await advance(HIDDEN_RELOAD_MS + PENDING_TICK_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    await advance(5 * CHECK_MIN_GAP_MS);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.watcher.isUpdateAvailable()).toBe(true);
    const asked = tab.fetchIndexHtml.mock.calls.length;
    expect(asked).toBeGreaterThan(2);
    expect(asked).toBeLessThanOrEqual(2 + 5);
    tab.state.reachable = true;
    await advance(CHECK_MIN_GAP_MS + PENDING_TICK_MS);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the new version in mind when the confirmation brings a page that is not the app", async () => {
    const tab = await tabWithUpdate();
    tab.state.deployed = "<html><body><h1>502 Bad Gateway</h1></body></html>";
    tab.hide();
    await advance(HIDDEN_RELOAD_MS + PENDING_TICK_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.watcher.isUpdateAvailable()).toBe(true);
    expect(tab.reload).not.toHaveBeenCalled();
    tab.deploy();
    await advance(CHECK_MIN_GAP_MS + PENDING_TICK_MS);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("forgets the new version when the deploy was rolled back, and goes back to asking every 10 minutes", async () => {
    const tab = await tabWithUpdate();
    tab.deploy("index-OLD.js");
    tab.hide();
    await advance(HIDDEN_RELOAD_MS + PENDING_TICK_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.watcher.isUpdateAvailable()).toBe(false);
    expect(tab.notified).toHaveBeenCalledTimes(2);
    expect(tab.reload).not.toHaveBeenCalled();
    await advance(CHECK_INTERVAL_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(3);
  });

  it("does not reload when the user returns while the server is being asked", async () => {
    const tab = await tabWithUpdate();
    tab.hide();
    tab.hold();
    await advance(HIDDEN_RELOAD_MS + PENDING_TICK_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    tab.show();
    await tab.release();
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.watcher.isUpdateAvailable()).toBe(true);
  });
});

describe("reloading an idle tab", () => {
  it("reloads after five minutes without a click or a key, after the server confirms the new version", async () => {
    const tab = await tabWithUpdate();
    tab.rest();
    await advance(IDLE_RELOAD_MS - PENDING_TICK_MS);
    expect(tab.reload).not.toHaveBeenCalled();
    await advance(PENDING_TICK_MS * 2);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads under a user who keeps working", async () => {
    const tab = await tabWithUpdate();
    await advance(CHECK_INTERVAL_MS * 6);
    expect(tab.reload).not.toHaveBeenCalled();
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(1);
  });

  it("counts coming back to the tab as activity", async () => {
    const tab = await tabWithUpdate();
    tab.rest();
    await advance(IDLE_RELOAD_MS - 2 * PENDING_TICK_MS);
    tab.hide();
    await advance(PENDING_TICK_MS);
    tab.show();
    await advance(IDLE_RELOAD_MS - PENDING_TICK_MS);
    expect(tab.reload).not.toHaveBeenCalled();
    await advance(PENDING_TICK_MS * 2);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the user starts typing while the server is being asked", async () => {
    const tab = await tabWithUpdate();
    tab.rest();
    tab.hold();
    await advance(IDLE_RELOAD_MS + PENDING_TICK_MS);
    expect(tab.fetchIndexHtml).toHaveBeenCalledTimes(2);
    tab.state.busy = true;
    await tab.release();
    expect(tab.reload).not.toHaveBeenCalled();
  });
});
