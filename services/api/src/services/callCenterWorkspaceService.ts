import { ApiError } from "../middleware/errorHandler";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import type { ICallCenterWorkspaceRepository } from "../repositories/interfaces/ICallCenterWorkspaceRepository";
import { WORKSPACE_CAMPAIGNS, WORKSPACE_OUTCOMES } from "../repositories/interfaces/callCenterWorkspaceTypes";
import type { WorkspaceCampaign, WorkspaceFilters, WorkspaceOutcome, WorkspaceSettings } from "../repositories/interfaces/callCenterWorkspaceTypes";

type Body = Record<string, unknown>;
const integer = (value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER): number => {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") throw new ApiError(400, `${field}: требуется число`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new ApiError(400, `${field}: допустимо целое число от ${min} до ${max}`);
  return result;
};
const admin = (auth: AuthTokenPayload) => {
  if (auth.role !== "superadmin") throw new ApiError(403, "Настройки и назначение операторов доступны только супер-админу");
};
const worker = (auth: AuthTokenPayload) => {
  if (auth.role !== "operator" && auth.role !== "superadmin") throw new ApiError(403, "Нет доступа к колл-центру");
};

export function parseWorkspaceSettings(raw: unknown): WorkspaceSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "Требуются настройки");
  const body = raw as Body;
  for (const field of ["recallEnabled", "followupEnabled", "reminderEnabled"])
    if (typeof body[field] !== "boolean") throw new ApiError(400, `${field}: требуется boolean`);
  for (const field of ["workStart", "workEnd"])
    if (typeof body[field] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field] as string)) throw new ApiError(400, `${field}: требуется HH:mm`);
  if ((body.workStart as string) >= (body.workEnd as string)) throw new ApiError(400, "Начало рабочего дня должно быть раньше окончания");
  if (typeof body.script !== "string" || body.script.length > 4000) throw new ApiError(400, "Скрипт должен быть не длиннее 4000 символов");
  return {
    recallEnabled: body.recallEnabled as boolean, recallDays: integer(body.recallDays, "recallDays", 1, 3650),
    followupEnabled: body.followupEnabled as boolean, followupDays: integer(body.followupDays, "followupDays", 1, 365),
    reminderEnabled: body.reminderEnabled as boolean, reminderDays: integer(body.reminderDays, "reminderDays", 0, 365),
    workStart: body.workStart as string, workEnd: body.workEnd as string,
    retryMinutes: integer(body.retryMinutes, "retryMinutes", 5, 10080), maxAttempts: integer(body.maxAttempts, "maxAttempts", 1, 20), script: body.script,
  };
}

