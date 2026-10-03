import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const FILE = "037_users_role_marketer.sql";
const migration = (file: string) => readFileSync(resolve(__dirname, "../../../migrations", file), "utf8");
/** Applies a file the way scripts/db-migrate.cjs does: inside one transaction. */
const apply = async (db: PGlite, file: string) => {
  const sql = migration(file);
  await db.exec("BEGIN");
  try {
    await db.exec(sql);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
};
/** Resolves to the Postgres error (code + constraint) or null when the statement succeeds. */
const failure = async (db: PGlite, sql: string) => {
  try {
    await db.query(sql);
    return null;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
};
const INSERT_MARKETER = "INSERT INTO users (username, password_hash, full_name, role) VALUES ('target', 'x', 'Таргетолог', 'marketer')";
const roles = async (db: PGlite) =>
  (await db.query<{ role: string }>("SELECT role FROM users ORDER BY id")).rows.map((row) => row.role);
const userConstraints = async (db: PGlite) =>
  (await db.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' ORDER BY conname"
  )).rows.map((row) => row.conname);

const databases: PGlite[] = [];
const database = () => {
  const db = new PGlite();
  databases.push(db);
  return db;
};
afterAll(async () => {
  await Promise.all(databases.map((db) => db.close()));
});

describe("migration 037 users role marketer", () => {
  it("drops the role check of a database built from the migration files", async () => {
    const db = database();
    await db.exec(migration("002_users.sql"));
    const STAFF = ["superadmin", "reception", "doctor", "nurse", "cashier", "operator", "accountant", "manager", "director"];
    for (const role of STAFF) {
      await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, 'x', $1, $1)", [role]);
    }
    expect(await userConstraints(db)).toContain("users_role_check");
    expect(await failure(db, INSERT_MARKETER)).toMatchObject({ code: "23514", constraint: "users_role_check" });

    await apply(db, FILE);
    // The runner applies each file once, but a failed deploy may retry it: 037 must be safe to run again.
    await apply(db, FILE);

    expect(await userConstraints(db)).toEqual(["users_failed_login_attempts_check", "users_failed_login_reasonable"]);
    expect(await failure(db, INSERT_MARKETER)).toBeNull();
    expect(await roles(db)).toEqual([...STAFF, "marketer"]);
    // SET LOCAL ends with the migration's transaction.
    expect((await db.query<{ lock_timeout: string }>("SHOW lock_timeout")).rows[0].lock_timeout).toBe("0");
  }, 30000);

  it("changes nothing in the production shape: no role check, a legacy role value", async () => {
    const db = database();
    await db.exec(`CREATE TABLE users(id bigserial primary key, clinic_id bigint, username text not null, password_hash text not null,
        full_name text not null, role text not null, is_active boolean, deleted_at timestamptz);
      INSERT INTO users (clinic_id, username, password_hash, full_name, role) VALUES (1, 'old', 'x', 'Старый админ', 'admin');`);

    await apply(db, FILE);
    await apply(db, FILE);

    expect(await userConstraints(db)).toEqual([]);
    expect((await db.query("SELECT id, clinic_id, username, full_name, role, is_active, deleted_at FROM users")).rows).toEqual([
      { id: 1, clinic_id: 1, username: "old", full_name: "Старый админ", role: "admin", is_active: null, deleted_at: null },
    ]);
    expect(await failure(db, INSERT_MARKETER)).toBeNull();
  }, 30000);

  it("drops a legacy role check that lists other roles without reading the rows", async () => {
    const db = database();
    await db.exec(`CREATE TABLE users(id bigserial primary key, username text not null, password_hash text not null, full_name text not null,
        role text not null CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'doctor', 'cashier')));
      INSERT INTO users (username, password_hash, full_name, role) VALUES ('old', 'x', 'Старый админ', 'admin');`);
    expect(await failure(db, INSERT_MARKETER)).toMatchObject({ code: "23514", constraint: "users_role_check" });

    await apply(db, FILE);

    expect(await userConstraints(db)).toEqual([]);
    expect(await roles(db)).toEqual(["admin"]);
    expect(await failure(db, INSERT_MARKETER)).toBeNull();
  }, 30000);
});
