import { isIP } from "node:net";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

/**
 * Лимит публичного ТВ-эндпоинта: 300 запросов в минуту на IP (ТВ опрашивает раз в 2 с = 30/мин).
 * trust proxy в app.ts не включён, поэтому req.ip на Render — адрес внутреннего прокси, общий для всех.
 * Реальный IP клиента берём из CF-Connecting-IP (Render стоит за Cloudflare), если это валидный IP;
 * иначе — req.ip. ipKeyGenerator сворачивает IPv6 в подсеть /56 (так требует express-rate-limit v8).
 */
export const publicQueueDisplayRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Повторите позже." },
  keyGenerator: (request) => {
    const cf = request.headers["cf-connecting-ip"];
    const ip = typeof cf === "string" && isIP(cf) ? cf : request.ip ?? "";
    return ipKeyGenerator(ip);
  },
});
