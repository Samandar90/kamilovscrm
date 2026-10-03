import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Request } from "express";
import { fakeResponse, pgError, printedLines } from "../testing/logFixtures";

const mockEnv = vi.hoisted(() => ({ isProduction: true, debugErrorDetails: false }));
vi.mock("../config/env", () => ({ env: mockEnv }));
import { errorHandler } from "./errorHandler";

const duplicatePhone = () =>
  pgError({
    message: 'duplicate key value violates unique constraint "ux_patients_clinic_phone"',
    code: "23505",
    detail: "Key (clinic_id, phone)=(1, +998901234567) already exists.",
    table: "patients",
    constraint: "ux_patients_clinic_phone",
    routine: "_bt_check_unique",
  });

/** Runs the handler and returns what it wrote with console.error and the status it answered with. */
const handle = (err: unknown) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { res, sent } = fakeResponse();
  errorHandler(err, {} as Request, res, () => undefined);
  return { printed: printedLines(error).join("\n"), status: sent.status };
};

beforeEach(() => {
  mockEnv.isProduction = true;
  mockEnv.debugErrorDetails = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorHandler log of a PostgreSQL error", () => {
  it("has the code and the constraint, not the values of the row", () => {
    const { printed, status } = handle(duplicatePhone());
    expect(status).toBe(409);
    expect(printed).toContain("RAW BACKEND ERROR:");
    expect(printed).toContain("23505");
    expect(printed).toContain("ux_patients_clinic_phone");
    expect(printed).not.toContain("998901234567");
  });

  it("leaves out a message that quotes the input value", () => {
    const { printed, status } = handle(
      pgError({ message: 'invalid input syntax for type integer: "Каримов"', code: "22P02", routine: "pg_strtoint32_safe" })
    );
    expect(status).toBe(400);
    expect(printed).toContain("22P02");
    expect(printed).not.toContain("Каримов");
  });

  it("has no row values outside production either, while the debug flag is off", () => {
    mockEnv.isProduction = false;
    const { printed } = handle(duplicatePhone());
    expect(printed).toContain("23505");
    expect(printed).not.toContain("998901234567");
  });

  it("has the full detail with DEBUG_ERROR_DETAILS on", () => {
    mockEnv.isProduction = false;
    mockEnv.debugErrorDetails = true;
    const { printed } = handle(duplicatePhone());
    expect(printed).toContain("Key (clinic_id, phone)=(1, +998901234567) already exists.");
  });
});

describe("errorHandler log of what a real PostgreSQL refuses", () => {
  const db = new PGlite();
  const insertPatient = "INSERT INTO patients (clinic_id, full_name, phone) VALUES ($1, $2, $3)";

  /** Runs a statement PostgreSQL must refuse and returns what the handler did with its error. */
  const refused = async (sql: string, params: unknown[] = []) => {
    let err: unknown;
    try {
      await db.query(sql, params);
    } catch (caught) {
      err = caught;
    }
    if (err === undefined) throw new Error(`PostgreSQL accepted: ${sql}`);
    return handle(err);
  };

  beforeAll(async () => {
    await db.query(`
      CREATE TABLE patients (
        id serial PRIMARY KEY,
        clinic_id int NOT NULL,
        full_name text NOT NULL,
        phone text,
        CONSTRAINT ux_patients_clinic_phone UNIQUE (clinic_id, phone)
      )
    `);
    await db.query(insertPatient, [1, "Каримов Алишер", "+998901234567"]);
  });
  afterAll(async () => {
    await db.close();
  });

  it("a repeated phone: the constraint and the table, not the phone", async () => {
    const { printed, status } = await refused(insertPatient, [1, "Каримов Алишер", "+998901234567"]);
    expect(status).toBe(409);
    expect(printed).toContain("23505");
    expect(printed).toContain("constraint: 'ux_patients_clinic_phone'");
    expect(printed).toContain("table: 'patients'");
    expect(printed).not.toContain("998901234567");
    expect(printed).not.toContain("Каримов");
  });

  it("a missing required value: the column, not the row", async () => {
    const { printed, status } = await refused(insertPatient, [null, "Каримов Алишер", "+998901234567"]);
    expect(status).toBe(400);
    expect(printed).toContain("23502");
    expect(printed).toContain("column: 'clinic_id'");
    expect(printed).not.toContain("998901234567");
    expect(printed).not.toContain("Каримов");
  });

  it("a stored value that does not convert: the code, not the value", async () => {
    const { printed, status } = await refused("SELECT full_name::int FROM patients");
    expect(status).toBe(400);
    expect(printed).toContain("22P02");
    expect(printed).not.toContain("Каримов");
  });

  it("a missing column: the message that names it", async () => {
    const { printed, status } = await refused("SELECT queue_ticket FROM patients");
    expect(status).toBe(500);
    expect(printed).toContain("42703");
    expect(printed).toContain('column "queue_ticket" does not exist');
  });
});
