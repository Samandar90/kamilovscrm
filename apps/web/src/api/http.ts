/** Must match services/api PORT (see env.ts default 4000 and .env). */
const API_BASE = import.meta.env.VITE_API_URL;

if (!API_BASE) {
  throw new Error("VITE_API_URL is not defined");
}
const TOKEN_KEY = "crm_access_token";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
};

type ErrorBody = {
  error?: string;
  message?: string;
};

const readErrorMessage = (payload: unknown, status: number, t?: (key: string) => string): string => {
  if (payload && typeof payload === "object") {
    const p = payload as ErrorBody;
    if (typeof p.error === "string" && p.error.trim()) return p.error;
    if (typeof p.message === "string" && p.message.trim()) return p.message;
  }
  // Fallback to translation keys if t is not provided (during module initialization)
  if (!t) {
    if (status === 403) return "http.forbidden";
    if (status === 404) return "http.notFound";
    if (status >= 500) return "http.serverError";
    return "http.requestError";
  }
  if (status === 403) return t("http.forbidden");
  if (status === 404) return t("http.notFound");
  if (status >= 500) return t("http.serverError");
  return t("http.requestError");
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

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = {};
  if (contentType.includes("application/json")) {
    payload = (await response.json().catch(() => ({}))) as unknown;
  } else if (!response.ok) {
    const text = await response.text().catch(() => "");
    payload = text ? { error: text.slice(0, 200) } : {};
  }

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    throw new Error(readErrorMessage(payload, response.status));
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
    throw new Error(readErrorMessage(payload, response.status));
  }

  return payload as T;
};
