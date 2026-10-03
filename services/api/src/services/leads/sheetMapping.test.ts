import { describe, expect, it } from "vitest";
import { mapSheetRows, type SheetMapping } from "./sheetMapping";

const NOTHING: SheetMapping = {
  status: "empty",
  headers: [],
  detected: { phone: null, name: null },
  rows: [],
  dataRows: 0,
  skipped: 0,
};

describe("mapSheetRows: header detection", () => {
  it("reads an empty table as empty", () => {
    expect(mapSheetRows([], null)).toEqual(NOTHING);
  });

  it("reads a table of only empty rows as empty", () => {
    expect(mapSheetRows([[""], ["", "  "], [], [" ", ""]], null)).toEqual(NOTHING);
  });

  it("finds the phone and the name by header and keeps the other columns as extra", () => {
    const mapping = mapSheetRows(
      [
        ["Дата", "Имя", "Телефон", "Комментарий"],
        ["01.10.2026", "Алишер Каримов", "+998 90 123-45-67", "УЗИ, после 18:00"],
        ["02.10.2026", "Дилноза", "933334455", "перезвонить"],
      ],
      null
    );

    expect(mapping).toEqual({
      status: "ok",
      headers: ["Дата", "Имя", "Телефон", "Комментарий"],
      detected: { phone: "Телефон", name: "Имя" },
      rows: [
        {
          phone: "998901234567",
          fullName: "Алишер Каримов",
          extra: { Дата: "01.10.2026", Комментарий: "УЗИ, после 18:00" },
        },
        { phone: "998933334455", fullName: "Дилноза", extra: { Дата: "02.10.2026", Комментарий: "перезвонить" } },
      ],
      dataRows: 2,
      skipped: 0,
    });
  });

  it("detects phone_number and full_name", () => {
    const mapping = mapSheetRows(
      [
        ["id", "created_time", "full_name", "phone_number"],
        ["l:1", "2026-10-01T10:00:00+05:00", "Test Lead", "p:+998901234567"],
      ],
      null
    );

    expect(mapping.status).toBe("ok");
    expect(mapping.detected).toEqual({ phone: "phone_number", name: "full_name" });
    expect(mapping.rows).toEqual([
      { phone: "998901234567", fullName: "Test Lead", extra: { id: "l:1", created_time: "2026-10-01T10:00:00+05:00" } },
    ]);
  });

  it.each([
    "телефон",
    "номертелефона",
    "телефонныйномер",
    "тел",
    "моб",
    "мобильный",
    "мобильныйтелефон",
    "номер",
    "phone",
    "phonenumber",
    "mobile",
    "mobilephone",
    "tel",
    "telefon",
    "telefonraqami",
    "telefonraqam",
    "raqam",
  ])("takes %j as a phone header", (header) => {
    expect(mapSheetRows([[header], ["998901234567"]], null).detected.phone).toBe(header);
  });

  it.each(["имя", "фио", "имяифамилия", "клиент", "имяклиента", "полноеимя", "name", "fullname", "firstname", "ism", "ismfamiliya", "ismi", "fio", "mijoz"])(
    "takes %j as a name header",
    (header) => {
      expect(mapSheetRows([["phone", header], ["998901234567", "Test"]], null).detected.name).toBe(header);
    }
  );

  it.each([
    ["Номер телефона", "Ф.И.О."],
    ["  ТЕЛЕФОН  ", "Имя клиента"],
    ["Тел.:", "Имя и фамилия"],
    ["Phone Number", "Full Name"],
    ["Mobile-Phone", "first_name"],
    ["Telefon raqami:", "Ism-familiya"],
  ])("compares headers without case, spaces and punctuation: %j, %j", (phone, name) => {
    const mapping = mapSheetRows([[name, phone], ["Test", "998901234567"]], null);

    expect(mapping.detected).toEqual({ phone: phone.trim(), name: name.trim() });
    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: "Test", extra: {} }]);
  });

  it("prefers the more exact phone header when two columns qualify", () => {
    const mapping = mapSheetRows(
      [
        ["Номер", "Имя", "Телефон"],
        ["1", "Test", "998901234567"],
      ],
      null
    );

    expect(mapping.detected.phone).toBe("Телефон");
    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: "Test", extra: { Номер: "1" } }]);
  });

  it("finds the header below a title row", () => {
    const mapping = mapSheetRows(
      [["Лиды, октябрь"], [], ["Имя", "Телефон"], ["Test", "998901234567"]],
      null
    );

    expect(mapping.status).toBe("ok");
    expect(mapping.headers).toEqual(["Имя", "Телефон"]);
    expect(mapping.dataRows).toBe(1);
    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: "Test", extra: {} }]);
  });

  it("finds the header on row 10 and not on row 11", () => {
    const filler = Array.from({ length: 9 }, (_, i) => [`строка ${i + 1}`]);

    expect(mapSheetRows([...filler, ["Телефон"], ["998901234567"]], null).status).toBe("ok");
    expect(mapSheetRows([...filler, ["ещё одна"], ["Телефон"], ["998901234567"]], null).status).toBe("columns_not_found");
  });

  it("reports columns_not_found with the first non-empty row as headers when no phone header is found", () => {
    const mapping = mapSheetRows(
      [[], ["Дата", "Контакт", "", "Город"], ["01.10.2026", "998901234567", "", "Ташкент"]],
      null
    );

    expect(mapping).toEqual({
      status: "columns_not_found",
      headers: ["Дата", "Контакт", "Город"],
      detected: { phone: null, name: null },
      rows: [],
      dataRows: 0,
      skipped: 0,
    });
  });

  it("reads a table with a header and no rows as read, with nothing to import", () => {
    expect(mapSheetRows([["Имя", "Телефон"]], null)).toEqual({
      status: "ok",
      headers: ["Имя", "Телефон"],
      detected: { phone: "Телефон", name: "Имя" },
      rows: [],
      dataRows: 0,
      skipped: 0,
    });
  });

  it("works without a name column", () => {
    const mapping = mapSheetRows([["Телефон", "Город"], ["998901234567", "Ташкент"]], null);

    expect(mapping.detected).toEqual({ phone: "Телефон", name: null });
    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: null, extra: { Город: "Ташкент" } }]);
  });
});

