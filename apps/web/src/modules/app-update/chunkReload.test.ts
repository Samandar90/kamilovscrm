import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_RELOAD_COOLDOWN_MS, reloadForMissingChunk } from "./chunkReload";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A tab: session storage that survives its reloads, a network state, and whether the user is in the middle of something. */
function tab() {
  const stored = new Map<string, string>();
  const state = { online: true, busy: false, storageBlocked: false };
  const reload = vi.fn();
  const env = {
    storage: () => {
      if (state.storageBlocked) throw new DOMException("Access is denied for this document.", "SecurityError");
      return { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };
    },
    isOnline: () => state.online,
    isBusy: () => state.busy,
    reload,
  };
  return { state, reload, recover: () => reloadForMissingChunk(env) };
}

describe("reloadForMissingChunk", () => {
  it("reloads the page: the deployed version has the chunk the old tab asked for under another name", () => {
    const { recover, reload } = tab();
    expect(recover()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again within five minutes: a chunk that still fails is not a matter of a stale tab", async () => {
    const { recover, reload } = tab();
    recover();
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_COOLDOWN_MS - 1);
    expect(recover()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(recover()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload while the device is offline", () => {
    const { recover, reload, state } = tab();
    state.online = false;
    expect(recover()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when it cannot remember that it did: nothing would stop a loop", () => {
    const { recover, reload, state } = tab();
    state.storageBlocked = true;
    expect(recover()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload from under a request in flight or unsaved work, neither now nor later", async () => {
    const { recover, reload, state } = tab();
    state.busy = true;
    expect(recover()).toBe(false);
    state.busy = false;
    // The user may have gone to another page and started typing there: no reload behind their back.
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_COOLDOWN_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not spend the one reload on a refusal", () => {
    const { recover, reload, state } = tab();
    state.busy = true;
    recover();
    state.busy = false;
    expect(recover()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
