import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({ env: { debugErrorDetails: false } }));
import { errorForLog } from "../utils/logRedaction";

type Run = { printed: string; status: number | null };

const apiRoot = resolve(__dirname, "../..");
const db = new PGlite();
let server: Server;
let sandbox: string;

/** Pieces of the rows the migrations fail on: the script must print none of them. */
const ROW_VALUES = ["Каримов", "998901234567", "перезвонить", "901112233"];

/**
 * Runs scripts/db-migrate.cjs the way `npm start` does, with a single migration file, and returns
 * what it printed (stdout and stderr: Render keeps both) and its exit code. The script runs from a
 * copy in a directory of its own, where it finds this migration instead of the real ones and no
 * .env of the developer (the script lets .env override DATABASE_URL).
 */
const migrate = (
  file: string,
  sql: string,
  { env = {}, dotenv }: { env?: NodeJS.ProcessEnv; dotenv?: string } = {}
): Promise<Run> => {
  rmSync(join(sandbox, "migrations"), { recursive: true, force: true });
  mkdirSync(join(sandbox, "migrations"));
  writeFileSync(join(sandbox, "migrations", file), sql);
  rmSync(join(sandbox, ".env"), { force: true });
  if (dotenv !== undefined) writeFileSync(join(sandbox, ".env"), dotenv);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `postgres://127.0.0.1:${(server.address() as AddressInfo).port}/postgres`,
  };
  delete childEnv.NODE_ENV; // vitest sets it to "test"
  delete childEnv.DEBUG_ERROR_DETAILS;
  Object.assign(childEnv, env);

  return new Promise<Run>((done, failed) => {
    const child = spawn(process.execPath, [join(sandbox, "scripts", "db-migrate.cjs")], { env: childEnv });
    let printed = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8").on("data", (text: string) => {
        printed += text;
      });
    }
    child.on("error", failed);
    child.on("close", (status) => done({ printed, status }));
  });
};

/** The error PostgreSQL gives for the same SQL inside this process, as the API would receive it. */
const refusal = async (sql: string): Promise<unknown> => {
  try {
    await db.transaction((tx) => tx.exec(sql));
  } catch (err) {
    return err;
  }
  throw new Error(`PostgreSQL accepted: ${sql}`);
};

