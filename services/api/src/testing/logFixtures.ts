import { format } from "node:util";
import type { Response } from "express";
import { DatabaseError } from "pg";
import type { MockInstance } from "vitest";

type PgErrorFields = { message: string; code: string } & Partial<
  Pick<DatabaseError, "detail" | "where" | "position" | "table" | "column" | "constraint" | "file" | "line" | "routine">
>;

/** An error as node-postgres builds it from the server's ErrorResponse. */
export function pgError({ message, ...fields }: PgErrorFields): DatabaseError {
  return Object.assign(new DatabaseError(message, 231, "error"), { severity: "ERROR", schema: "public", ...fields });
}

const formatArgs: (...args: unknown[]) => string = format;

/** The lines a spied console method wrote: Node formats the arguments of console.log and console.error with util.format. */
export const printedLines = (spy: MockInstance): string[] => spy.mock.calls.map((args) => formatArgs(...args));

/** An Express response that records the status and the body it was given. */
export function fakeResponse(): { res: Response; sent: { status?: number; body?: unknown } } {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, sent };
}
