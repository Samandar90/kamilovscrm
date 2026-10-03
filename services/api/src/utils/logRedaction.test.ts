import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pgError } from "../testing/logFixtures";

const mockEnv = vi.hoisted(() => ({ debugErrorDetails: false, debugAiText: false }));
vi.mock("../config/env", () => ({ env: mockEnv }));
import { errorForLog, textForLog } from "./logRedaction";

beforeEach(() => {
  mockEnv.debugErrorDetails = false;
  mockEnv.debugAiText = false;
});

describe("errorForLog", () => {
  it("keeps the code and the constraint of a unique violation and drops the row values", () => {
    const logged = errorForLog(
      pgError({
        message: 'duplicate key value violates unique constraint "ux_patients_clinic_phone"',
        code: "23505",
        detail: "Key (clinic_id, phone)=(1, +998901234567) already exists.",
        table: "patients",
        constraint: "ux_patients_clinic_phone",
        file: "nbtinsert.c",
        line: "666",
        routine: "_bt_check_unique",
      })
    );
    expect(logged).toEqual({
      name: "error",
      code: "23505",
      constraint: "ux_patients_clinic_phone",
      table: "patients",
      routine: "_bt_check_unique",
      stack: expect.any(Array),
    });
    expect(inspect(logged)).not.toContain("998901234567");
  });

  it("drops the failing row of a not-null violation", () => {
    const logged = errorForLog(
      pgError({
        message: 'null value in column "clinic_id" of relation "ai_messages" violates not-null constraint',
        code: "23502",
        detail: "Failing row contains (41, 7, user, Найди пациента Каримов 901234567, 2026-10-03 10:00:00+00, null).",
        table: "ai_messages",
        column: "clinic_id",
        routine: "ExecConstraints",
      })
    );
    expect(logged).toEqual({
      name: "error",
      code: "23502",
      table: "ai_messages",
      column: "clinic_id",
      routine: "ExecConstraints",
      stack: expect.any(Array),
    });
    expect(inspect(logged)).not.toContain("Каримов");
  });

  it("drops a message and a context that quote the input value", () => {
    const logged = errorForLog(
      pgError({
        message: 'invalid input syntax for type integer: "Каримов"',
        code: "22P02",
        where: "unnamed portal parameter $2 = 'Каримов'",
        routine: "pg_strtoint32_safe",
      })
    );
    expect(logged).toEqual({ name: "error", code: "22P02", routine: "pg_strtoint32_safe", stack: expect.any(Array) });
    expect(inspect(logged)).not.toContain("Каримов");
  });

  it("keeps the message of a schema error: it names a column, not a value", () => {
    const logged = errorForLog(
      pgError({ message: "column a.queue_ticket does not exist", code: "42703", position: "58", routine: "errorMissingColumn" })
    );
    expect(logged).toEqual({
      name: "error",
      message: "column a.queue_ticket does not exist",
      code: "42703",
      routine: "errorMissingColumn",
      stack: expect.any(Array),
    });
  });

  it("gives the stack as frames, without the line that repeats the message", () => {
    const { stack } = errorForLog(pgError({ message: 'invalid input syntax for type integer: "Каримов"', code: "22P02" })) as {
      stack: string[];
    };
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.filter((frame) => !frame.startsWith("at "))).toEqual([]);
  });

  it('takes the frames from what follows the message: a quoted value of several lines may have a line that starts with "at"', () => {
    const logged = errorForLog(
      pgError({ message: 'invalid input syntax for type integer: "Просил перезвонить\nat 18:00 жене, 901112233"', code: "22P02" })
    ) as { stack: string[] };
    expect(logged.stack.length).toBeGreaterThan(0);
    expect(inspect(logged)).not.toContain("901112233");
  });

  it("gives no stack when the message is not in it: where the frames begin is not known", () => {
    const refused = pgError({
      message: 'invalid input syntax for type integer: "Просил перезвонить\nat 18:00 жене, 901112233"',
      code: "22P02",
    });
    // An error that took the stack of the one it replaces: that stack begins with the other message.
    const err = Object.assign(new Error("Не удалось сохранить заметку"), { stack: refused.stack });
    expect(errorForLog(err)).toEqual({ name: "Error", message: "Не удалось сохранить заметку" });
  });

  it("keeps the name, message and status of an application error and drops its other properties", () => {
    const err = Object.assign(new TypeError("Cannot read properties of undefined (reading 'rows')"), {
      status: 500,
      body: '{"fullName":"Каримов Алишер"}',
    });
    const logged = errorForLog(err);
    expect(logged).toEqual({
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'rows')",
      status: 500,
      stack: expect.any(Array),
    });
    expect(inspect(logged)).not.toContain("Каримов");
  });

  it("does not print a thrown value that is not an object", () => {
    expect(errorForLog("Каримов Алишер")).toEqual({ thrown: "string" });
  });
});

describe("errorForLog with DEBUG_ERROR_DETAILS on", () => {
  it("returns the error itself, with every detail", () => {
    mockEnv.debugErrorDetails = true;
    const err = pgError({
      message: 'duplicate key value violates unique constraint "ux_patients_clinic_phone"',
      code: "23505",
      detail: "Key (clinic_id, phone)=(1, +998901234567) already exists.",
    });
    expect(errorForLog(err)).toBe(err);
  });
});

describe("textForLog", () => {
  it("gives only the length of the text", () => {
    expect(textForLog("Найди пациента Каримов")).toStrictEqual({ len: 22 });
  });

  it("adds the text itself when DEBUG_AI_TEXT is on", () => {
    mockEnv.debugAiText = true;
    expect(textForLog("Найди пациента Каримов")).toStrictEqual({ len: 22, text: "Найди пациента Каримов" });
  });
});
