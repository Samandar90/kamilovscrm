import https from "https";
import { env } from "../../config/env";

/**
 * Минимальный клиент Eskiz.uz (notify.eskiz.uz).
 * Токен живёт ~30 дней — кэшируем в памяти, при 401 перелогиниваемся один раз.
 * HTTP — на node:https, чтобы не зависеть от версии Node (fetch) и внешних пакетов.
 */

const HOST = "notify.eskiz.uz";

type HttpResult = { status: number; body: string };

const postForm = (
  path: string,
  fields: Record<string, string>,
  bearer?: string
): Promise<HttpResult> =>
  new Promise((resolve, reject) => {
    const payload = new URLSearchParams(fields).toString();
    const req = https.request(
      {
        host: HOST,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        timeout: 20_000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Eskiz request timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

let cachedToken: string | null = null;

const login = async (): Promise<string> => {
  const r = await postForm("/api/auth/login", {
    email: env.eskizEmail,
    password: env.eskizPassword,
  });
  if (r.status !== 200) {
    throw new Error(`Eskiz login failed (${r.status}): ${r.body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(r.body) as { data?: { token?: string } };
  const token = parsed.data?.token;
  if (!token) {
    throw new Error("Eskiz login: token missing in response");
  }
  cachedToken = token;
  return token;
};

/** 998XXXXXXXXX из любого написания; null если не узбекский мобильный. */
export const normalizeUzPhone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^998\d{9}$/.test(digits)) return digits;
  if (/^\d{9}$/.test(digits)) return `998${digits}`;
  return null;
};

export type SmsSendResult = { ok: true; providerId: string | null } | { ok: false; error: string };

export const sendSms = async (phone: string, message: string): Promise<SmsSendResult> => {
  try {
    let token = cachedToken ?? (await login());
    let r = await postForm(
      "/api/message/sms/send",
      { mobile_phone: phone, message, from: env.smsFrom },
      token
    );
    if (r.status === 401) {
      token = await login();
      r = await postForm(
        "/api/message/sms/send",
        { mobile_phone: phone, message, from: env.smsFrom },
        token
      );
    }
    if (r.status !== 200) {
      return { ok: false, error: `Eskiz send failed (${r.status}): ${r.body.slice(0, 200)}` };
    }
    const parsed = JSON.parse(r.body) as { id?: string | number; message?: string };
    return { ok: true, providerId: parsed.id != null ? String(parsed.id) : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
