import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../i18n", () => ({ default: { t: (key: string) => key } }));
let requestJson: typeof import("./http").requestJson;
beforeAll(async () => {
  vi.stubEnv("VITE_API_URL", "http://localhost:4400");
  requestJson = (await import("./http")).requestJson;
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
