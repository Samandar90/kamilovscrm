import type { QueueDisplayState } from "./queueTypes";

export type QueueDisplayErrorKind = "not_found" | "inactive" | "network";

export class QueueDisplayError extends Error {
  constructor(public readonly kind: QueueDisplayErrorKind, message: string) {
    super(message);
    this.name = "QueueDisplayError";
  }
}

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/**
 * Public TV endpoint. Deliberately NOT `requestJson`: that helper attaches any stored staff token and
 * redirects to /login on 401. A bare GET without custom headers is also a CORS "simple request" (no preflight).
 * 404 → not_found (unknown or deleted screen), 403 → inactive (clinic subscription), anything else → network.
 * An aborted request rejects with the original AbortError so pollers can tell it apart from a failure.
 */
export async function fetchQueueDisplayState(code: string, signal?: AbortSignal): Promise<QueueDisplayState> {
  // Read at call time (not module load) so tests can vi.stubEnv without re-importing the module.
  const url = `${import.meta.env.VITE_API_URL}/api/public/queue-display/${encodeURIComponent(code)}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new QueueDisplayError("network", "Нет связи с сервером");
  }
  if (response.status === 404) throw new QueueDisplayError("not_found", "Экран не найден");
  if (response.status === 403) throw new QueueDisplayError("inactive", "Подписка клиники неактивна");
  if (!response.ok) throw new QueueDisplayError("network", `Сервер ответил ${response.status}`);
  try {
    return (await response.json()) as QueueDisplayState;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new QueueDisplayError("network", "Некорректный ответ сервера");
  }
}
