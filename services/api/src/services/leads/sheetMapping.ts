import type { LeadColumnMap } from "../../repositories/interfaces/leadTypes";
import { canonicalizePhone } from "../../utils/phone";

/** Headers chosen by the superadmin: the type lives with the other contract types and is re-exported here. */
export type { LeadColumnMap };

export type LeadRowInput = { phone: string; fullName: string | null; extra: Record<string, string> };

export type SheetMapping = {
  status: "ok" | "empty" | "columns_not_found";
  /** Non-empty cells of the header row, trimmed, each text once. */
  headers: string[];
  detected: { phone: string | null; name: string | null };
  /** Only rows with a usable phone. */
  rows: LeadRowInput[];
  /** Non-empty rows below the header. */
  dataRows: number;
  /** Data rows without a usable phone. */
  skipped: number;
};

/** Normalised headers of the phone column, the more exact first: "Телефон" wins over "Номер" in one row. */
const PHONE_HEADERS = [
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
];

const NAME_HEADERS = [
  "имя",
  "фио",
  "имяифамилия",
  "клиент",
  "имяклиента",
  "полноеимя",
  "name",
  "fullname",
  "firstname",
  "ism",
  "ismfamiliya",
  "ismi",
  "fio",
  "mijoz",
];

/** The header row is looked for in this many first rows: a sheet may start with a title. */
const HEADER_SEARCH_ROWS = 10;
const MAX_NAME_LENGTH = 200;
const MAX_EXTRA_COLUMNS = 40;
const MAX_EXTRA_KEY_LENGTH = 100;
const MAX_EXTRA_VALUE_LENGTH = 500;

/** Cell text as stored: trimmed, without NUL (PostgreSQL keeps it neither in text nor in jsonb). */
const cellText = (value: string | undefined): string => (value ?? "").replace(/\u0000/g, "").trim();

/** "Номер телефона:", "phone_number", "Phone Number" → one spelling: lower case, no spaces, `_`, `-`, `.`, `:`. */
const normalizeHeader = (text: string): string => text.toLowerCase().replace(/[\s_\-.:]/g, "");

/** Cuts to `max` UTF-16 units; half of a surrogate pair is not left at the cut (jsonb rejects a lone surrogate). */
const cut = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
};

const isEmptyRow = (row: string[]): boolean => row.every((cell) => cellText(cell) === "");

/** Header texts for the column picker. */
const headerTexts = (row: string[]): string[] => Array.from(new Set(row.map(cellText).filter((text) => text !== "")));

/** Index of the first column whose normalised header is `target`; an empty target matches nothing. */
const columnOf = (normalized: string[], target: string, except = -1): number =>
  target === "" ? -1 : normalized.findIndex((header, index) => index !== except && header === target);

const firstColumnOf = (normalized: string[], targets: string[], except = -1): number => {
  for (const target of targets) {
    const index = columnOf(normalized, target, except);
    if (index >= 0) return index;
  }
  return -1;
};

/**
 * Parsed sheet → lead rows. The header row is the first of the first 10 rows that has the phone header:
 * the one from `columnMap`, or a known synonym when there is no map. With a map only its headers are used,
 * and a missing one means `columns_not_found` and no rows: moved columns must not put phones into names.
 * The other columns with a header go to `extra` as {header: text}: at most 40 non-empty per row, values up
 * to 500 characters. A row without a usable phone is counted in `skipped`, not returned.
 */
export function mapSheetRows(table: string[][], columnMap: LeadColumnMap | null): SheetMapping {
  const firstRow = table.findIndex((row) => !isEmptyRow(row));
  if (firstRow < 0) {
    return { status: "empty", headers: [], detected: { phone: null, name: null }, rows: [], dataRows: 0, skipped: 0 };
  }
  const notFound = (headerRow: string[], phone: string | null): SheetMapping => ({
    status: "columns_not_found",
    headers: headerTexts(headerRow),
    detected: { phone, name: null },
    rows: [],
    dataRows: 0,
    skipped: 0,
  });

  let headerIndex = -1;
  let normalized: string[] = [];
  let phoneColumn = -1;
  for (let i = firstRow; i < Math.min(table.length, HEADER_SEARCH_ROWS) && phoneColumn < 0; i += 1) {
    normalized = table[i].map((cell) => normalizeHeader(cellText(cell)));
    phoneColumn = columnMap
      ? columnOf(normalized, normalizeHeader(columnMap.phone))
      : firstColumnOf(normalized, PHONE_HEADERS);
    headerIndex = i;
  }
  if (phoneColumn < 0) return notFound(table[firstRow], null);

  const header = table[headerIndex].map(cellText);
  let nameColumn = -1;
  if (!columnMap) {
    nameColumn = firstColumnOf(normalized, NAME_HEADERS, phoneColumn);
  } else if (columnMap.name !== null) {
    nameColumn = columnOf(normalized, normalizeHeader(columnMap.name), phoneColumn);
    if (nameColumn < 0) return notFound(table[headerIndex], header[phoneColumn]);
  }

  // Of two columns with one header the first is used; the phone and the name columns are not repeated in extra.
  const usedKeys = new Set<string>();
  const extraColumns: Array<{ index: number; key: string }> = [];
  for (const index of [phoneColumn, nameColumn, ...header.keys()]) {
    const key = index >= 0 ? cut(header[index], MAX_EXTRA_KEY_LENGTH) : "";
    if (key === "" || usedKeys.has(key)) continue;
    usedKeys.add(key);
    if (index !== phoneColumn && index !== nameColumn) extraColumns.push({ index, key });
  }

  const rows: LeadRowInput[] = [];
  let dataRows = 0;
  let skipped = 0;
  for (let i = headerIndex + 1; i < table.length; i += 1) {
    const row = table[i];
    if (isEmptyRow(row)) continue;
    dataRows += 1;

    const phone = canonicalizePhone(cellText(row[phoneColumn]));
    if (phone === null) {
      skipped += 1;
      continue;
    }
    const fullName = nameColumn >= 0 ? cut(cellText(row[nameColumn]), MAX_NAME_LENGTH) || null : null;
    const extra: Record<string, string> = {};
    let extraCount = 0;
    for (const column of extraColumns) {
      if (extraCount === MAX_EXTRA_COLUMNS) break;
      const value = cut(cellText(row[column.index]), MAX_EXTRA_VALUE_LENGTH);
      if (value === "") continue;
      extra[column.key] = value;
      extraCount += 1;
    }
    rows.push({ phone, fullName, extra });
  }

  return {
    status: "ok",
    headers: headerTexts(table[headerIndex]),
    detected: { phone: header[phoneColumn], name: nameColumn >= 0 ? header[nameColumn] : null },
    rows,
    dataRows,
    skipped,
  };
}