describe("mapSheetRows: column map", () => {
  const table = [
    ["Клиент ФИО", "Контакт", "Телефон", "Город"],
    ["Test", "998901234567", "998935556677", "Ташкент"],
  ];

  it("uses the mapped phone column even though its header is not a synonym", () => {
    const mapping = mapSheetRows(table, { phone: "Контакт", name: null });

    expect(mapping.status).toBe("ok");
    expect(mapping.detected).toEqual({ phone: "Контакт", name: null });
    expect(mapping.rows).toEqual([
      {
        phone: "998901234567",
        fullName: null,
        extra: { "Клиент ФИО": "Test", Телефон: "998935556677", Город: "Ташкент" },
      },
    ]);
  });

  it("uses the mapped name column", () => {
    const mapping = mapSheetRows(table, { phone: "Контакт", name: "Клиент ФИО" });

    expect(mapping.detected).toEqual({ phone: "Контакт", name: "Клиент ФИО" });
    expect(mapping.rows).toEqual([
      { phone: "998901234567", fullName: "Test", extra: { Телефон: "998935556677", Город: "Ташкент" } },
    ]);
  });

  it("compares mapped headers the same way as synonyms", () => {
    const mapping = mapSheetRows(table, { phone: " контакт ", name: "клиент_фио" });

    expect(mapping.detected).toEqual({ phone: "Контакт", name: "Клиент ФИО" });
    expect(mapping.rows).toHaveLength(1);
  });

  it("imports nothing when the mapped phone header is gone", () => {
    const mapping = mapSheetRows(
      [
        ["Имя", "Телефон"],
        ["Test", "998901234567"],
      ],
      { phone: "Контакт", name: null }
    );

    expect(mapping).toEqual({
      status: "columns_not_found",
      headers: ["Имя", "Телефон"],
      detected: { phone: null, name: null },
      rows: [],
      dataRows: 0,
      skipped: 0,
    });
  });

  it("imports nothing when the mapped name header is gone", () => {
    const mapping = mapSheetRows(table, { phone: "Контакт", name: "Имя" });

    expect(mapping.status).toBe("columns_not_found");
    expect(mapping.headers).toEqual(["Клиент ФИО", "Контакт", "Телефон", "Город"]);
    expect(mapping.detected).toEqual({ phone: "Контакт", name: null });
    expect(mapping.rows).toEqual([]);
  });

  it("does not take one column for both the phone and the name", () => {
    const mapping = mapSheetRows(table, { phone: "Контакт", name: "Контакт" });

    expect(mapping.status).toBe("columns_not_found");
    expect(mapping.rows).toEqual([]);
  });

  it("does not match an empty mapped header to an empty header cell", () => {
    const withGap = [
      ["", "Телефон"],
      ["Test", "998901234567"],
    ];

    expect(mapSheetRows(withGap, { phone: "", name: null }).status).toBe("columns_not_found");
    expect(mapSheetRows(withGap, { phone: "Телефон", name: " " }).status).toBe("columns_not_found");
  });
});