/** Names of the fields of the object the script printed: console.error puts each on a line of its own, two spaces in. */
const fields = (printed: string) => [...printed.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE patients (id serial PRIMARY KEY, clinic_id int NOT NULL, full_name text NOT NULL, phone text, note text);
    INSERT INTO patients (clinic_id, full_name, phone, note) VALUES
      (1, 'Каримов Алишер', '+998901234567', E'Просил перезвонить\\nat 18:00 жене, 901112233'),
      (1, 'Каримова Анна', '+998901234567', NULL);
  `);

  // PGlite behind a TCP port: the script connects with node-postgres, and PostgreSQL itself writes the errors.
  server = createServer((socket) => {
    let turn: Promise<void> = Promise.resolve();
    socket.on("data", (chunk) => {
      turn = turn
        .then(() => db.execProtocolRaw(new Uint8Array(chunk)))
        .then((reply) => {
          if (reply.length > 0 && !socket.destroyed) socket.write(reply);
        })
        .catch(() => {
          socket.destroy();
        });
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));

  // Under node_modules: there the copy's require("pg") finds the packages of services/api, and git ignores the files.
  const cache = join(apiRoot, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  sandbox = mkdtempSync(join(cache, "db-migrate-test-"));
  mkdirSync(join(sandbox, "scripts"));
  copyFileSync(join(apiRoot, "scripts", "db-migrate.cjs"), join(sandbox, "scripts", "db-migrate.cjs"));
}, 30000);

afterAll(async () => {
  await new Promise((closed) => server.close(closed));
  await db.close();
  rmSync(sandbox, { recursive: true, force: true });
});

const UNIQUE_PHONE = {
  file: "036_unique_patient_phone.sql",
  sql: "CREATE UNIQUE INDEX ux_patients_clinic_phone ON patients (clinic_id, phone);",
};

// Each migration fails on the rows above; the last one fails by itself.
describe.each([
  [
    "a unique index that repeated phones break",
    UNIQUE_PHONE.file,
    UNIQUE_PHONE.sql,
    ["code: '23505'", "constraint: 'ux_patients_clinic_phone'", "table: 'patients'"],
  ],
  [
    "a data fix that leaves a required column empty",
    "037_detach_patients.sql",
    "UPDATE patients SET clinic_id = NULL;",
    ["code: '23502'", "table: 'patients'", "column: 'clinic_id'"],
  ],
  [
    "a value that does not convert to the new column type",
    "038_full_name_as_number.sql",
    "ALTER TABLE patients ALTER COLUMN full_name TYPE integer USING full_name::integer;",
    ["code: '22P02'"],
  ],
  [
    // PostgreSQL quotes the value in the message, the message opens the stack, and its second line starts with "at".
    "a value of several lines that does not convert",
    "039_note_as_number.sql",
    "ALTER TABLE patients ALTER COLUMN note TYPE integer USING note::integer;",
    ["code: '22P02'"],
  ],
  [
    "a mistake in the migration itself",
    "040_phone_again.sql",
    "ALTER TABLE patients ADD COLUMN phone text;",
    ["code: '42701'", 'column "phone" of relation "patients" already exists'],
  ],
] as const)("db-migrate.cjs output for %s", (_title, file, sql, shown) => {
  let run: Run;
  beforeAll(async () => {
    run = await migrate(file, sql);
  }, 30000);

  it("names the migration file and exits with code 1", () => {
    expect(run.printed).toContain(`[fail] ${file}`);
    expect(run.status).toBe(1);
  });

  it(`has ${shown.join(", ")}`, () => {
    for (const text of shown) expect(run.printed).toContain(text);
  });

  it("has no value of the rows", () => {
    for (const value of ROW_VALUES) expect(run.printed).not.toContain(value);
  });

  it("has the fields, with the values, that the API's errorForLog keeps for the same error", async () => {
    const logged = errorForLog(await refusal(sql)) as Record<string, unknown>;
    expect(fields(run.printed)).toEqual(Object.keys(logged));
    for (const [field, value] of Object.entries(logged)) {
      if (field !== "stack") expect(run.printed).toContain(`${field}: ${inspect(value)}`);
    }
  });
});

describe("db-migrate.cjs output with DEBUG_ERROR_DETAILS=1", () => {
  const DETAIL = "Key (clinic_id, phone)=(1, +998901234567) is duplicated.";

  it("is the full error, with the detail", async () => {
    const { printed, status } = await migrate(UNIQUE_PHONE.file, UNIQUE_PHONE.sql, { env: { DEBUG_ERROR_DETAILS: "1" } });
    expect(printed).toContain(DETAIL);
    expect(status).toBe(1);
  }, 30000);

  it("is the full error when the flag is set in .env", async () => {
    const { printed } = await migrate(UNIQUE_PHONE.file, UNIQUE_PHONE.sql, { dotenv: "DEBUG_ERROR_DETAILS=1\n" });
    expect(printed).toContain(DETAIL);
  }, 30000);

  it("still has no value of the rows when NODE_ENV=production", async () => {
    const { printed, status } = await migrate(UNIQUE_PHONE.file, UNIQUE_PHONE.sql, {
      env: { DEBUG_ERROR_DETAILS: "1", NODE_ENV: "production" },
    });
    expect(printed).toContain("code: '23505'");
    for (const value of ROW_VALUES) expect(printed).not.toContain(value);
    expect(status).toBe(1);
  }, 30000);
});

describe("db-migrate.cjs output for a failure that is not PostgreSQL's", () => {
  it("keeps the message: a database that refuses the connection", async () => {
    // Port 1 of this machine: nothing listens there.
    const { printed, status } = await migrate(UNIQUE_PHONE.file, UNIQUE_PHONE.sql, {
      env: { DATABASE_URL: "postgres://127.0.0.1:1/postgres" },
    });
    expect(printed).toContain("connect ECONNREFUSED 127.0.0.1:1");
    expect(printed).toContain("code: 'ECONNREFUSED'");
    expect(status).toBe(1);
  }, 30000);
});
