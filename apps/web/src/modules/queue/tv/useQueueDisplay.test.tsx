import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueDisplayState } from "../api/queueTypes";

const mocks = vi.hoisted(() => ({ fetchState: vi.fn() }));
vi.mock("../api/publicQueueApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/publicQueueApi")>()),
  fetchQueueDisplayState: mocks.fetchState,
}));

import { QueueDisplayError } from "../api/publicQueueApi";
import { backoffDelayMs, useQueueDisplay } from "./useQueueDisplay";

const sample = (clinicName: string): QueueDisplayState => ({
  serverTime: "2026-09-30T06:00:00.000Z",
  timeZone: "Asia/Tashkent",
  clinicName,
  display: { name: "Холл", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls: [],
});

let latest: ReturnType<typeof useQueueDisplay>;
function Probe({ code }: { code: string }) {
  latest = useQueueDisplay(code);
  return null;
}

let view: ReactTestRenderer | undefined;
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const mount = async () => {
  await act(async () => {
    view = create(<Probe code="K7M2Q9XR4P" />);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchState.mockReset();
  // Delegate lazily so the fake timers installed above are used.
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
  });
});

afterEach(() => {
  if (view) act(() => view!.unmount());
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("backoffDelayMs", () => {
  it("doubles from 2 s up to a 10 s cap", () => {
    expect([1, 2, 3, 4, 5, 20].map(backoffDelayMs)).toEqual([2000, 4000, 8000, 10000, 10000, 10000]);
  });
});

describe("useQueueDisplay", () => {
  it("polls every 2 seconds with the code and exposes the latest state", async () => {
    mocks.fetchState.mockResolvedValueOnce(sample("A")).mockResolvedValue(sample("B"));
    await mount();
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    expect(mocks.fetchState.mock.calls[0][0]).toBe("K7M2Q9XR4P");
    expect(latest.state?.clinicName).toBe("A");
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.state?.clinicName).toBe("B");
    expect(latest).toMatchObject({ error: null, offline: false });
  });

  it("keeps the last state, backs off 2 → 4 → 8 s and goes offline after three failures", async () => {
    mocks.fetchState
      .mockResolvedValueOnce(sample("A"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockRejectedValueOnce(new QueueDisplayError("network", "down"))
      .mockResolvedValue(sample("C"));
    await mount();
    await advance(2000); // failure 1
    expect(latest.offline).toBe(false);
    await advance(2000); // failure 2 (after 2 s)
    expect(mocks.fetchState).toHaveBeenCalledTimes(3);
    await advance(3999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(3); // waiting 4 s
    await advance(1); // failure 3
    expect(latest.offline).toBe(true);
    expect(latest.state?.clinicName).toBe("A");
    await advance(8000); // success
    expect(latest.offline).toBe(false);
    expect(latest.state?.clinicName).toBe("C");
  });

  it("reports an unknown screen code, re-checks it every 60 s and recovers from a transient 404", async () => {
    mocks.fetchState
      .mockRejectedValueOnce(new QueueDisplayError("not_found", "gone"))
      .mockRejectedValueOnce(new QueueDisplayError("not_found", "gone"))
      .mockResolvedValue(sample("A"));
    await mount();
    expect(latest.error).toBe("not_found");
    await advance(59_999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(1); // no 2-second polling for a missing screen
    await advance(1);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.error).toBe("not_found");
    await advance(60_000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(3);
    expect(latest.error).toBeNull();
    expect(latest.state?.clinicName).toBe("A");
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(4); // back to the normal 2 s polling
  });

  it("reports an inactive subscription and keeps checking slowly", async () => {
    mocks.fetchState.mockRejectedValueOnce(new QueueDisplayError("inactive", "paused")).mockResolvedValue(sample("A"));
    await mount();
    expect(latest.error).toBe("inactive");
    await advance(29_999);
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(latest.error).toBeNull();
    expect(latest.state?.clinicName).toBe("A");
  });

  it("treats a request that hangs for 8 s as a failure", async () => {
    mocks.fetchState.mockImplementationOnce(
      (_code: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    mocks.fetchState.mockResolvedValue(sample("A"));
    await mount();
    await advance(8000); // timeout → failure 1 → retry in 2 s
    expect(mocks.fetchState).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(mocks.fetchState).toHaveBeenCalledTimes(2);
    expect(latest.state?.clinicName).toBe("A");
  });
});
