import { ApiError } from "../middleware/errorHandler";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import {
  LEAD_STATUSES,
  type ILeadsRepository,
  type Lead,
  type LeadColumnMap,
  type LeadInsertRow,
  type LeadPatientMatch,
  type LeadSheetRef,
  type LeadSource,
  type LeadSourceBrief,
  type LeadSourceChanges,
  type LeadSourceRecord,
  type LeadSourcesManage,
  type LeadStaffChanges,
  type LeadStatus,
  type LeadsPage,
  type MyLeadsPage,
} from "../repositories/interfaces/leadTypes";
import { canonicalizePhone } from "../utils/phone";
import { parseLeadsListQuery, parseMyLeadsQuery } from "../validators/leadsValidators";
import { buildSheetUrl, parseSheetUrl } from "./leads/sheetCsvClient";
import type { LeadRowInput } from "./leads/sheetMapping";

type Body = Record<string, unknown>;
const asBody = (body: unknown): Body =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};

// Тексты ошибок фиксированные: ни телефона, ни имени, ни ссылки на таблицу в них нет.
const LEAD_NOT_FOUND = "Лид не найден";
const SOURCE_NOT_FOUND = "Источник не найден";
const PATIENT_NOT_FOUND = "Пациент не найден";

const NAME_MAX = 100;
const NOTE_MAX = 2000;
const HEADER_MAX = 200;
const FULL_NAME_MAX = 200;
/** Лиды пишутся пачками: один INSERT на 500 строк. */
const INGEST_CHUNK = 500;

/** Статусы, которые ставит сотрудник: все, кроме `new` (его ставит только чтение таблицы). */
const STAFF_STATUSES: readonly LeadStatus[] = LEAD_STATUSES.filter((status) => status !== "new");

const isLeadStatus = (value: unknown): value is LeadStatus =>
  typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);

// Длина считается в символах, как char_length в CHECK-ах миграции 038.
const chars = (text: string): number => [...text].length;

// NUL PostgreSQL не хранит ни в text, ни в jsonb: запрос с ним падает, и ответом был бы 500. Остальным управляющим
// символам в названии тоже делать нечего.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// В заголовке колонки перенос строки и табуляция допустимы: ячейка заголовка в таблице бывает в две строки.
const HEADER_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const parseSourceName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  const length = chars(name);
  if (length < 1 || length > NAME_MAX) {
    throw new ApiError(400, `Название источника: от 1 до ${NAME_MAX} символов`);
  }
  if (CONTROL_RE.test(name)) {
    throw new ApiError(400, "Название источника не должно содержать управляющих символов");
  }
  return name;
};

const parseBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") {
    throw new ApiError(400, `Поле '${field}' должно быть true или false`);
  }
  return value;
};

/** id из тела запроса: только число JSON, не строка. null — «не привязан» / «отвязать». */
const parseNullableId = (value: unknown, field: string): number | null => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ApiError(400, `Поле '${field}' должно быть положительным целым числом или null`);
  }
  return value;
};

/** Ссылка на таблицу или её id; null убирает таблицу. Произвольный адрес сюда не попадает: из ссылки берутся только id и gid. */
const parseSheet = (value: unknown): LeadSheetRef | null => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "Поле 'sheetUrl' должно быть ссылкой на таблицу или null");
  }
  const sheet = parseSheetUrl(value);
  if (!sheet) {
    throw new ApiError(422, "Не удалось распознать ссылку на Google-таблицу");
  }
  return sheet;
};

const COLUMN_MAP_ERROR = `Поле 'columnMap': заголовок колонки телефона (до ${HEADER_MAX} символов) и заголовок колонки имени или null`;

