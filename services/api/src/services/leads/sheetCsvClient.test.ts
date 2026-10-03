import { describe, expect, it } from "vitest";
import { buildSheetUrl, parseSheetUrl } from "./sheetCsvClient";

/** A made-up id of the usual length (44); no real spreadsheet is named in tests. */
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-aBcDe";
const SHEET = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

describe("parseSheetUrl", () => {
  it("uses a 44-character id in these tests", () => {
    expect(SHEET_ID).toHaveLength(44);
  });

  it.each([
    [`${SHEET}/edit?usp=sharing`, 0], // the link the "Share" button gives
    [`${SHEET}/edit#gid=123`, 123],
    [`${SHEET}/edit?gid=123#gid=123`, 123],
    [`${SHEET}/edit?usp=sharing&gid=45`, 45], // gid only in the query
    [`${SHEET}/edit?gid=1#gid=2`, 2], // the fragment is the tab that is open
    [`${SHEET}/edit#gid=7&range=A1`, 7],
    [`${SHEET}/edit#gid=0`, 0],
    [`${SHEET}`, 0],
    [`${SHEET}/`, 0],
    [`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit#gid=9`, 9], // second signed-in account
    [`docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=5`, 5], // pasted without the scheme
    [`  ${SHEET}/edit?usp=sharing \n`, 0],
    [SHEET_ID, 0], // a bare id
  ])("reads %j → gid %d", (input, gid) => {
    expect(parseSheetUrl(input)).toEqual({ spreadsheetId: SHEET_ID, gid });
  });

  it.each([20, 100])("takes a bare id of %d characters", (length) => {
    const id = "a".repeat(length);
    expect(parseSheetUrl(id)).toEqual({ spreadsheetId: id, gid: 0 });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toEqual({ spreadsheetId: id, gid: 0 });
  });

  it.each([
    ["", "empty"],
    ["   ", "spaces only"],
    [`https://evil.example/spreadsheets/d/${SHEET_ID}/edit`, "another host"],
    [`https://docs.google.com.evil.example/spreadsheets/d/${SHEET_ID}/edit`, "a host that only starts like Google"],
    [`https://docs.google.com@evil.example/spreadsheets/d/${SHEET_ID}/edit`, "Google as the user name of another host"],
    [`https://sheets.google.com/spreadsheets/d/${SHEET_ID}/edit`, "another Google host"],
    ["https://docs.google.com/spreadsheets/", "a path without /d/<id>"],
    ["https://docs.google.com/spreadsheets/u/0/", "the list of sheets"],
    [`https://docs.google.com/document/d/${SHEET_ID}/edit`, "a document, not a sheet"],
    [`https://docs.google.com/spreadsheets/d/${SHEET_ID.slice(0, 19)}/edit`, "an id shorter than 20"],
    [`https://docs.google.com/spreadsheets/d/${"a".repeat(101)}/edit`, "an id longer than 100"],
    ["https://docs.google.com/spreadsheets/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml", "a published copy"],
    [`${SHEET}/edit#gid=99999999999999999999`, "a gid that is not a safe integer"],
    [SHEET_ID.slice(0, 19), "a bare id shorter than 20"],
    ["a".repeat(101), "a bare id longer than 100"],
    ["таблица лидов таргетолога", "plain text"],
    [`${SHEET_ID}/../x`, "an id with a path"],
    [`${SHEET}/edit?x=${"a".repeat(3000)}`, "a link longer than 2000 characters"],
  ])("rejects %j (%s)", (input) => {
    expect(parseSheetUrl(input)).toBeNull();
  });

  it("returns null for a value that is not a string", () => {
    expect(parseSheetUrl(null as unknown as string)).toBeNull();
    expect(parseSheetUrl(123 as unknown as string)).toBeNull();
  });
});

describe("buildSheetUrl", () => {
  it("builds the link to the sheet tab", () => {
    expect(buildSheetUrl(SHEET_ID, 7)).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=7`);
  });

  it("round-trips through parseSheetUrl", () => {
    expect(parseSheetUrl(buildSheetUrl(SHEET_ID, 7))).toEqual({ spreadsheetId: SHEET_ID, gid: 7 });
    expect(parseSheetUrl(buildSheetUrl(SHEET_ID, 0))).toEqual({ spreadsheetId: SHEET_ID, gid: 0 });
  });
});
