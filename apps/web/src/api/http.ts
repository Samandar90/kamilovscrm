import i18n from "../i18n";

/** Must match services/api PORT (see env.ts default 4000 and .env). */
const API_BASE = import.meta.env.VITE_API_URL;

if (!API_BASE) {
  throw new Error("VITE_API_URL is not defined");
}
const TOKEN_KEY = "crm_access_token";

/** Preserve definitive server rejections so callers can distinguish them from an unknown network outcome. */
export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
  /** An answer that is computed for a long time (AI): wait up to a minute and never send the request twice. */
  slow?: boolean;
};

/**
 * Time limit of each attempt of a read. On the clinic's link a request is sometimes lost on the way and never
 * answered, so a read that hangs is cut off and sent again. The limits grow: a slow answer still gets through.
 */
const READ_ATTEMPT_TIMEOUTS_MS = [5000, 10000, 20000];
/** Pause before the second and the third attempt of a read. */
const READ_RETRY_DELAYS_MS = [300, 1000];
/** A write and a slow read are sent once: they only stop waiting. */
const SINGLE_ATTEMPT_TIMEOUT_MS = 60000;
/** Gateway answers while the API restarts. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

type ErrorBody = {
  error?: string;
  message?: string;
};

const readErrorMessage = (payload: unknown, status: number): string => {
  if (payload && typeof payload === "object") {
    const p = payload as ErrorBody;
    if (typeof p.error === "string" && p.error.trim()) return p.error;
    if (typeof p.message === "string" && p.message.trim()) return p.message;
  }
  if (status === 403) return i18n.t("http.forbidden");
  if (status === 404) return i18n.t("http.notFound");
  if (status >= 500) return i18n.t("http.serverError");
  return i18n.t("http.requestError");
};

export const requestJson = async <T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const tokenFromStorage =
    typeof window !== "undefined"
      ? window.localStorage.getItem(TOKEN_KEY) ?? window.sessionStorage.getItem(TOKEN_KEY)
      : null;
  const authToken = options.token ?? tokenFromStorage;

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const method = options.method ?? "GET";
  // Only a read may be sent again: after a write the server may have applied it even though no answer came back.
  const repeatable = method === "GET" && !options.slow;
  const timeouts = repeatable ? READ_ATTEMPT_TIMEOUTS_MS : [SINGLE_ATTEMPT_TIMEOUT_MS];
  const caller = options.signal;

  let answer: { response: Response; payload: unknown } | undefined;
  for (let attempt = 0; attempt < timeouts.length && !answer; attempt += 1) {
    if (caller?.aborted) throw abortError(caller);
    const lastAttempt = attempt === timeouts.length - 1;
    // The time limit covers the body too: an answer can stall halfway through.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    caller?.addEventListener("abort", cancel);
    const timer = setTimeout(cancel, timeouts[attempt]);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const keepAbort = <T>(fallback: T) => (error: unknown): T => {
        if (controller.signal.aborted) throw error;
        return fallback;
      };
      const contentType = response.headers.get("content-type") ?? "";
      let payload: unknown = {};
      if (contentType.includes("application/json")) {
        payload = (await response.json().catch(keepAbort({}))) as unknown;
      } else if (!response.ok) {
        const text = await response.text().catch(keepAbort(""));
        payload = text ? { error: text.slice(0, 200) } : {};
      }
      if (lastAttempt || !GATEWAY_STATUSES.has(response.status)) {
        answer = { response, payload };
      }
    } catch (error) {
      // Cancelled by the caller: not a failure, and nothing to repeat.
      if (caller?.aborted) throw error;
      if (lastAttempt) {
        // Not an HttpError: the outcome is unknown, the server did not reject anything.
        throw new Error(i18n.t(method === "GET" ? "http.networkError" : "http.writeUnknown"));
      }
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
    if (!answer) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAYS_MS[attempt]));
    }
  }
  if (!answer) throw new Error(i18n.t("http.networkError"));
  const { response, payload } = answer;

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    throw new HttpError(readErrorMessage(payload, response.status), response.status);
  }

  // 402 = subscription expired/suspended: SubscriptionNotice shows blocking screen.
  if (response.status === 402 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("sazion:payment-required", {
        detail: readErrorMessage(payload, response.status),
      })
    );
  }

  if (!response.ok) {
    throw new HttpError(readErrorMessage(payload, response.status), response.status);
  }

  return payload as T;
};
