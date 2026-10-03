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
    expect(parseCsv("\uFEFFphone,name\n1,2")).toEqual([
      ["phone", "name"],
      ["1", "2"],
    ]);
    expect(parseCsv("\uFEFF")).toEqual([]);
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

  describe("with a row limit", () => {
    it("returns every row of a text that has no more rows than the limit", () => {
      expect(parseCsv("a,b\nc,d\ne,f", 3)).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
      expect(parseCsv("a,b\nc,d\ne,f\n", 3)).toHaveLength(3);
      expect(parseCsv("", 0)).toEqual([]);
    });

    it("stops one row past the limit: a longer text gives limit + 1 rows", () => {
      expect(parseCsv("a\nb\nc\nd\ne", 3)).toEqual([["a"], ["b"], ["c"], ["d"]]);
      expect(parseCsv("a\nb\nc\nd", 3)).toHaveLength(4);
      expect(parseCsv("a\r\nb\r\nc\r\nd\r\ne\r\n", 2)).toEqual([["a"], ["b"], ["c"]]);
      expect(parseCsv("a", 0)).toEqual([["a"]]);
    });

    it("counts empty lines and a line break inside quotes is not a row", () => {
      expect(parseCsv("\n\n\n\n\n", 2)).toEqual([[""], [""], [""]]);
      expect(parseCsv('"1\n2\n3\n4",x\ny', 2)).toEqual([["1\n2\n3\n4", "x"], ["y"]]);
    });

    it("does not turn millions of short rows into arrays", () => {
      const rows = parseCsv("1\n".repeat(2_000_000), 20_000);
      expect(rows).toHaveLength(20_001);
      expect(rows[20_000]).toEqual(["1"]);
    });
  });
});
