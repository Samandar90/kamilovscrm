import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
vi.mock("../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-doctor-validator-tests-only" } }));
import { validateCreateDoctor, validateUpdateDoctor } from "./doctorsValidators";
import { ApiError } from "../middleware/errorHandler";

type Validator = (req: Request, res: Response, next: NextFunction) => void;
const ROOM_ERROR = "Field 'room' must be a string up to 20 characters";
const PREFIX_ERROR = "Field 'queuePrefix' must be a single letter";
// The create validator already requires phone and birth_date keys (null is fine) — keep them in every create body.
const baseDoctor = { name: "Др. Алиева", speciality: "Терапевт", percent: 10, active: true, phone: null, birth_date: null };

/** Runs a validator like Express would: returns the (mutated) body or the thrown error. */
const run = (validator: Validator, body: Record<string, unknown>) => {
  const req = { body, params: {} } as unknown as Request;
  const next = vi.fn();
  try {
    validator(req, {} as Response, next as unknown as NextFunction);
  } catch (error) {
    expect(next).not.toHaveBeenCalled();
    return { error: error as ApiError, body: req.body as Record<string, unknown> };
  }
  expect(next).toHaveBeenCalledTimes(1);
  return { error: null, body: req.body as Record<string, unknown> };
};

describe("validateCreateDoctor room and queue letter", () => {
  it("trims the room and upper-cases the letter", () => {
    const { error, body } = run(validateCreateDoctor, { ...baseDoctor, room: " 12 ", queuePrefix: " к " });
    expect(error).toBeNull();
    expect(body).toMatchObject({ room: "12", queuePrefix: "К" });
  });

  it("accepts the snake_case alias queue_prefix", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, queue_prefix: "b" }).body.queuePrefix).toBe("B");
  });

  it("stores empty strings and null as null", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "   ", queuePrefix: "" }).body).toMatchObject({ room: null, queuePrefix: null });
    expect(run(validateCreateDoctor, { ...baseDoctor, room: null, queuePrefix: null }).body).toMatchObject({ room: null, queuePrefix: null });
  });

  it("leaves both fields out when they are not sent", () => {
    const { error, body } = run(validateCreateDoctor, { ...baseDoctor });
    expect(error).toBeNull();
    expect(body.room).toBeUndefined();
    expect(body.queuePrefix).toBeUndefined();
  });

  it("counts room length in characters, up to 20", () => {
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "Кабинет УЗИ, 2 этаж!" }).body.room).toBe("Кабинет УЗИ, 2 этаж!"); // 20 chars
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "𝟙".repeat(20) }).error).toBeNull(); // 20 code points, 40 UTF-16 units
    expect(run(validateCreateDoctor, { ...baseDoctor, room: "x".repeat(21) }).error).toMatchObject({ status: 400, message: ROOM_ERROR });
  });

  // Each case is wrapped in an array: it.each spreads array items into arguments.
  it.each([[12], [true], [["5"]], [{ room: "5" }]])("rejects a non-string room %j", (room: unknown) => {
    const { error } = run(validateCreateDoctor, { ...baseDoctor, room });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: ROOM_ERROR });
  });

  it.each(["AB", "1", "-", "К1", 5, true])("rejects queue letter %j", (queuePrefix) => {
    const { error } = run(validateCreateDoctor, { ...baseDoctor, queuePrefix });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: PREFIX_ERROR });
  });

  it.each([["a", "A"], ["ў", "Ў"], ["Ғ", "Ғ"], ["ß", "ß"]])("accepts letter %j as %j", (queuePrefix, stored) => {
    // "ß".toUpperCase() is "SS" (two letters): the validator keeps the original so the DB CHECK (one character) still holds.
    expect(run(validateCreateDoctor, { ...baseDoctor, queuePrefix }).body.queuePrefix).toBe(stored);
  });
});

describe("validateUpdateDoctor room and queue letter", () => {
  it("accepts an update that only changes the room", () => {
    const { error, body } = run(validateUpdateDoctor, { room: " 7 " });
    expect(error).toBeNull();
    expect(body).toEqual({ room: "7" });
  });

  it("accepts an update that only clears the queue letter", () => {
    const { error, body } = run(validateUpdateDoctor, { queuePrefix: null });
    expect(error).toBeNull();
    expect(body).toEqual({ queuePrefix: null });
  });

  it("accepts the queue_prefix alias as the only field", () => {
    expect(run(validateUpdateDoctor, { queue_prefix: "т" }).body.queuePrefix).toBe("Т");
  });

  it("clears a blank room", () => {
    expect(run(validateUpdateDoctor, { room: "  " }).body.room).toBeNull();
  });

  it("rejects invalid values with 400", () => {
    expect(run(validateUpdateDoctor, { room: "x".repeat(21) }).error).toMatchObject({ status: 400, message: ROOM_ERROR });
    expect(run(validateUpdateDoctor, { queuePrefix: "12" }).error).toMatchObject({ status: 400, message: PREFIX_ERROR });
  });

  it("still requires at least one field", () => {
    expect(run(validateUpdateDoctor, {}).error).toMatchObject({ status: 400, message: "At least one field must be provided for update" });
  });
});