/** Retries are real instants; the work window is interpreted in the clinic reporting timezone. */
export function nextRetryAt(now: Date, settings: WorkspaceSettings, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const wallMillis = (date: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  const retry = new Date(now.getTime() + settings.retryMinutes * 60000);
  const wall = new Date(wallMillis(retry));
  const minutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  const [startHour, startMinute] = settings.workStart.split(":").map(Number);
  const [endHour, endMinute] = settings.workEnd.split(":").map(Number);
  if (minutes >= startHour * 60 + startMinute && minutes < endHour * 60 + endMinute) return retry.toISOString();
  if (minutes >= endHour * 60 + endMinute) wall.setUTCDate(wall.getUTCDate() + 1);
  wall.setUTCHours(startHour, startMinute, 0, 0);
  let instant = wall.getTime();
  for (let i = 0; i < 3; i++) instant += wall.getTime() - wallMillis(new Date(instant));
  return new Date(instant).toISOString();
}

export class CallCenterWorkspaceService {
  constructor(private readonly repository: ICallCenterWorkspaceRepository) {}
  async getSettings(auth: AuthTokenPayload) { worker(auth); return this.repository.getSettings(); }
  async saveSettings(auth: AuthTokenPayload, body: unknown) { admin(auth); return this.repository.saveSettings(parseWorkspaceSettings(body)); }
  async preview(auth: AuthTokenPayload, body: unknown) { admin(auth); return this.repository.preview(parseWorkspaceSettings(body)); }
  async workspace(auth: AuthTokenPayload, query: Body) {
    worker(auth);
    const segment = String(query.segment ?? "base");
    if (![...WORKSPACE_CAMPAIGNS, "callbacks"].includes(segment)) throw new ApiError(400, "Неизвестный сегмент");
    const status = String(query.status ?? "all");
    if (!["all", "new", "callback", "overdue", "done"].includes(status)) throw new ApiError(400, "Неизвестный статус");
    const search = String(query.search ?? "").trim();
    if (search.length > 200) throw new ApiError(400, "Поиск не длиннее 200 символов");
    return this.repository.workspace({
      segment: segment as WorkspaceFilters["segment"], status: status as WorkspaceFilters["status"], search,
      page: query.page == null ? 1 : integer(query.page, "page", 1, 1000000),
      doctorId: query.doctorId == null || query.doctorId === "" ? null : integer(query.doctorId, "doctorId"),
      operatorId: query.operatorId == null || query.operatorId === "" ? null : integer(query.operatorId, "operatorId"),
    });
  }
  async history(auth: AuthTokenPayload, query: Body) {
    worker(auth);
    return this.repository.history(query.patientId == null ? null : integer(query.patientId, "patientId"), query.page == null ? 1 : integer(query.page, "page", 1, 1000000));
  }
  async claim(auth: AuthTokenPayload, body: Body) {
    worker(auth);
    const campaign = String(body.campaign ?? "");
    if (!(WORKSPACE_CAMPAIGNS as readonly string[]).includes(campaign)) throw new ApiError(400, "Неизвестная кампания");
    if (typeof body.episodeKey !== "string" || !/^(patient|visit|appointment):[1-9]\d*$/.test(body.episodeKey)) throw new ApiError(400, "Некорректный эпизод");
    return this.repository.claim({ patientId: integer(body.patientId, "patientId"), campaign: campaign as WorkspaceCampaign, episodeKey: body.episodeKey, operatorId: auth.userId });
  }
  async release(auth: AuthTokenPayload, body: Body) {
    worker(auth);
    await this.repository.release(integer(body.patientId, "patientId"), auth.userId, body.taskId == null ? undefined : integer(body.taskId, "taskId"));
    return { success: true };
  }
  async attempt(auth: AuthTokenPayload, body: Body) {
    worker(auth);
    const outcome = String(body.outcome ?? "");
    if (!(WORKSPACE_OUTCOMES as readonly string[]).includes(outcome)) throw new ApiError(400, "Недопустимый исход звонка");
    if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) throw new ApiError(400, "Требуется уникальный requestId (8–128 символов)");
    if (body.note != null && typeof body.note !== "string") throw new ApiError(400, "Заметка должна быть текстом");
    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    if (note && note.length > 2000) throw new ApiError(400, "Заметка не длиннее 2000 символов");
    let callbackAt: string | null = null;
    if (outcome === "callback") {
      // Future-time validation happens after the repository's idempotency lookup: a
      // retry of an already saved callback must still succeed after its due time.
      if (typeof body.callbackAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(body.callbackAt) || !Number.isFinite(Date.parse(body.callbackAt))) throw new ApiError(400, "Укажите время обратного звонка с часовым поясом");
      callbackAt = new Date(body.callbackAt).toISOString();
    } else if (body.callbackAt != null && body.callbackAt !== "") throw new ApiError(400, "Время обратного звонка допустимо только для исхода callback");
    return this.repository.attempt({ taskId: integer(body.taskId, "taskId"), outcome: outcome as WorkspaceOutcome, note, callbackAt, requestId: body.requestId, operatorId: auth.userId });
  }
  async assign(auth: AuthTokenPayload, body: Body) {
    admin(auth);
    await this.repository.assign(integer(body.taskId, "taskId"), body.operatorId === null ? null : integer(body.operatorId, "operatorId"));
    return { success: true };
  }
}
