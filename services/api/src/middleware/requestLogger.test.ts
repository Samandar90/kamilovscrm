import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
// Production format ("tiny"), as on Render.
vi.mock("../config/env", () => ({ env: { isProduction: true } }));
import { redactLoggedUrl, requestLogger, shouldSkipRequestLog } from "./requestLogger";

const CODE = "K7M2Q-9XR4P";

describe("shouldSkipRequestLog", () => {
  it.each([
    ["GET", `/api/public/queue-display/${CODE}`, 200, true],
    ["GET", `/api/public/queue-display/${CODE}?t=1`, 304, true],
    ["GET", `/API/Public/Queue-Display/${CODE}`, 200, true], // Express matches paths case-insensitively
    ["GET", "/api/queue/today", 200, true],
    ["GET", "/api/queue/today?doctorId=10", 200, true],
    ["GET", `/api/public/queue-display/${CODE}`, 404, false], // failures are always logged
    ["GET", `/api/public/queue-display/${CODE}`, 429, false],
    ["GET", "/api/queue/today?doctorId=11", 403, false],
    ["GET", "/api/queue/today", 500, false],
    ["POST", "/api/queue/today", 200, false], // only GET polls are skipped
    ["HEAD", `/api/public/queue-display/${CODE}`, 200, false],
    ["POST", "/api/queue/doctors/10/call-next", 200, false],
    ["GET", "/api/queue/today/extra", 200, false],
    ["GET", "/api/queue/todays", 200, false],
    ["GET", "/api/queue/displays", 200, false],
    ["GET", "/api/public/queue-display", 200, false], // no code segment: not the TV poll
    ["GET", "/api/appointments?date=2026-09-30", 200, false],
    ["GET", "/health", 200, false],
  ] as Array<[string, string, number, boolean]>)("%s %s %d → %s", (method, url, status, expected) => {
    expect(shouldSkipRequestLog(method, url, status)).toBe(expected);
  });
});

describe("redactLoggedUrl", () => {
  it.each([
    [`/api/public/queue-display/${CODE}`, "/api/public/queue-display/***"],
    ["/api/public/queue-display/k7m2q%209xr4p?lang=ru", "/api/public/queue-display/***"], // the query goes too
    [`/api/public/queue-display/${CODE}/extra`, "/api/public/queue-display/***"],
    [`/API/PUBLIC/QUEUE-DISPLAY/${CODE}`, "/API/PUBLIC/QUEUE-DISPLAY/***"],
    // The search text (names, phone fragments) is replaced; the path and the other parameters stay.
    ["/api/patients?search=%D0%9A", "/api/patients?search=***"],
    ["/api/users?search=ali", "/api/users?search=***"],
    ["/api/questionnaires?patientId=7&search=%D0%9A%D0%B0%D1%80&limit=20", "/api/questionnaires?patientId=7&search=***&limit=20"],
    [
      "/api/call-center/workspace?segment=base&search=%2B998+90&page=1&status=all",
      "/api/call-center/workspace?segment=base&search=***&page=1&status=all",
    ],
    ["/api/patients?search=a=b&search=c", "/api/patients?search=***&search=***"],
    // Express (qs) reads these names as `search` too.
    ["/api/patients?search[]=abc", "/api/patients?search[]=***"],
    ["/api/patients?search%5B0%5D=abc", "/api/patients?search%5B0%5D=***"],
    ["/api/patients?[search]=abc", "/api/patients?[search]=***"],
    ["/api/patients?s%65arch=abc", "/api/patients?s%65arch=***"],
    ["/api/patients?%E0%A4%A=1&search=abc", "/api/patients?%E0%A4%A=1&search=***"], // a name that cannot be decoded
    // Nothing to hide: every other URL is unchanged.
    ["/api/patients?search=", "/api/patients?search="],
    ["/api/patients?search", "/api/patients?search"],
    ["/api/patients", "/api/patients"],
    ["/api/appointments?patientId=7&startFrom=2026-10-03", "/api/appointments?patientId=7&startFrom=2026-10-03"],
    ["/api/queue/today?doctorId=10", "/api/queue/today?doctorId=10"],
    ["/api/queue/displays/7/rotate-code", "/api/queue/displays/7/rotate-code"],
    ["/api/public/queue-display", "/api/public/queue-display"],
  ])("%s → %s", (url, expected) => {
    expect(redactLoggedUrl(url)).toBe(expected);
  });
});

describe("requestLogger (production format)", () => {
  const lines: string[] = [];
  let server: Server;
  let root: string;

  beforeAll(async () => {
    // morgan writes to process.stdout: capture it for this block only.
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const app = express();
    app.use(requestLogger);
    app.get("/api/public/queue-display/:code", (req, res) => {
      res.status(req.params.code === CODE ? 200 : 404).json({});
    });
    app.get("/api/queue/today", (req, res) => {
      res.status(req.query.doctorId === "11" ? 403 : 200).json({});
    });
    app.get("/api/patients", (_req, res) => {
      res.status(200).json([]);
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((done) => server.once("listening", done));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((done) => server.close(() => done()));
  });

  const get = async (path: string) => (await fetch(`${root}${path}`)).status;
  /** morgan writes when the response has finished, which can be a moment after the client has read it. */
  const waitForLine = async (start: string) => {
    for (let i = 0; i < 200 && !lines.some((line) => line.startsWith(start)); i += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
    return lines.find((line) => line.startsWith(start));
  };

  it("skips successful queue polls, redacts the screen code of a failed one and logs other requests as before", async () => {
    expect(await get(`/api/public/queue-display/${CODE}`)).toBe(200); // skipped
    expect(await get("/api/queue/today?doctorId=10")).toBe(200); // skipped
    expect(await get("/api/public/queue-display/22222-22222")).toBe(404);
    expect(await get("/api/queue/today?doctorId=11")).toBe(403);
    expect(await get("/api/patients")).toBe(200);

    // The unchanged morgan "tiny" format: ":method :url :status :res[content-length] - :response-time ms".
    expect(await waitForLine("GET /api/public/queue-display/*** ")).toMatch(/^GET \/api\/public\/queue-display\/\*\*\* 404 2 - \d+\.\d{3} ms\n$/);
    expect(await waitForLine("GET /api/queue/today?doctorId=11 ")).toMatch(/^GET \/api\/queue\/today\?doctorId=11 403 2 - \d+\.\d{3} ms\n$/);
    expect(await waitForLine("GET /api/patients ")).toMatch(/^GET \/api\/patients 200 2 - \d+\.\d{3} ms\n$/);
    expect(lines).toHaveLength(3);
    expect(lines.join("")).not.toContain(CODE);
    expect(lines.join("")).not.toContain("22222");
  });

  it("replaces the patient search text in the logged URL", async () => {
    const text = encodeURIComponent("Каримова 90 123"); // as the web app sends it
    expect(await get(`/api/patients?search=${text}`)).toBe(200);

    expect(await waitForLine("GET /api/patients?search=")).toMatch(/^GET \/api\/patients\?search=\*\*\* 200 2 - \d+\.\d{3} ms\n$/);
    expect(lines.join("")).not.toContain(text);
  });
});
