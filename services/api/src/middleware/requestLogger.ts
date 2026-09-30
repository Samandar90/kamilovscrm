import type { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import { env } from "../config/env";

/** Опрос ТВ-экрана очереди: всё после этого префикса — секретный код экрана. Express сравнивает пути без учёта регистра. */
const QUEUE_DISPLAY_URL = /^\/api\/public\/queue-display\//i;
/** Опрос страницы «Очередь» сотрудниками (каждые 5 с). */
const QUEUE_TODAY_PATH = "/api/queue/today";

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

/** URL для лога: код ТВ-экрана и всё после него → "***"; остальные URL без изменений. */
export function redactLoggedUrl(originalUrl: string): string {
  const prefix = QUEUE_DISPLAY_URL.exec(originalUrl);
  return prefix ? `${prefix[0]}***` : originalUrl;
}

// morgan.token с именем существующего токена заменяет его (README morgan). Форматы "tiny"/"dev" прежние,
// и для всех маршрутов, кроме ТВ-экрана, строка лога та же байт в байт (req.originalUrl || req.url, как в morgan).
morgan.token<Request, Response>("url", (req) => redactLoggedUrl(req.originalUrl || req.url));

/** Dev: цветной; production: компактная строка без лишнего шума. Успешные опросы очереди не логируются. */
export const requestLogger = morgan<Request, Response>(env.isProduction ? "tiny" : "dev", {
  skip: (req, res) => shouldSkipRequestLog(req.method, req.originalUrl, res.statusCode),
});

export const requestId = (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
