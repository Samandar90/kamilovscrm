import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
const query = vi.hoisted(() => vi.fn());
vi.mock("../config/env", () => ({ env: { isProduction: false, dataProvider: "postgres" } }));
vi.mock("../config/database", () => ({ dbPool: { query } }));
import { getSubscriptionBlock, requireActiveSubscription } from "./subscriptionMiddleware";
import { runWithClinicContext } from "../tenancy/clinicContext";

const NOW = Date.parse("2026-09-30T06:00:00Z");

describe("getSubscriptionBlock", () => {
  it.each([
    ["active without end date", { subscription_status: "active", subscription_ends_at: null }, null],
    ["trialing with a future end", { subscription_status: "trialing", subscription_ends_at: "2026-10-01T00:00:00Z" }, null],
    ["unknown status (null)", { subscription_status: null, subscription_ends_at: null }, null],
    ["unparseable end date is ignored", { subscription_status: "active", subscription_ends_at: "not a date" }, null],
    ["suspended", { subscription_status: "suspended", subscription_ends_at: null }, "suspended"],
    ["suspended wins over a past end date", { subscription_status: "suspended", subscription_ends_at: "2020-01-01T00:00:00Z" }, "suspended"],
    ["expired status", { subscription_status: "expired", subscription_ends_at: null }, "expired"],
    ["active with a past end (string)", { subscription_status: "active", subscription_ends_at: "2026-09-30T05:59:59Z" }, "expired"],
    ["active with a past end (Date)", { subscription_status: "active", subscription_ends_at: new Date("2026-09-29T00:00:00Z") }, "expired"],
    ["end exactly now is still active", { subscription_status: "active", subscription_ends_at: "2026-09-30T06:00:00Z" }, null],
  ] as const)("%s", (_label, row, expected) => {
    expect(getSubscriptionBlock(row, NOW)).toBe(expected);
  });
});

describe("requireActiveSubscription keeps its behaviour", () => {
  const run = (next: NextFunction) =>
    runWithClinicContext(1, () => requireActiveSubscription({} as Request, {} as Response, next));

  beforeEach(() => {
    query.mockReset();
  });

  it("passes an active clinic and blocks suspended/expired ones with 402", async () => {
    query.mockResolvedValueOnce({ rows: [{ subscription_status: "active", subscription_ends_at: null }] });
    const next = vi.fn();
    await run(next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM clinics"), [1]);

    query.mockResolvedValueOnce({ rows: [{ subscription_status: "suspended", subscription_ends_at: null }] });
    await expect(run(vi.fn())).rejects.toMatchObject({ status: 402, message: "Подписка приостановлена. Обратитесь к администратору." });

    query.mockResolvedValueOnce({ rows: [{ subscription_status: "active", subscription_ends_at: "2000-01-01T00:00:00Z" }] });
    await expect(run(vi.fn())).rejects.toMatchObject({ status: 402, message: "Срок подписки истёк. Продлите подписку, чтобы продолжить работу." });
  });

  it("fails open when the clinic row is missing or the query fails", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const missing = vi.fn();
    await run(missing);
    expect(missing).toHaveBeenCalledTimes(1);

    query.mockRejectedValueOnce(new Error("connection lost"));
    const failed = vi.fn();
    await run(failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