describe("mapSheetRows: rows", () => {
  it("counts a row with an unusable phone as skipped and does not return it", () => {
    const mapping = mapSheetRows(
      [
        ["Имя", "Телефон"],
        ["Первый", "998901234567"],
        ["Без телефона", ""],
        ["Экспонента", "9.98901E+11"],
        ["Короткий", "12345"],
        ["Второй", "+7 912 345-67-89"],
      ],
      null
    );

    expect(mapping.status).toBe("ok");
    expect(mapping.dataRows).toBe(5);
    expect(mapping.skipped).toBe(3);
    expect(mapping.rows.map((row) => row.phone)).toEqual(["998901234567", "79123456789"]);
  });

  it("does not count fully empty rows", () => {
    const mapping = mapSheetRows(
      [["Имя", "Телефон"], ["", ""], ["Test", "998901234567"], [], ["  ", " "], [""]],
      null
    );

    expect(mapping.dataRows).toBe(1);
    expect(mapping.skipped).toBe(0);
    expect(mapping.rows).toHaveLength(1);
  });

  it("reads a row shorter than the header with the missing cells as empty", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Имя", "Город"],
        ["998901234567"],
        ["Только имя"],
      ],
      null
    );

    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: null, extra: {} }]);
    expect(mapping.dataRows).toBe(2);
    expect(mapping.skipped).toBe(1);
  });

  it("ignores cells to the right of the header", () => {
    const mapping = mapSheetRows([["Телефон"], ["998901234567", "лишняя ячейка"]], null);

    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: null, extra: {} }]);
  });

  it("trims cells and omits empty extra values", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Имя", "Город", "Комментарий"],
        [" 998901234567 ", "  Test  ", "   ", " звонить утром "],
      ],
      null
    );

    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: "Test", extra: { Комментарий: "звонить утром" } }]);
  });

  it("cuts an extra value to 500 characters", () => {
    const mapping = mapSheetRows([["Телефон", "Комментарий"], ["998901234567", "я".repeat(501)]], null);

    expect(mapping.rows[0].extra).toEqual({ Комментарий: "я".repeat(500) });
  });

  it("keeps only the first 40 non-empty extra columns", () => {
    const headers = Array.from({ length: 45 }, (_, i) => `Колонка ${i + 1}`);
    // Columns 1 and 2 are empty in this row: 43 values are left, the first 40 of them are columns 3–42.
    const values = headers.map((_, i) => (i < 2 ? "" : `v${i + 1}`));
    const mapping = mapSheetRows([["Телефон", ...headers], ["998901234567", ...values]], null);

    const keys = Object.keys(mapping.rows[0].extra);
    expect(keys).toHaveLength(40);
    expect(keys[0]).toBe("Колонка 3");
    expect(keys[39]).toBe("Колонка 42");
    expect(mapping.rows[0].extra["Колонка 42"]).toBe("v42");
  });

  it("cuts a name to 200 characters and reads an empty name as null", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Имя"],
        ["998901234567", "а".repeat(201)],
        ["998935556677", "   "],
      ],
      null
    );

    expect(mapping.rows[0].fullName).toBe("а".repeat(200));
    expect(mapping.rows[1].fullName).toBeNull();
  });

  it("does not cut through a surrogate pair", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Имя", "Комментарий"],
        ["998901234567", `${"a".repeat(199)}😀`, `${"b".repeat(499)}😀`],
      ],
      null
    );

    expect(mapping.rows[0].fullName).toBe("a".repeat(199));
    expect(mapping.rows[0].extra).toEqual({ Комментарий: "b".repeat(499) });
    // A lone surrogate becomes an escape that PostgreSQL does not accept in jsonb.
    expect(JSON.stringify(mapping.rows)).not.toContain("\\ud83d");
  });

  it("removes NUL characters, which PostgreSQL does not store", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Имя", "Го\u0000род"],
        ["998901234567", "Te\u0000st", "Таш\u0000кент"],
      ],
      null
    );

    expect(mapping.rows).toEqual([{ phone: "998901234567", fullName: "Test", extra: { Город: "Ташкент" } }]);
  });

  it("does not use an empty header cell as an extra key", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "", "  ", "Город"],
        ["998901234567", "без заголовка", "тоже", "Ташкент"],
      ],
      null
    );

    expect(mapping.headers).toEqual(["Телефон", "Город"]);
    expect(mapping.rows[0].extra).toEqual({ Город: "Ташкент" });
  });

  it("takes the first of two columns with the same header", () => {
    const mapping = mapSheetRows(
      [
        ["Телефон", "Город", "Имя", "Город", "Телефон", "Имя"],
        ["998901234567", "Ташкент", "Первое", "Самарканд", "998935556677", "Второе"],
        ["998971112233", "", "Третье", "Бухара", "", ""],
      ],
      null
    );

    expect(mapping.headers).toEqual(["Телефон", "Город", "Имя"]);
    expect(mapping.detected).toEqual({ phone: "Телефон", name: "Имя" });
    expect(mapping.rows).toEqual([
      { phone: "998901234567", fullName: "Первое", extra: { Город: "Ташкент" } },
      { phone: "998971112233", fullName: "Третье", extra: {} }, // the second "Город" is not a fallback
    ]);
  });

  it("cuts an extra key to 100 characters", () => {
    const mapping = mapSheetRows([["Телефон", "к".repeat(150)], ["998901234567", "значение"]], null);

    expect(mapping.rows[0].extra).toEqual({ ["к".repeat(100)]: "значение" });
  });

  it("returns the same phone twice when the sheet repeats it", () => {
    const mapping = mapSheetRows([["Телефон"], ["+998 90 123-45-67"], ["998901234567"]], null);

    expect(mapping.rows.map((row) => row.phone)).toEqual(["998901234567", "998901234567"]);
    expect(mapping.dataRows).toBe(2);
  });

  it("does not change the table it reads", () => {
    const table = [
      [" Телефон ", "Имя"],
      [" 998901234567 ", " Test "],
    ];
    const copy = JSON.parse(JSON.stringify(table));

    mapSheetRows(table, null);

    expect(table).toEqual(copy);
  });
});