/** null — колонки ищутся по заголовкам автоматически. */
const parseColumnMap = (value: unknown): LeadColumnMap | null => {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, COLUMN_MAP_ERROR);
  }
  const { phone, name } = value as { phone?: unknown; name?: unknown };
  const phoneHeader = typeof phone === "string" ? phone.trim() : "";
  if (phoneHeader === "" || chars(phoneHeader) > HEADER_MAX) {
    throw new ApiError(400, COLUMN_MAP_ERROR);
  }
  if (name !== undefined && name !== null && (typeof name !== "string" || chars(name.trim()) > HEADER_MAX)) {
    throw new ApiError(400, COLUMN_MAP_ERROR);
  }
  const nameHeader = typeof name === "string" ? name.trim() : "";
  if (HEADER_CONTROL_RE.test(phoneHeader) || HEADER_CONTROL_RE.test(nameHeader)) {
    throw new ApiError(400, "Поле 'columnMap': заголовок колонки не должен содержать управляющих символов");
  }
  return { phone: phoneHeader, name: nameHeader === "" ? null : nameHeader };
};

const parseLeadPatch = (body: unknown): { changes: LeadStaffChanges; expectedStatus: LeadStatus | null } => {
  const b = asBody(body);
  const changes: LeadStaffChanges = {};
  if (b.status !== undefined) {
    if (!isLeadStatus(b.status) || !STAFF_STATUSES.includes(b.status)) {
      throw new ApiError(400, `Статус лида: ${STAFF_STATUSES.join(", ")}`);
    }
    changes.status = b.status;
  }
  if (b.note !== undefined) {
    if (b.note !== null && typeof b.note !== "string") {
      throw new ApiError(400, "Поле 'note' должно быть текстом или null");
    }
    // NUL в text PostgreSQL не хранит; пустая заметка — её отсутствие.
    const note = (b.note ?? "").replace(/\u0000/g, "").trim();
    if (chars(note) > NOTE_MAX) {
      throw new ApiError(400, `Заметка: не длиннее ${NOTE_MAX} символов`);
    }
    changes.note = note === "" ? null : note;
  }
  if (changes.status === undefined && changes.note === undefined) {
    throw new ApiError(400, "Укажите статус или заметку");
  }
  if (b.expectedStatus !== undefined && !isLeadStatus(b.expectedStatus)) {
    throw new ApiError(400, `Поле 'expectedStatus': ${LEAD_STATUSES.join(", ")}`);
  }
  return { changes, expectedStatus: b.expectedStatus ?? null };
};

/** Наружу уходит ссылка, собранная сервером из id и gid; сам id таблицы и клиника в ответ не попадают. */
const toSource = (record: LeadSourceRecord): LeadSource => ({
  id: record.id,
  name: record.name,
  marketerUserId: record.marketerUserId,
  marketerName: record.marketerName,
  sheetUrl: record.spreadsheetId == null ? null : buildSheetUrl(record.spreadsheetId, record.gid),
  columnMap: record.columnMap,
  syncEnabled: record.syncEnabled,
  lastSyncAt: record.lastSyncAt,
  lastSyncStatus: record.lastSyncStatus,
  lastSyncRows: record.lastSyncRows,
  lastSyncSkipped: record.lastSyncSkipped,
  leadsCount: record.leadsCount,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/** Репозиторий отдаёт на одну строку больше лимита: по ней видно, есть ли следующая страница. */
const toPage = <T extends { id: number }>(rows: T[], limit: number): { items: T[]; nextBeforeId: number | null } => {
  const items = rows.slice(0, limit);
  return { items, nextBeforeId: rows.length > limit ? items[items.length - 1].id : null };
};

// Строка таблицы приходит из mapSheetRows уже проверенной; здесь — страховка, чтобы ни одна строка
// не упёрлась в CHECK миграции 038 и не сорвала всю пачку (в тексте такой ошибки были бы значения ячеек).
const cleanFullName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const name = [...value.replace(/\u0000/g, "").trim()].slice(0, FULL_NAME_MAX).join("").trim();
  return name === "" ? null : name;
};

const cleanExtra = (value: unknown): Record<string, string> => {
  const extra: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [header, text] of Object.entries(value)) {
      if (typeof text === "string") extra[header.replace(/\u0000/g, "")] = text.replace(/\u0000/g, "");
    }
  }
  return extra;
};

