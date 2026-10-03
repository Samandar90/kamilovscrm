import { describe, expect, it, vi } from "vitest";
// The real config/env needs JWT_SECRET from a local .env; the pool options under test do not depend on it.
vi.mock("./env", () => ({ env: { debugSqlParams: false } }));
import { dbPool } from "./database";

describe("dbPool", () => {
  it("keeps eight connections open between requests instead of closing them after 10 idle seconds", () => {
    expect(dbPool.options.min).toBe(8);
    expect(dbPool.options.keepAlive).toBe(true);
  });

  it("survives an error on an idle connection (a database restart) instead of crashing the process", () => {
    expect(dbPool.listenerCount("error")).toBe(1);
    expect(() => dbPool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
  });
});
