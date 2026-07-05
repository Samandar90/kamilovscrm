import { sanitizeNumericString } from "./sanitizeNumericString";

export function normalizeMoneyInput(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return null;
  }
  const str = sanitizeNumericString(String(value));
  if (str === "" || str === "-" || str === "." || str === "-.") {
    return null;
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

export function normalizeNumberInput(value: unknown): number | null {
  return normalizeMoneyInput(value);
}

export function normalizeRequiredMoneyInput(value: unknown, fieldName = "money.amount"): number {
  const n = normalizeMoneyInput(value);
  if (n === null) {
    throw new Error(`money.invalidField: ${fieldName}`);
  }
  return n;
}

/** Число для расчётов из каталога услуг (`number` или отформатированная строка). */
export function coercePriceToNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const n = normalizeMoneyInput(value);
  return n ?? 0;
}

/** Жёсткая очистка строки суммы перед JSON (POST /api/invoices). */
export function cleanMoney(value: unknown): number {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/\s/g, "").replace(/[^\d.-]/g, ""));
}
