import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildCorsOptions } from "./corsOptions";

const WEB = "https://crm.example.com";

describe("buildCorsOptions", () => {
  let server: Server;
  let root: string;

  beforeAll(async () => {
    const app = express();
    app.use(cors(buildCorsOptions([WEB])));
    app.get("/api/ping", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    const onError: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(500).json({ error: String(error?.message ?? error) });
    };
    app.use(onError);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((done) => server.once("listening", done));
    root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const preflight = (origin: string) =>
    fetch(`${root}/api/ping`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

  it("lets the browser cache the preflight for a day, so a repeated API call is one round trip, not two", async () => {
    const response = await preflight(WEB);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization,content-type");
  });

  it("answers the configured web origin and clients that send no Origin", async () => {
    const fromWeb = await fetch(`${root}/api/ping`, { headers: { Origin: WEB } });
    expect(fromWeb.status).toBe(200);
    expect(fromWeb.headers.get("access-control-allow-origin")).toBe(WEB);

    const noOrigin = await fetch(`${root}/api/ping`);
    expect(noOrigin.status).toBe(200);
  });

  it("gives another origin no CORS permission, in a preflight or a request", async () => {
    for (const response of [
      await preflight("https://evil.example.com"),
      await fetch(`${root}/api/ping`, { headers: { Origin: "https://evil.example.com" } }),
    ]) {
      expect(response.ok).toBe(false);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-max-age")).toBeNull();
    }
  });
});
