import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../i18n", () => ({ default: { t: (key: string) => key } }));
let requestJson: typeof import("./http").requestJson;
let hasUnfinishedRequests: typeof import("./http").hasUnfinishedRequests;
beforeAll(async () => {
  vi.stubEnv("VITE_API_URL", "http://localhost:4400");
  ({ requestJson, hasUnfinishedRequests } = await import("./http"));
});
afterEach(() => vi.unstubAllGlobals());
describe("HTTP failure classification", () => {
  it("exposes conflict status so a lost call lease can be renewed without losing notes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Lease expired" }), { status: 409, headers: { "content-type": "application/json" } })));
    await expect(requestJson("/api/call-center/attempts", { method: "POST", body: {} })).rejects.toMatchObject({ status: 409, message: "Lease expired" });
  });
  it("distinguishes validation failures from ambiguous network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Future callback required" }), { status: 400, headers: { "content-type": "application/json" } })));
    await expect(requestJson("/api/call-center/attempts")).rejects.toMatchObject({ status: 400 });
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A request that never gets an answer; like fetch, it rejects when its signal aborts. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
const networkDown = async () => {
  throw new TypeError("Failed to fetch");
};
/** Settles the promise into a value, so a rejection is never unhandled while fake timers run. */
const outcome = <T>(promise: Promise<T>) => promise.then((value) => ({ value }), (error: unknown) => ({ error }));

describe("lost and slow requests", () => {
  afterEach(() => vi.useRealTimers());

  it("repeats a read that gets no answer for 5 s and returns the answer of the second attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce(hang).mockImplementationOnce(async () => json([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const result = outcome(requestJson("/api/patients?search=v"));
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 300);
    expect(await result).toEqual({ value: [{ id: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("repeats a read after a network failure and after a gateway answer (502, 503, 504)", async () => {
    vi.useFakeTimers();
    for (const first of [networkDown, async () => json({}, 502), async () => json({}, 503), async () => json({}, 504)]) {
      const fetchMock = vi.fn().mockImplementationOnce(first).mockImplementationOnce(async () => json({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);
      const result = outcome(requestJson("/api/doctors"));
      await vi.advanceTimersByTimeAsync(300);
      expect(await result).toEqual({ value: { ok: true } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("repeats a read whose answer stalls halfway through the body", async () => {
    vi.useFakeTimers();
    const stalledBody = async (_url: string, init: RequestInit) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => hang("", init),
      }) as unknown as Response;
    const fetchMock = vi.fn().mockImplementationOnce(stalledBody).mockImplementationOnce(async () => json({ rows: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = outcome(requestJson("/api/appointments"));
    await vi.advanceTimersByTimeAsync(5000 + 300);
    expect(await result).toEqual({ value: { rows: 2 } });
  });

  it("gives up a read after three attempts (5, 10 and 20 s) with a no-connection message", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(hang);
    vi.stubGlobal("fetch", fetchMock);
    const result = outcome(requestJson("/api/appointments"));
    await vi.advanceTimersByTimeAsync(5000 + 300 + 10000 + 1000 + 19999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = (await result) as { error: Error & { status?: number } };
    expect(error.message).toBe("http.networkError");
    expect(error.status).toBeUndefined(); // not a definite server rejection
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the last gateway status when every attempt of a read got one", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Bad gateway" }, 502)));
    const result = outcome(requestJson("/api/doctors"));
    await vi.advanceTimersByTimeAsync(300 + 1000);
    expect((await result) as unknown).toMatchObject({ error: { status: 502, message: "Bad gateway" } });
  });

  it("does not repeat a definite answer", async () => {
    for (const status of [400, 403, 404, 409, 500]) {
      const fetchMock = vi.fn(async () => json({ error: "No" }, status));
      vi.stubGlobal("fetch", fetchMock);
      await expect(requestJson("/api/doctors")).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("never repeats a write: the server may have applied it", async () => {
    vi.useFakeTimers();
    for (const first of [networkDown, hang, async () => json({}, 502)]) {
      const fetchMock = vi.fn(first);
      vi.stubGlobal("fetch", fetchMock);
      const result = outcome(requestJson("/api/appointments", { method: "POST", body: { patientId: 1 } }));
      await vi.advanceTimersByTimeAsync(60000);
      const { error } = (await result) as { error: Error & { status?: number } };
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(error.status === 502 || error.message === "http.writeUnknown").toBe(true);
    }
  });

  it("waits a minute for a slow read (AI) and does not repeat it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(hang);
    vi.stubGlobal("fetch", fetchMock);
    const result = outcome(requestJson("/api/ai/morning-briefing", { slow: true }));
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await result) as { error: Error }).error.message).toBe("http.networkError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at once, without another attempt, when the caller cancels", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(hang);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const result = outcome(requestJson("/api/patients?search=a", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    const { error } = (await result) as { error: Error };
    expect(error.name).toBe("AbortError");
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start the next attempt if the caller cancels during the pause", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(networkDown);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const result = outcome(requestJson("/api/patients?search=a", { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60000);
    expect(((await result) as { error: Error }).error.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("requests a page reload must not cut off", () => {
  /** A request the test answers by hand. */
  const pendingFetch = () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    return (response: Response) => answer(response);
  };

  it("counts a write from the moment it is sent until its answer arrives", async () => {
    const answer = pendingFetch();
    expect(hasUnfinishedRequests()).toBe(false);
    const result = requestJson("/api/appointments", { method: "POST", body: { patientId: 1 } });
    expect(hasUnfinishedRequests()).toBe(true);
    answer(json({ id: 7 }));
    await result;
    expect(hasUnfinishedRequests()).toBe(false);
  });

  it("counts a slow read: an AI answer the user is waiting for", async () => {
    const answer = pendingFetch();
    const result = requestJson("/api/ai/ask", { slow: true });
    expect(hasUnfinishedRequests()).toBe(true);
    answer(json({ text: "ok" }));
    await result;
    expect(hasUnfinishedRequests()).toBe(false);
  });

  it("does not count an ordinary read: the page loads it again", async () => {
    const answer = pendingFetch();
    const result = requestJson("/api/appointments?startFrom=2026-10-03");
    expect(hasUnfinishedRequests()).toBe(false);
    answer(json([]));
    await result;
  });

  it("stops counting a write that was rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Slot taken" }, 409)));
    await expect(requestJson("/api/appointments", { method: "POST", body: {} })).rejects.toMatchObject({ status: 409 });
    expect(hasUnfinishedRequests()).toBe(false);
  });

  it("counts two writes until both are answered", async () => {
    const answers: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))));
    const first = requestJson("/api/payments", { method: "POST", body: {} });
    const second = requestJson("/api/invoices/5", { method: "PATCH", body: {} });
    answers[0](json({}));
    await first;
    expect(hasUnfinishedRequests()).toBe(true);
    answers[1](json({}));
    await second;
    expect(hasUnfinishedRequests()).toBe(false);
  });
});
