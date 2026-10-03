import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain rows and cells", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a comma inside a quoted cell", () => {
    expect(parseCsv('"Tashkent, Chilanzar",x')).toEqual([["Tashkent, Chilanzar", "x"]]);
  });

  it("reads doubled quotes inside quotes as one quote", () => {
    expect(parseCsv('"he said ""hi""",x')).toEqual([['he said "hi"', "x"]]);
    expect(parseCsv('"""",""')).toEqual([['"', ""]]);
  });

  it("keeps a line break inside a quoted cell", () => {
    expect(parseCsv('a,"line 1\nline 2"\nb,"line 3\r\nline 4"')).toEqual([
      ["a", "line 1\nline 2"],
      ["b", "line 3\r\nline 4"],
    ]);
  });

  it("reads CRLF line ends", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("﻿phone,name\n1,2")).toEqual([
      ["phone", "name"],
      ["1", "2"],
    ]);
    expect(parseCsv("﻿")).toEqual([]);
  });

  it("does not add an empty row for a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\nc,d\n")).toHaveLength(2);
  });

  it("returns no rows for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("keeps a row of empty cells", () => {
    expect(parseCsv("a,b\n,\nc,d")).toEqual([
      ["a", "b"],
      ["", ""],
      ["c", "d"],
    ]);
    expect(parseCsv(",")).toEqual([["", ""]]);
  });

  it("keeps an empty line between rows as a row with one empty cell", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });

  it("keeps an empty last cell", () => {
    expect(parseCsv("a,\nb,")).toEqual([
      ["a", ""],
      ["b", ""],
    ]);
  });

  it("does not trim cells", () => {
    expect(parseCsv(" a , b ")).toEqual([[" a ", " b "]]);
  });

  it("reads a quote in the middle of an unquoted cell as text", () => {
    expect(parseCsv('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("reads to the end when a quote is never closed", () => {
    expect(parseCsv('a,"b,c\nd')).toEqual([["a", "b,c\nd"]]);
  });

  it("reads a large table in one pass", () => {
    const line = "998901234567,Имя Фамилия,\"комментарий, с запятой\"";
    const rows = parseCsv(Array.from({ length: 20_000 }, () => line).join("\n"));
    expect(rows).toHaveLength(20_000);
    expect(rows[19_999]).toEqual(["998901234567", "Имя Фамилия", "комментарий, с запятой"]);
  });
});