/**
 * Лиды и их источники. Клиника и пользователь — всегда из токена; ролей сервис не различает:
 * доступ к каждому адресу закрыт в роутере (leads.read / leads.update, LEAD_SOURCES_MANAGE, LEADS_OWN_READ).
 */
export class LeadsService {
  constructor(private readonly leads: ILeadsRepository) {}

  async list(auth: AuthTokenPayload, query: unknown): Promise<LeadsPage> {
    const filters = parseLeadsListQuery(query);
    const rows = await this.leads.listLeads(auth.clinicId, { ...filters, limit: filters.limit + 1 });
    return toPage(rows, filters.limit);
  }

  async update(auth: AuthTokenPayload, id: number, body: unknown): Promise<Lead> {
    const { changes, expectedStatus } = parseLeadPatch(body);
    const outcome = await this.leads.updateLead(auth.clinicId, id, changes, expectedStatus, auth.userId);
    if (outcome === "not_found") {
      throw new ApiError(404, LEAD_NOT_FOUND);
    }
    if (outcome === "conflict") {
      throw new ApiError(409, "Статус лида уже изменён другим сотрудником. Обновите список");
    }
    return this.requireLead(auth.clinicId, id);
  }

  /** Только подсказка: лид с пациентом сам не связывается, связь ставит сотрудник. */
  async patientMatches(auth: AuthTokenPayload, id: number): Promise<{ items: LeadPatientMatch[] }> {
    const lead = await this.requireLead(auth.clinicId, id);
    return { items: await this.leads.findPatientMatches(auth.clinicId, lead.phone) };
  }

  async setPatient(auth: AuthTokenPayload, id: number, body: unknown): Promise<Lead> {
    const b = asBody(body);
    if (b.patientId === undefined) {
      throw new ApiError(400, "Поле 'patientId' обязательно: id пациента или null");
    }
    const patientId = parseNullableId(b.patientId, "patientId");
    const outcome = await this.leads.setLeadPatient(auth.clinicId, id, patientId, auth.userId);
    if (outcome === "not_found") {
      throw new ApiError(404, LEAD_NOT_FOUND);
    }
    if (outcome === "patient_not_found") {
      throw new ApiError(404, PATIENT_NOT_FOUND);
    }
    return this.requireLead(auth.clinicId, id);
  }

  /** Источники для фильтра списка: только id и название. */
  async listSources(auth: AuthTokenPayload): Promise<{ items: LeadSourceBrief[] }> {
    return { items: await this.leads.listSourcesBrief(auth.clinicId) };
  }

  async manageSources(auth: AuthTokenPayload): Promise<LeadSourcesManage> {
    const [sources, marketers] = await Promise.all([
      this.leads.listSources(auth.clinicId),
      this.leads.listMarketers(auth.clinicId),
    ]);
    return { items: sources.map(toSource), marketers };
  }

  async createSource(auth: AuthTokenPayload, body: unknown): Promise<LeadSource> {
    const b = asBody(body);
    const name = parseSourceName(b.name);
    const marketerUserId = parseNullableId(b.marketerUserId ?? null, "marketerUserId");
    const sheet = parseSheet(b.sheetUrl ?? null);
    // Проверка таргетолога идёт в БД — последней, после дешёвых проверок.
    await this.assertBindableMarketer(auth.clinicId, marketerUserId);
    return toSource(await this.leads.createSource(auth.clinicId, { name, marketerUserId, sheet }, auth.userId));
  }

