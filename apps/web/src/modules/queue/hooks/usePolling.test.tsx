import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

type Snapshot = { data: string | null; error: string | null; loading: boolean; refresh: () => void };
let latest: Snapshot;
function Probe({ load }: { load: (signal: AbortSignal) => Promise<string> }) {
  latest = usePolling(load, 5000, []);
  return null;
}

let view: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  // The hook schedules through window.* (like the rest of the app); hand it the fake timers.
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  if (view) act(() => view!.unmount());
  view = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = async (load: (signal: AbortSignal) => Promise<string>) => {
  await act(async () => {
    view = create(<Probe load={load} />);
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("usePolling", () => {
  it("loads at once, then every interval, and keeps the last data while a poll fails", async () => {
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("second");
    await mount(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(latest).toMatchObject({ data: "first", error: null, loading: false });

    await advance(4999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ data: "first", error: "offline", loading: false });

    await advance(5000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(latest).toMatchObject({ data: "second", error: null });
  });

  it("refresh aborts the request in flight and polls immediately; unmount stops polling", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<string>(() => undefined) : Promise.resolve(`answer ${signals.length}`);
    });
    await mount(load);
    expect(latest.loading).toBe(true);

    await act(async () => latest.refresh());
    expect(signals[0].aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ data: "answer 2", loading: false });

    act(() => view!.unmount());
    view = null;
    await advance(20_000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
