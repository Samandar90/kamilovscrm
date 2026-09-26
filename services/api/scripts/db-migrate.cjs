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
 * WITHOUT running it, on a database whose schema was created outside this log
 * (production predates it): its log already records a later file, or it has tables
 * but no log yet. Later files are applied normally. On a new or partly migrated
 * database the flag is ignored and every file runs, so `npm start` (which passes it)
 * also bootstraps an empty database.
 *
 * Requires: DATABASE_URL in .env or environment.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const apiRoot = path.resolve(__dirname, "..");
// Inside the service root: Render does not ship files outside it to the build or the runtime.
const migrationsDir = path.join(apiRoot, "migrations");
const MIGRATION_FILE = /^\d{3}_.+\.sql$/i;
const compareNames = (a, b) => a.localeCompare(b, undefined, { numeric: true });
/** Serializes concurrent runs (e.g. two deploys) on the same database. */
const ADVISORY_LOCK_KEY = 7_340_202_601;

require("dotenv").config({ path: path.join(apiRoot, ".env"), override: true });

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

/** Whether the schema predates the log, so files up to the baseline are already reflected in it. */
const predatesLog = async (client, baseline) => {
  const { rows } = await client.query(`
    SELECT
      (SELECT coalesce(array_agg(filename), '{}') FROM schema_migrations) AS recorded,
      EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
      ) AS has_tables
  `);
  const { recorded, has_tables: hasTables } = rows[0];
  if (recorded.length === 0) return hasTables;
  return recorded.some((name) => compareNames(name, baseline) > 0);
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
    .sort(compareNames);

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

    const baselineApplies = baseline !== null && (await predatesLog(client, baseline));
    if (baseline && !baselineApplies) {
      console.log("[baseline ignored] schema does not predate the log; applying every migration");
    }

    for (const name of files) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [name]);
      if (done.rows.length > 0) {
        console.log("[skip]", name);
        continue;
      }

      if (baselineApplies && compareNames(name, baseline) <= 0) {
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
  console.error(err);
  process.exit(1);
});
