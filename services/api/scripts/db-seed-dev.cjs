#!/usr/bin/env node
/**
 * Optional dev seed: default superadmin (only if no users exist), plus a clinic if none exists.
 * Password: admin123 (change immediately).
 *
 *   npm run db:seed:dev
 */
"use strict";

const path = require("path");
const bcrypt = require("bcrypt");
const { Client } = require("pg");

const apiRoot = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(apiRoot, ".env"), override: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || String(url).trim() === "") {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = new Client({ connectionString: String(url).trim() });
  await client.connect();

  const { rows } = await client.query("SELECT COUNT(*)::text AS c FROM users WHERE deleted_at IS NULL");
  const n = Number(rows[0]?.c ?? 0);
  if (n > 0) {
    console.log("Users already exist (count=", n, "). Skip seed.");
    await client.end();
    return;
  }

  const hash = await bcrypt.hash("admin123", 10);
  try {
    await client.query("BEGIN");

    // users.clinic_id is NOT NULL: reuse the first clinic, or create one on an empty database.
    // Active with no end date, like the founder clinic in 027, so subscription checks pass.
    const existing = await client.query("SELECT id FROM clinics ORDER BY id LIMIT 1");
    const clinicId =
      existing.rows[0]?.id ??
      (
        await client.query(
          `
          INSERT INTO clinics (name, slug, subscription_status, subscription_ends_at)
          VALUES ('Dev clinic', 'dev', 'active', NULL)
          RETURNING id
          `
        )
      ).rows[0].id;

    // Platform owner, like clinic 1's superadmin in 028.
    await client.query(
      `
      INSERT INTO users (
        clinic_id,
        username,
        password_hash,
        full_name,
        role,
        is_active,
        is_platform_admin,
        doctor_id,
        deleted_at
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, NULL, NULL)
      `,
      [clinicId, "admin", hash, "Administrator", "superadmin"]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
  console.log("Seeded superadmin: username=admin password=admin123 (DEV ONLY — change now)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
