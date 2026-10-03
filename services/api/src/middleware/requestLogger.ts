import type { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import { env } from "../config/env";

/** Опрос ТВ-экрана очереди: всё после этого префикса — секретный код экрана. Express сравнивает пути без учёта регистра. */
const QUEUE_DISPLAY_URL = /^\/api\/public\/queue-display\//i;
/** Опрос страницы «Очередь» сотрудниками (каждые 5 с). */
const QUEUE_TODAY_PATH = "/api/queue/today";
/**
 * Параметр search — свободный текст поиска (ФИО, телефон): /api/patients, /api/users, /api/questionnaires,
 * /api/call-center/workspace. Express (qs) читает как search и имена search[], search[0], [search].
 */
const SEARCH_PARAM_NAME = /^\[?search(?:[[\]]|$)/;
/** Пара «имя=значение» в строке запроса; значение непустое. */
const QUERY_PAIR = /(^|&)([^&=]*)=[^&]+/g;

/**
 * true — строку в лог не пишем: успешный (status < 400) GET-опрос очереди. ТВ опрашивает каждые 2 с
 * (≈ 43 тыс. строк в сутки на экран, и в URL — код экрана), страница «Очередь» — каждые 5 с. Ошибки пишутся всегда.
 */
export function shouldSkipRequestLog(method: string, originalUrl: string, statusCode: number): boolean {
  if (method !== "GET" || statusCode >= 400) {
    return false;
  }
  const path = originalUrl.split("?")[0];
  return QUEUE_DISPLAY_URL.test(path) || path.toLowerCase() === QUEUE_TODAY_PATH;
}

/** true — Express прочитает параметр с таким именем как search. Имя приходит %-кодированным (search%5B%5D). */
function isSearchParam(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    // Битое %-кодирование: Express тоже берёт имя как есть.
  }
  return SEARCH_PARAM_NAME.test(name);
}

/**
 * URL для лога: код ТВ-экрана и всё после него → "***"; значение параметра search → "***" (путь и остальные
 * параметры остаются); прочие URL без изменений.
 */
export function redactLoggedUrl(originalUrl: string): string {
  const prefix = QUEUE_DISPLAY_URL.exec(originalUrl);
  if (prefix) {
    return `${prefix[0]}***`;
  }
  const queryStart = originalUrl.indexOf("?") + 1;
  if (queryStart === 0) {
    return originalUrl;
  }
  const query = originalUrl
    .slice(queryStart)
    .replace(QUERY_PAIR, (pair, separator: string, name: string) => (isSearchParam(name) ? `${separator}${name}=***` : pair));
  return originalUrl.slice(0, queryStart) + query;
}

// morgan.token с именем существующего токена заменяет его (README morgan). Форматы "tiny"/"dev" прежние,
// и, кроме кода ТВ-экрана и текста поиска, строка лога та же байт в байт (req.originalUrl || req.url, как в morgan).
morgan.token<Request, Response>("url", (req) => redactLoggedUrl(req.originalUrl || req.url));

/** Dev: цветной; production: компактная строка без лишнего шума. Успешные опросы очереди не логируются. */
export const requestLogger = morgan<Request, Response>(env.isProduction ? "tiny" : "dev", {
  skip: (req, res) => shouldSkipRequestLog(req.method, req.originalUrl, res.statusCode),
});

export const requestId = (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
