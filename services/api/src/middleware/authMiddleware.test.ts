import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const query = vi.hoisted(() => vi.fn());
vi.mock("../config/env", () => ({
  env: { isProduction: false, jwtSecret: "isolated-auth-middleware-tests-only", dataProvider: "postgres" },
}));
vi.mock("../config/database", () => ({ dbPool: { query } }));
import { requireAuth } from "./authMiddleware";
import { ApiError } from "./errorHandler";
import { env } from "../config/env";
import { getClinicId } from "../tenancy/clinicContext";
import { signAccessToken } from "../utils/jwt";

const reception = signAccessToken({ userId: 2, clinicId: 1, username: "reception", role: "reception" });
const marketer = signAccessToken({ userId: 3, clinicId: 2, username: "target", role: "marketer" });
const request = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as Request;
const response = () => ({ locals: {} }) as unknown as Response;
/** Runs the middleware and resolves with what `next` received and the clinic context seen inside `next`. */
const run = (token: string, res: Response = response()) => {
  const next = vi.fn();
  const called = new Promise<{ args: unknown[]; clinicId: number | null }>((resolve) => {
    next.mockImplementation((...args: unknown[]) => resolve({ args, clinicId: getClinicId() }));
  });
  requireAuth(request(token), res, next);
  return { next, called };
};

beforeEach(() => {
  query.mockReset();
});

describe("requireAuth for staff", () => {
  it("continues synchronously inside the clinic context and never reads the database", () => {
    let clinicInside: number | null = null;
    const next = vi.fn(() => { clinicInside = getClinicId(); });
    const req = request(reception);
    requireAuth(req, response(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(clinicInside).toBe(1);
    expect(req.auth).toMatchObject({ userId: 2, clinicId: 1, role: "reception" });
    expect(query).not.toHaveBeenCalled();
  });

  it("still throws 401 for a missing or broken token", () => {
    const next = vi.fn();
    expect(() => requireAuth({ headers: {} } as Request, response(), next)).toThrowError(
      expect.objectContaining({ status: 401, message: "Authorization token is required" })
    );
    expect(() => requireAuth(request("not-a-token"), response(), next)).toThrowError(
      expect.objectContaining({ status: 401, message: "Invalid or expired token" })
    );
    expect(next).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("requireAuth for an external account", () => {
  it("re-reads the account and continues inside the token's clinic context", async () => {
    query.mockResolvedValueOnce({ rows: [{ role: "marketer" }] });
    const { next, called } = run(marketer);
    expect(next).not.toHaveBeenCalled(); // waits for the database

    expect(await called).toEqual({ args: [], clinicId: 2 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM users"), [3, 2]);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("clinic_id = $2");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("COALESCE(is_active, true) = true");
  });

  it("answers 401 when the account is gone: deleted, switched off or moved to another clinic", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { next, called } = run(marketer);

    const { args } = await called;
    expect(args).toHaveLength(1);
    expect(args[0]).toBeInstanceOf(ApiError);
    expect(args[0]).toMatchObject({ status: 401, message: "Invalid or expired token" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when the role of the account is no longer the token's role", async () => {
    query.mockResolvedValueOnce({ rows: [{ role: "reception" }] });
    const { next, called } = run(marketer);

    expect((await called).args[0]).toMatchObject({ status: 401 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the database fails: the error goes to next, the request does not continue", async () => {
    const failure = new Error("connection lost");
    query.mockRejectedValueOnce(failure);
    const { next, called } = run(marketer);

    expect((await called).args).toEqual([failure]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("checks the account once per request even when the middleware runs twice", async () => {
    query.mockResolvedValueOnce({ rows: [{ role: "marketer" }] });
    const res = response();
    await run(marketer, res).called;

    const second = run(marketer, res);
    expect(second.next).toHaveBeenCalledTimes(1); // synchronous this time
    expect(await second.called).toEqual({ args: [], clinicId: 2 });
    expect(query).toHaveBeenCalledTimes(1);

    // Another request (another res) is checked again.
    query.mockResolvedValueOnce({ rows: [] });
    expect((await run(marketer).called).args[0]).toMatchObject({ status: 401 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not read the database with the mock data provider", () => {
    const settings = env as { dataProvider: string };
    settings.dataProvider = "mock";
    try {
      const { next } = run(marketer);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(query).not.toHaveBeenCalled();
    } finally {
      settings.dataProvider = "postgres";
    }
  });
});
