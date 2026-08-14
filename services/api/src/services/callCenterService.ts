import { ApiError } from "../middleware/errorHandler";
import type { ICallCenterRepository } from "../repositories/interfaces/ICallCenterRepository";
import type {
  CallOutcome,
  CallQueueItem,
  CallReminderLog,
  CallReminderRule,
} from "../repositories/interfaces/callCenterTypes";
import { CALL_OUTCOMES } from "../repositories/interfaces/callCenterTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RULES = 5;

const parseDate = (raw: unknown): string => {
  const value = String(raw ?? "").trim();
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, "Дата должна быть в формате YYYY-MM-DD");
  }
  return value;
};

export type CallMarkBody = {
  appointmentId?: unknown;
  daysBefore?: unknown;
  outcome?: unknown;
  note?: unknown;
};

export class CallCenterService {
  constructor(private readonly callCenterRepository: ICallCenterRepository) {}

  async listRules(_auth: AuthTokenPayload): Promise<CallReminderRule[]> {
    return this.callCenterRepository.listRules();
  }

  /** Правила меняет только супер-админ — «сколько звонков и за сколько дней». */
  async addRule(auth: AuthTokenPayload, rawDaysBefore: unknown): Promise<CallReminderRule> {
    if (auth.role !== "superadmin") {
      throw new ApiError(403, "Правила напоминаний настраивает только супер-админ");
    }
    const daysBefore = Number(rawDaysBefore);
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 30) {
      throw new ApiError(400, "«За сколько дней» — целое число от 0 до 30");
    }
    const rulesNow = await this.callCenterRepository.listRules();
    if (rulesNow.length >= MAX_RULES && !rulesNow.some((r) => r.daysBefore === daysBefore)) {
      throw new ApiError(400, `Не больше ${MAX_RULES} звонков-напоминаний на пациента`);
    }
    return this.callCenterRepository.addRule(daysBefore);
  }

  async removeRule(auth: AuthTokenPayload, rawId: unknown): Promise<boolean> {
    if (auth.role !== "superadmin") {
      throw new ApiError(403, "Правила напоминаний настраивает только супер-админ");
    }
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "id is required");
    }
    return this.callCenterRepository.removeRule(id);
  }

  async queue(_auth: AuthTokenPayload, rawDate: unknown): Promise<CallQueueItem[]> {
    return this.callCenterRepository.queueForDate(parseDate(rawDate));
  }

  async mark(auth: AuthTokenPayload, body: CallMarkBody): Promise<CallReminderLog> {
    const appointmentId = Number(body.appointmentId);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      throw new ApiError(400, "appointmentId is required");
    }
    const daysBefore = Number(body.daysBefore);
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 30) {
      throw new ApiError(400, "daysBefore is required");
    }
    const outcome = String(body.outcome ?? "") as CallOutcome;
    if (!CALL_OUTCOMES.includes(outcome)) {
      throw new ApiError(400, `Недопустимый исход звонка: ${String(body.outcome)}`);
    }
    const note = body.note == null ? null : String(body.note).trim() || null;
    if (note && note.length > 500) {
      throw new ApiError(400, "Заметка длиннее 500 символов");
    }
    return this.callCenterRepository.mark({
      appointmentId,
      daysBefore,
      outcome,
      note,
      calledBy: auth.userId,
    });
  }
}
