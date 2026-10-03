#!/usr/bin/env node
/**
 * PostgreSQL migrations runner for Kamilovs CRM.
 * Tracks applied files in schema_migrations (created automatically).
 *
 * Usage (from services/api):
 *   npm run db:migrate
 *   npm run db:migrate -- --baseline=031_call_reminders.sql
 *
 * --baseline=<file> records every migration up to and including <file> as applied
 * WITHOUT running it. Use it once on a database whose schema was created outside
 * this log (production predates it); later files are applied normally.
 *
 * Requires: DATABASE_URL in .env or environment.
 *
 * A failed migration is reported without the values of the rows it failed on (see errorForLog).
 * To see the whole error locally, set DEBUG_ERROR_DETAILS=1; it has no effect when NODE_ENV=production.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const apiRoot = path.resolve(__dirname, "..");
// Inside the service root: Render does not ship files outside it to the build or the runtime.
const migrationsDir = path.join(apiRoot, "migrations");
const MIGRATION_FILE = /^\d{3}_.+\.sql$/i;
/** Serializes concurrent runs (e.g. two deploys) on the same database. */
const ADVISORY_LOCK_KEY = 7_340_202_601;

require("dotenv").config({ path: path.join(apiRoot, ".env"), override: true });

/**
 * Print a failure in full, with the values of the rows: only with DEBUG_ERROR_DETAILS=1 and never
 * in production, like the flag of the same name in src/config/env.ts.
 */
const debugErrorDetails =
  process.env.NODE_ENV !== "production" && process.env.DEBUG_ERROR_DETAILS?.trim() === "1";

const parseBaseline = () => {
  const arg = process.argv.slice(2).find((value) => value.startsWith("--baseline="));
  if (!arg) return null;
  const file = arg.slice("--baseline=".length).trim();
  if (!MIGRATION_FILE.test(file)) {
    console.error("--baseline expects a migration file name like 031_call_reminders.sql");
    process.exit(1);
  }
  return file;
};

/**
 * The "at …" lines of a stack. It begins with the message, and a message of several lines may have
 * one that starts with "at": the frames are what follows the message.
 */
const stackFrames = (err) => {
  if (typeof err.stack !== "string") return undefined;
  const message = typeof err.message === "string" ? err.message : "";
  const start = err.stack.indexOf(message);
  if (start === -1) return undefined;
  const frames = err.stack
    .slice(start + message.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
  return frames.length > 0 ? frames : undefined;
};

/**
 * What to print about a failure. This script runs on every start on Render, which keeps the output
 * as logs, and PostgreSQL describes a migration that failed on existing rows with their values:
 * "Key (clinic_id, phone)=(…) is duplicated.", "Failing row contains (…)". So an error of
 * PostgreSQL is printed as its code, constraint, table, column, routine and stack frames, without
 * `detail` and `where`, and with `message` only for SQLSTATE class 42: an error in the statement
 * itself, whose text names schema objects. Other errors keep their message.
 *
 * This is the rule of errorForLog in src/utils/logRedaction.ts, repeated because the script has to
 * work without dist and without the API's environment. src/scripts/dbMigrate.test.ts compares the
 * two: change them together.
 */
const errorForLog = (err) => {
  if (debugErrorDetails) return err;
  if (!err || typeof err !== "object") return { thrown: typeof err };

  const str = (value) => (typeof value === "string" && value !== "" ? value : undefined);
  // A five-character SQLSTATE code marks an error of PostgreSQL.
  const sqlState = typeof err.code === "string" && err.code.length === 5 ? err.code : undefined;
  const logged = {
    name: str(err.name),
    message: sqlState === undefined || sqlState.startsWith("42") ? str(err.message) : undefined,
    code: str(err.code),
    ...(sqlState !== undefined
      ? {
          constraint: str(err.constraint),
          table: str(err.table),
          column: str(err.column),
          routine: str(err.routine),
        }
      : {}),
    stack: stackFrames(err),
  };
  return Object.fromEntries(Object.entries(logged).filter(([, value]) => value !== undefined));
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || String(url).trim() === "") {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  if (!fs.existsSync(migrationsDir)) {
    console.error("Migrations directory not found:", migrationsDir);
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length === 0) {
    console.error("No migration files matched pattern 001_name.sql in", migrationsDir);
    process.exit(1);
  }

  const baseline = parseBaseline();
  if (baseline && !files.includes(baseline)) {
    console.error("Baseline file not found in", migrationsDir, ":", baseline);
    process.exit(1);
  }

  const client = new Client({ connectionString: String(url).trim() });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    for (const name of files) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [name]);
      if (done.rows.length > 0) {
        console.log("[skip]", name);
        continue;
      }

      if (baseline && name.localeCompare(baseline, undefined, { numeric: true }) <= 0) {
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [name]);
        console.log("[baseline]", name);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
      console.log("[apply]", name);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[fail]", name);
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
  console.log("Done. Applied migrations from", migrationsDir);
}

main().catch((err) => {
  console.error(errorForLog(err));
  process.exit(1);
});