  async updateSource(auth: AuthTokenPayload, id: number, body: unknown): Promise<LeadSource> {
    const b = asBody(body);
    const changes: LeadSourceChanges = {};
    if (b.name !== undefined) changes.name = parseSourceName(b.name);
    if (b.marketerUserId !== undefined) changes.marketerUserId = parseNullableId(b.marketerUserId, "marketerUserId");
    if (b.columnMap !== undefined) changes.columnMap = parseColumnMap(b.columnMap);
    if (b.syncEnabled !== undefined) changes.syncEnabled = parseBoolean(b.syncEnabled, "syncEnabled");
    if (b.sheetUrl !== undefined) changes.sheet = parseSheet(b.sheetUrl);

    const current = await this.leads.findSource(auth.clinicId, id);
    if (!current) {
      throw new ApiError(404, SOURCE_NOT_FOUND);
    }
    if (changes.marketerUserId !== undefined) {
      await this.assertBindableMarketer(auth.clinicId, changes.marketerUserId);
    }
    // Включить чтение можно только у источника с таблицей: той, что уже есть, или той, что пришла в этом же запросе.
    const hasSheet = changes.sheet === undefined ? current.spreadsheetId != null : changes.sheet !== null;
    if (changes.syncEnabled === true && !hasSheet) {
      throw new ApiError(422, "Сначала укажите ссылку на таблицу");
    }
    const updated = await this.leads.updateSource(auth.clinicId, id, changes);
    if (!updated) {
      throw new ApiError(404, SOURCE_NOT_FOUND);
    }
    return toSource(updated);
  }

  /** Единственный адрес таргетолога: лиды источников, привязанных к пользователю из токена. */
  async mine(auth: AuthTokenPayload, query: unknown): Promise<MyLeadsPage> {
    const filters = parseMyLeadsQuery(query);
    const rows = await this.leads.listMarketerLeads(auth.clinicId, auth.userId, { ...filters, limit: filters.limit + 1 });
    return toPage(rows, filters.limit);
  }

  /**
   * Единственное место, где создаются лиды. Одна заявка на один телефон в рамках источника: ключ строки — «p:» + телефон,
   * повтор внутри пачки отбрасывается (остаётся первая строка), повтор с уже записанным лидом пропускает INSERT.
   * Существующие лиды не меняются: повторное чтение таблицы не стирает работу сотрудников.
   * `duplicates` — строки, чей ключ уже был в источнике: отброшенные (без пригодного телефона) и повторы внутри пачки
   * сюда не входят.
   */
  async ingestLeadRows(
    clinicId: number,
    sourceId: number,
    rows: LeadRowInput[]
  ): Promise<{ received: number; added: number; duplicates: number }> {
    const unique = new Map<string, LeadInsertRow>();
    for (const row of rows) {
      const phone = canonicalizePhone(row.phone);
      if (phone === null || unique.has(phone)) {
        continue;
      }
      unique.set(phone, { externalKey: `p:${phone}`, fullName: cleanFullName(row.fullName), phone, extra: cleanExtra(row.extra) });
    }
    const batch = [...unique.values()];
    let added = 0;
    for (let start = 0; start < batch.length; start += INGEST_CHUNK) {
      added += await this.leads.insertLeads(clinicId, sourceId, batch.slice(start, start + INGEST_CHUNK));
    }
    return { received: rows.length, added, duplicates: batch.length - added };
  }

  private async requireLead(clinicId: number, id: number): Promise<Lead> {
    const lead = await this.leads.getLead(clinicId, id);
    if (!lead) {
      throw new ApiError(404, LEAD_NOT_FOUND);
    }
    return lead;
  }

  /** Привязать можно только аккаунт той же клиники с ролью marketer, активный и не удалённый. */
  private async assertBindableMarketer(clinicId: number, userId: number | null): Promise<void> {
    if (userId !== null && !(await this.leads.isBindableMarketer(clinicId, userId))) {
      throw new ApiError(422, "Таргетолог не найден среди активных аккаунтов клиники");
    }
  }
}
