/** Национальный номер Узбекистана: код оператора (20, 33, 50–99) и 7 цифр. */
const UZ_NATIONAL_RE = /^(?:20|33|[5-9]\d)\d{7}$/;

/** Короткая метка перед номером, как `p:` в выгрузке рекламных форм. */
const LABEL_RE = /^[A-Za-z]{1,2}:/;

/** Цифры, один ведущий `+`, пробелы, скобки, точки и дефисы. Запись вида `9.98E+11` не проходит. */
const PHONE_TEXT_RE = /^\+?[\d\s().-]+$/;

/**
 * Дробное число, записанное текстом (`901234567.5`, `-901234567.5`, `(901234567.5)`): цифры, одна точка или запятая, цифры.
 * Номер с точками-разделителями (`90.123.45.67`) сюда не попадает.
 */
const DECIMAL_TEXT_RE = /^[+\-(]?\d+[.,]\d+\)?$/;

/**
 * Телефон из ячейки таблицы: только цифры, 10–15 штук, или null, если позвонить по значению нельзя.
 * Узбекский номер приводится к 12 цифрам с кодом 998 (`+998 90 123-45-67` и `901234567` дают одно значение),
 * иностранный остаётся как есть. Число принимается только безопасным целым: дробь и число, потерявшее
 * цифры, — не телефон.
 */
export function canonicalizePhone(value: unknown): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value;
  } else {
    return null;
  }

  // После апострофа и после метки может стоять пробел: `p: +998…`.
  text = text.trim().replace(/\u00a0/g, "").replace(/^'/, "").trim().replace(LABEL_RE, "").trim();
  if (!PHONE_TEXT_RE.test(text) || DECIMAL_TEXT_RE.test(text)) return null;

  const digits = text.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 12 && digits.startsWith("998")) {
    return UZ_NATIONAL_RE.test(digits.slice(3)) ? digits : null;
  }
  if (UZ_NATIONAL_RE.test(digits)) return `998${digits}`;
  // Начинается с 998, но не 12 цифр: обрезанный или склеенный узбекский номер, а не иностранный.
  if (digits.startsWith("998")) return null;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
