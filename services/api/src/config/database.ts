import { Pool } from "pg";
import { env } from "./env";

export const dbPool = new Pool({
  connectionString: env.databaseUrl,
  // pg closes a connection after 10 idle seconds, so a page opened after a pause started every query on a new one.
  // On the 0.1-CPU database new connections come up one per ~100 ms: five parallel list requests took 130-570 ms
  // instead of 20-100 ms. Eight stay open now; more are opened on demand and closed after 10 idle seconds as before.
  min: 8,
  keepAlive: true,
});

// A connection that sits idle for long can be closed by the database (restart, failover). pg reports that as an
// "error" event of the pool and drops the client; without a listener the event would stop the process.
dbPool.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error("[db] idle connection error:", error.message);
});

/** Временная диагностика: при env.debugSqlParams логировать параметры prepared statement (поиск 22P02). */
if (env.debugSqlParams) {
  const orig = dbPool.query.bind(dbPool);
  dbPool.query = (((textOrConfig: string | { text?: string; values?: unknown[] }, values?: unknown[]) => {
    if (typeof textOrConfig === "string" && values !== undefined) {
      // eslint-disable-next-line no-console -- опциональная отладка DEBUG_SQL_PARAMS
      console.log("[DEBUG_SQL_PARAMS]", textOrConfig.slice(0, 220), "\nvalues:", values);
    } else if (
      textOrConfig &&
      typeof textOrConfig === "object" &&
      "values" in textOrConfig &&
      Array.isArray((textOrConfig as { values?: unknown[] }).values)
    ) {
      const cfg = textOrConfig as { text?: string; values?: unknown[] };
      // eslint-disable-next-line no-console
      console.log("[DEBUG_SQL_PARAMS]", cfg.text?.slice(0, 220), "\nvalues:", cfg.values);
    }
    return orig(textOrConfig as never, values as never);
  }) as typeof dbPool.query);
}

