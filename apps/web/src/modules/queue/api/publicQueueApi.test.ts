import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueDisplayError, fetchQueueDisplayState } from "./publicQueueApi";
import type { QueueDisplayState } from "./queueTypes";

const state: QueueDisplayState = {
  serverTime: "2026-09-30T06:00:00.000Z",
  timeZone: "Asia/Tashkent",
  clinicName: "Test clinic",
  display: { name: "Hall", language: "uz_ru", voiceEnabled: true, showNames: true },
  cabinets: [],
  recentCalls: [],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stubFetch = (impl: () => Promise<Response>) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public queue display client", () => {
  it("GETs the display by code with no-store and without any auth or custom headers", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:4400");
    const storage = { getItem: vi.fn(() => "stale-staff-token") };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage, location: { pathname: "/tv/K7M2Q-9XR4P", assign: vi.fn() } });
    const fetchMock = stubFetch(async () => jsonResponse(state));

    await expect(fetchQueueDisplayState("K7M2Q-9XR4P")).resolves.toEqual(state);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4400/api/public/queue-display/K7M2Q-9XR4P");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toBeUndefined();
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("URL-encodes the code and forwards the abort signal", async () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:4400");
    const fetchMock = stubFetch(async () => jsonResponse(state));
    const controller = new AbortController();

    await fetchQueueDisplayState("a b/c", controller.signal);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4400/api/public/queue-display/a%20b%2Fc");
    expect(init?.signal).toBe(controller.signal);
  });

  it.each([
    [404, "not_found"],
    [403, "inactive"],
    [500, "network"],
    [429, "network"],
    [502, "network"],
  ] as const)("maps HTTP %i to the %s error kind", async (status, kind) => {
    stubFetch(async () => jsonResponse({ error: "x" }, status));
    const error = await fetchQueueDisplayState("K7M2Q9XR4P").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueDisplayError);
    expect(error).toMatchObject({ kind, name: "QueueDisplayError" });
  });

  it("maps a failed connection and an unreadable body to the network kind", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchQueueDisplayState("K7M2Q9XR4P")).rejects.toMatchObject({ kind: "network" });

    stubFetch(async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchQueueDisplayState("K7M2Q9XR4P")).rejects.toMatchObject({ kind: "network" });
  });

  it("rethrows an abort untouched so pollers can ignore it", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const error = await fetchQueueDisplayState("K7M2Q9XR4P", new AbortController().signal).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(QueueDisplayError);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
