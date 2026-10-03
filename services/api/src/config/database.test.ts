import { describe, expect, it } from "vitest";
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
