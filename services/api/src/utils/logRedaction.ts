import { env } from "../config/env";

/**
 * Класс 42 SQLSTATE (нет колонки или таблицы, не сошлись типы) — ошибка в самом запросе:
 * в её тексте имена объектов схемы. У остальных классов в тексте бывают значения
 * (22P02: `invalid input syntax for type integer: "…"`).
 */
const SCHEMA_ERROR_CLASS = "42";

const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Строки стека «at …». Стек начинается с message, а в message из нескольких строк одна может
 * начинаться с «at»: кадры — то, что идёт после message. Если message в стеке нет, кадров нет.
 */
const stackFrames = (err: Record<string, unknown>): string[] | undefined => {
  if (typeof err.stack !== "string") return undefined;
  const message = typeof err.message === "string" ? err.message : "";
  const start = err.stack.indexOf(message);
  if (start === -1) return undefined;
  const frames = err.stack
    .slice(start + message.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
  return frames.length > 0 ? frames : undefined;
};

/**
 * Ошибка для console.error: только то, в чём нет данных из базы и из запроса — имя, код, имена
 * ограничения, таблицы и колонки, функция PostgreSQL, стек. `detail` и `where` ошибок PostgreSQL
 * не пишутся (в них значения полей: `Key (phone)=(…)`, `Failing row contains (…)`), `message` —
 * только у ошибок схемы. У остальных ошибок message — текст из кода, он остаётся.
 * Саму ошибку, со всеми полями, возвращает только при env.debugErrorDetails (DEBUG_ERROR_DETAILS=1, не production).
 */
export function errorForLog(err: unknown): unknown {
  if (env.debugErrorDetails) return err;
  if (!err || typeof err !== "object") return { thrown: typeof err };

  const e = err as Record<string, unknown>;
  // Код SQLSTATE из пяти символов — признак ошибки PostgreSQL, как в errorHandler.
  const sqlState = typeof e.code === "string" && e.code.length === 5 ? e.code : undefined;
  const logged = {
    name: str(e.name),
    message: sqlState === undefined || sqlState.startsWith(SCHEMA_ERROR_CLASS) ? str(e.message) : undefined,
    code: str(e.code),
    status: typeof e.status === "number" ? e.status : undefined,
    ...(sqlState !== undefined
      ? { constraint: str(e.constraint), table: str(e.table), column: str(e.column), routine: str(e.routine) }
      : {}),
    stack: stackFrames(e),
  };
  return Object.fromEntries(Object.entries(logged).filter(([, value]) => value !== undefined));
}

/**
 * Текст пользователя или ИИ для лога: всегда длина, сам текст — только при env.debugAiText
 * (DEBUG_AI_TEXT=1, не production).
 */
export function textForLog(text: string): { len: number; text?: string } {
  return env.debugAiText ? { len: text.length, text } : { len: text.length };
}
