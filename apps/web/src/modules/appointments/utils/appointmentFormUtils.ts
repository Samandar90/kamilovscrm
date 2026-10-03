/** Shared helpers for appointment create forms (frontend only). */

export const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * Значение из поля даты: `YYYY-MM-DD` (native input[type=date]) или `DD.MM.YYYY` (ручной ввод / локаль).
 * Возвращает канонический `YYYY-MM-DD` для API и для `buildLocalDateTimeString`.
 */
export function uiDateToYmd(datePart: string): string | null {
  const t = datePart.trim();
  if (t === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return t;
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export const buildLocalDateTimeString = (
  datePart: string,
  timePart: string
): string | null => {
  const normalizedTime = timePart.length === 5 ? `${timePart}:00` : timePart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return null;
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(normalizedTime)) {
    return null;
  }

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = normalizedTime.split(":").map(Number);
  const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(
    second
  )}`;
};

/**
 * Строка для POST `/api/appointments`: всегда `YYYY-MM-DD HH:mm:ss` (как ожидает backend).
 * Дата может быть в UI как DD.MM.YYYY — она приводится к YYYY-MM-DD; время — `HH:mm` или `HH:mm:ss`.
 */
export function normalizeDateTimeForApi(date: string, time: string): string | null {
  const timeTrim = time.trim();
  if (!date.trim() || !timeTrim) return null;
  const ymd = uiDateToYmd(date);
  if (!ymd) return null;
  return buildLocalDateTimeString(ymd, timeTrim);
}

/** Local calendar day of a date as `YYYY-MM-DD`. */
export function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayYmd(): string {
  return dateToYmd(new Date());
}

/** `YYYY-MM-DD` moved by whole days; month and year ends roll over. */
export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return dateToYmd(new Date(year, month - 1, day + days));
}

/** Next 15-minute slot from now (for quick entry default). */
export function nextQuarterHourTimeHm(): string {
  const d = new Date();
  const total = d.getHours() * 60 + d.getMinutes();
  const next = Math.ceil((total + 1) / 15) * 15;
  const h = Math.floor(next / 60) % 24;
  const m = next % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
