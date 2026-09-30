import { ApiError } from "../middleware/errorHandler";
import { getSubscriptionBlock } from "../middleware/subscriptionMiddleware";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import type {
  IQueueDisplaysRepository,
  IQueueRepository,
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayLanguage,
  QueueDisplayState,
  QueueDisplayWithCode,
} from "../repositories/interfaces/queueTypes";
import { formatDisplayCode, generateDisplayCode, hashDisplayCode, normalizeDisplayCode } from "./queue/displayCode";
import { buildDisplayState } from "./queue/displayState";
import { loadQueueDay } from "./queue/queueDay";
import { clinicToday } from "./queue/queueRules";

type Body = Record<string, unknown>;
const asBody = (body: unknown): Body =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};

const DISPLAY_LANGUAGES: readonly QueueDisplayLanguage[] = ["uz", "ru", "uz_ru"];
const NOT_FOUND = "Экран не найден";

const parseName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  const length = [...name].length;
  if (length < 1 || length > 100) {
    throw new ApiError(400, "Название экрана: от 1 до 100 символов");
  }
  return name;
};

const parseBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new ApiError(400, `Поле '${field}' должно быть true или false`);
  }
  return value;
};

const parseLanguage = (value: unknown): QueueDisplayLanguage => {
  if (typeof value !== "string" || !DISPLAY_LANGUAGES.includes(value as QueueDisplayLanguage)) {
    throw new ApiError(400, "Язык экрана: uz, ru или uz_ru");
  }
  return value as QueueDisplayLanguage;
};

/** id из URL: не положительное целое → такого экрана нет (404), в БД не ходим. */
const assertDisplayId = (id: number): void => {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(404, NOT_FOUND);
  }
};

export class QueueDisplaysService {
  constructor(
    private readonly displays: IQueueDisplaysRepository,
    private readonly queue: IQueueRepository,
    private readonly timeZone: string = "Asia/Tashkent",
    private readonly now: () => Date = () => new Date()
  ) {}

  list(auth: AuthTokenPayload): Promise<QueueDisplay[]> {
    return this.displays.list(auth.clinicId);
  }

  async create(auth: AuthTokenPayload, body: unknown): Promise<QueueDisplayWithCode> {
    const b = asBody(body);
    const name = parseName(b.name);
    const showNames = b.showNames === undefined ? true : parseBoolean(b.showNames, "showNames");
    const language = b.language === undefined ? "uz_ru" : parseLanguage(b.language);
    const voiceEnabled = b.voiceEnabled === undefined ? true : parseBoolean(b.voiceEnabled, "voiceEnabled");
    // Проверка врачей идёт в БД — последней, после дешёвых проверок.
    const doctorIds = await this.parseDoctorIds(auth.clinicId, b.doctorIds ?? null);
    const input: QueueDisplayInput = { name, doctorIds, showNames, language, voiceEnabled };
    // Код показывается один раз; в БД только sha256 канонической формы.
    const canonical = generateDisplayCode();
    const display = await this.displays.create(auth.clinicId, input, hashDisplayCode(canonical), auth.userId);
    return { display, code: formatDisplayCode(canonical) };
  }

  async update(auth: AuthTokenPayload, id: number, body: unknown): Promise<QueueDisplay> {
    assertDisplayId(id);
    const b = asBody(body);
    const patch: Partial<QueueDisplayInput> = {};
    if (b.name !== undefined) patch.name = parseName(b.name);
    if (b.showNames !== undefined) patch.showNames = parseBoolean(b.showNames, "showNames");
    if (b.language !== undefined) patch.language = parseLanguage(b.language);
    if (b.voiceEnabled !== undefined) patch.voiceEnabled = parseBoolean(b.voiceEnabled, "voiceEnabled");
    if (b.doctorIds !== undefined) patch.doctorIds = await this.parseDoctorIds(auth.clinicId, b.doctorIds);
    const updated = await this.displays.update(auth.clinicId, id, patch);
    if (!updated) {
      throw new ApiError(404, NOT_FOUND);
    }
    return updated;
  }

  async remove(auth: AuthTokenPayload, id: number): Promise<{ success: true; id: number }> {
    assertDisplayId(id);
    if (!(await this.displays.revoke(auth.clinicId, id))) {
      throw new ApiError(404, NOT_FOUND);
    }
    return { success: true, id };
  }

  async rotate(auth: AuthTokenPayload, id: number): Promise<QueueDisplayWithCode> {
    assertDisplayId(id);
    const canonical = generateDisplayCode();
    const display = await this.displays.rotate(auth.clinicId, id, hashDisplayCode(canonical));
    if (!display) {
      throw new ApiError(404, NOT_FOUND);
    }
    return { display, code: formatDisplayCode(canonical) };
  }

  /** Публичное состояние ТВ по коду экрана. Клиника берётся из самого экрана, не из токена. */
  async publicState(code: string): Promise<QueueDisplayState> {
    const canonical = normalizeDisplayCode(code);
    if (!canonical) {
      throw new ApiError(404, NOT_FOUND);
    }
    const lookup = await this.displays.findByTokenHash(hashDisplayCode(canonical));
    if (!lookup) {
      throw new ApiError(404, NOT_FOUND);
    }
    const now = this.now();
    const block = getSubscriptionBlock(
      { subscription_status: lookup.subscriptionStatus, subscription_ends_at: lookup.subscriptionEndsAt },
      now.getTime()
    );
    if (block) {
      throw new ApiError(403, "Подписка клиники неактивна");
    }
    const day = clinicToday(this.timeZone, now);
    const { rows, doctors } = await loadQueueDay(
      this.queue,
      lookup.clinicId,
      day,
      lookup.display.doctorIds,
      lookup.display.doctorIds ?? []
    );
    return buildDisplayState({
      serverTime: now.toISOString(),
      timeZone: this.timeZone,
      clinicName: lookup.clinicName,
      display: lookup.display,
      doctors,
      rows,
    });
  }

  /** null/[] → «все врачи с очередью сегодня»; иначе уникальные id, и каждый должен быть врачом этой клиники. */
  private async parseDoctorIds(clinicId: number, value: unknown): Promise<number[] | null> {
    if (value === null) {
      return null;
    }
    if (!Array.isArray(value) || !value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
      throw new ApiError(400, "Поле 'doctorIds' должно быть списком id врачей или null");
    }
    const ids = [...new Set(value as number[])];
    if (ids.length === 0) {
      return null;
    }
    const existing = new Set(await this.displays.existingDoctorIds(clinicId, ids));
    if (!ids.every((id) => existing.has(id))) {
      throw new ApiError(400, "Неизвестный врач в списке экрана");
    }
    return ids;
  }
}
