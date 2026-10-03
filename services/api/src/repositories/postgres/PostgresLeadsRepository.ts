import type {
  ILeadsRepository,
  Lead,
  LeadColumnMap,
  LeadInsertRow,
  LeadMarketerOption,
  LeadPatientMatch,
  LeadSourceBrief,
  LeadSourceChanges,
  LeadSourceCreate,
  LeadSourceRecord,
  LeadStaffChanges,
  LeadStage,
  LeadStatus,
  LeadSyncStatus,
  LeadSyncTarget,
  LeadsListFilters,
  MyLead,
  MyLeadsFilters,
} from "../interfaces/leadTypes";
import type { QueryPool } from "./queryPool";

type Id = number | string;
type Timestamp = Date | string;

type LeadRow = {
  id: Id;
  created_at: Timestamp;
  full_name: string | null;
  phone: string;
  extra: unknown;
  status: string;
  stage: string;
  note: string | null;
  source_id: Id;
  source_name: string;
  patient_id: Id | null;
  patient_name: string | null;
  staff_updated_at: Timestamp | null;
  staff_updated_by_name: string | null;
};

type MyLeadRow = Pick<LeadRow, "id" | "created_at" | "full_name" | "phone" | "source_name" | "stage">;

type SourceRow = {
  id: Id;
  clinic_id: Id;
  name: string;
  marketer_user_id: Id | null;
  marketer_name: string | null;
  spreadsheet_id: string | null;
  sheet_gid: Id;
  column_map: unknown;
  sync_enabled: boolean;
  last_sync_at: Timestamp | null;
  last_sync_status: string | null;
  last_sync_rows: number | null;
  last_sync_skipped: number | null;
  leads_count: Id;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// «Записан» и «Пришёл» не хранятся: считаются при чтении по записям привязанного пациента, созданным после лида.
// Один фрагмент на оба списка (сотрудников и таргетолога), чтобы правило не разошлось. Отменённая запись и неявка
// в обе группы не входят — лид возвращается к сохранённому статусу. Пациент, удалённый после привязки,
// считается непривязанным: его записи стадию не меняют (сам patient_id в строке лида остаётся).
const STAGE_JOIN = `LEFT JOIN LATERAL (
         SELECT bool_or(a.status IN ('arrived', 'in_consultation', 'completed')) AS arrived,
                bool_or(a.status IN ('scheduled', 'confirmed')) AS upcoming
         FROM appointments a
         JOIN patients ap_p ON ap_p.id = a.patient_id AND ap_p.clinic_id = a.clinic_id AND ap_p.deleted_at IS NULL
         WHERE a.clinic_id = l.clinic_id AND a.patient_id = l.patient_id
           AND a.deleted_at IS NULL AND a.created_at >= l.created_at
       ) ap ON l.patient_id IS NOT NULL`;
const STAGE = "CASE WHEN ap.arrived THEN 'visited' WHEN ap.upcoming THEN 'booked' ELSE l.status END";

// Лид для сотрудников. Источник, пациент и последний редактор — только из той же клиники.
// patient_id берётся из строки пациента: удалённый пациент наружу не отдаётся ни номером, ни именем.
const LEAD_SELECT = `SELECT l.id, l.created_at, l.full_name, l.phone, l.extra, l.status, ${STAGE} AS stage, l.note,
              l.source_id, s.name AS source_name, p.id AS patient_id, p.full_name AS patient_name,
              l.staff_updated_at, u.full_name AS staff_updated_by_name
       FROM leads l
       JOIN lead_sources s ON s.clinic_id = l.clinic_id AND s.id = l.source_id
       LEFT JOIN patients p ON p.id = l.patient_id AND p.clinic_id = l.clinic_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = l.staff_updated_by AND u.clinic_id = l.clinic_id
       ${STAGE_JOIN}`;

const SOURCE_SELECT = `SELECT s.id, s.clinic_id, s.name, s.marketer_user_id, u.full_name AS marketer_name, s.spreadsheet_id, s.sheet_gid,
              s.column_map, s.sync_enabled, s.last_sync_at, s.last_sync_status, s.last_sync_rows, s.last_sync_skipped,
              s.created_at, s.updated_at,
              (SELECT count(*) FROM leads l WHERE l.clinic_id = s.clinic_id AND l.source_id = s.id) AS leads_count
       FROM lead_sources s
       LEFT JOIN users u ON u.id = s.marketer_user_id AND u.clinic_id = s.clinic_id`;

const LAST_SYNC_COLUMNS = ["last_sync_at", "last_sync_status", "last_sync_rows", "last_sync_skipped"];

const iso = (value: Timestamp): string => new Date(value).toISOString();
const isoOrNull = (value: Timestamp | null): string | null => (value == null ? null : iso(value));
const idOrNull = (value: Id | null): number | null => (value == null ? null : Number(value));

/** jsonb «заголовок → текст»; всё, что не строка, наружу не отдаётся. */
const mapExtra = (value: unknown): Record<string, string> => {
  const extra: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [header, text] of Object.entries(value)) {
      if (typeof text === "string") extra[header] = text;
    }
  }
  return extra;
};

const mapColumnMap = (value: unknown): LeadColumnMap | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { phone, name } = value as { phone?: unknown; name?: unknown };
  if (typeof phone !== "string" || phone === "") return null;
  return { phone, name: typeof name === "string" && name !== "" ? name : null };
};

// pg отдаёт bigint строками, PGlite — числами: всегда Number(...).
const mapLead = (row: LeadRow): Lead => ({
  id: Number(row.id),
  createdAt: iso(row.created_at),
  fullName: row.full_name,
  phone: row.phone,
  extra: mapExtra(row.extra),
  status: row.status as LeadStatus,
  stage: row.stage as LeadStage,
  note: row.note,
  sourceId: Number(row.source_id),
  sourceName: row.source_name,
  patientId: idOrNull(row.patient_id),
  patientName: row.patient_id == null ? null : row.patient_name,
  staffUpdatedAt: isoOrNull(row.staff_updated_at),
  staffUpdatedByName: row.staff_updated_by_name,
});

const mapSource = (row: SourceRow): LeadSourceRecord => ({
  id: Number(row.id),
  clinicId: Number(row.clinic_id),
  name: row.name,
  marketerUserId: idOrNull(row.marketer_user_id),
  marketerName: row.marketer_user_id == null ? null : row.marketer_name,
  spreadsheetId: row.spreadsheet_id,
  gid: Number(row.sheet_gid),
  columnMap: mapColumnMap(row.column_map),
  syncEnabled: row.sync_enabled === true,
  lastSyncAt: isoOrNull(row.last_sync_at),
  lastSyncStatus: row.last_sync_status as LeadSyncStatus | null,
  lastSyncRows: row.last_sync_rows == null ? null : Number(row.last_sync_rows),
  lastSyncSkipped: row.last_sync_skipped == null ? null : Number(row.last_sync_skipped),
  leadsCount: Number(row.leads_count),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export class PostgresLeadsRepository implements ILeadsRepository {
  constructor(private readonly pool: QueryPool) {}

  async listLeads(clinicId: number, filters: LeadsListFilters): Promise<Lead[]> {
    const params: unknown[] = [clinicId];
    const param = (value: unknown) => `$${params.push(value)}`;
    const where = ["l.clinic_id = $1"];
    if (filters.sourceId != null) where.push(`l.source_id = ${param(filters.sourceId)}`);
    if (filters.beforeId != null) where.push(`l.id < ${param(filters.beforeId)}`);
    // Стадия вычисляется, поэтому фильтр по ней — снаружи, по готовой колонке.
    const byStage = filters.stage == null ? "" : `WHERE q.stage = ${param(filters.stage)}`;
    const result = await this.pool.query(
      `SELECT q.* FROM (
       ${LEAD_SELECT}
       WHERE ${where.join(" AND ")}
       ) q ${byStage}
       ORDER BY q.id DESC LIMIT ${param(filters.limit)}`,
      params
    );
    return result.rows.map((row) => mapLead(row as LeadRow));
  }

  async getLead(clinicId: number, id: number): Promise<Lead | null> {
    const result = await this.pool.query(`${LEAD_SELECT} WHERE l.clinic_id = $1 AND l.id = $2`, [clinicId, id]);
    return result.rows[0] ? mapLead(result.rows[0] as LeadRow) : null;
  }

  /**
   * Единственный INSERT в leads. Клиника лида копируется из строки источника внутри SQL: источник чужой клиники
   * не даёт ни одной строки. ON CONFLICT обязателен — общий обработчик ошибок вернул бы текст PostgreSQL со значением ключа.
   */
  async insertLeads(clinicId: number, sourceId: number, rows: LeadInsertRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const payload = JSON.stringify(
      rows.map((row) => ({ external_key: row.externalKey, full_name: row.fullName, phone: row.phone, extra: row.extra }))
    );
    // RETURNING вместо rowCount: PGlite не заполняет rowCount.
    const result = await this.pool.query(
      `INSERT INTO leads (clinic_id, source_id, external_key, full_name, phone, extra)
       SELECT s.clinic_id, s.id, r.external_key, r.full_name, r.phone, r.extra
       FROM lead_sources s
       CROSS JOIN jsonb_to_recordset($3::jsonb)
         AS r(external_key text, full_name text, phone text, extra jsonb)
       WHERE s.id = $1 AND s.clinic_id = $2
       ON CONFLICT (clinic_id, source_id, external_key) DO NOTHING
       RETURNING id`,
      [sourceId, clinicId, payload]
    );
    return result.rows.length;
  }

  async updateLead(
    clinicId: number,
    id: number,
    changes: LeadStaffChanges,
    expectedStatus: LeadStatus | null,
    userId: number
  ): Promise<"ok" | "not_found" | "conflict"> {
    const params: unknown[] = [id, clinicId, userId];
    const param = (value: unknown) => `$${params.push(value)}`;
    const sets = ["staff_updated_at = now()", "staff_updated_by = $3"];
    if (changes.status !== undefined) sets.push(`status = ${param(changes.status)}`);
    if (changes.note !== undefined) sets.push(`note = ${param(changes.note)}`);
    const guard = expectedStatus == null ? "" : ` AND status = ${param(expectedStatus)}`;
    const updated = await this.pool.query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $1 AND clinic_id = $2${guard} RETURNING id`,
      params
    );
    if (updated.rows.length > 0) {
      return "ok";
    }
    // Строка не изменилась: либо лида в клинике нет, либо коллега уже сменил статус.
    return expectedStatus != null && (await this.leadExists(clinicId, id)) ? "conflict" : "not_found";
  }

  async setLeadPatient(
    clinicId: number,
    id: number,
    patientId: number | null,
    userId: number
  ): Promise<"ok" | "not_found" | "patient_not_found"> {
    if (patientId === null) {
      const unlinked = await this.pool.query(
        `UPDATE leads SET patient_id = NULL, staff_updated_at = now(), staff_updated_by = $3
         WHERE id = $1 AND clinic_id = $2
         RETURNING id`,
        [id, clinicId, userId]
      );
      return unlinked.rows.length > 0 ? "ok" : "not_found";
    }
    // Пациент проверяется тем же UPDATE: своя клиника, не удалён. Новый лид при привязке уходит «В работу».
    const linked = await this.pool.query(
      `UPDATE leads l
       SET patient_id = $3,
           status = CASE WHEN l.status = 'new' THEN 'in_progress' ELSE l.status END,
           staff_updated_at = now(), staff_updated_by = $4
       WHERE l.id = $1 AND l.clinic_id = $2
         AND EXISTS (SELECT 1 FROM patients p WHERE p.id = $3 AND p.clinic_id = l.clinic_id AND p.deleted_at IS NULL)
       RETURNING l.id`,
      [id, clinicId, patientId, userId]
    );
    if (linked.rows.length > 0) {
      return "ok";
    }
    return (await this.leadExists(clinicId, id)) ? "patient_not_found" : "not_found";
  }

  /** Подсказка по нажатию, для одного лида: индекса по цифрам телефона у patients нет и не нужно. */
  async findPatientMatches(clinicId: number, phone: string): Promise<LeadPatientMatch[]> {
    const result = await this.pool.query(
      `SELECT id, full_name, phone FROM patients
       WHERE clinic_id = $1 AND deleted_at IS NULL
         AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = right($2::text, 9)
       ORDER BY id DESC LIMIT 5`,
      [clinicId, phone]
    );
    return result.rows.map((row) => {
      const patient = row as { id: Id; full_name: string; phone: string | null };
      return { id: Number(patient.id), fullName: patient.full_name, phone: patient.phone };
    });
  }

  /**
   * Список таргетолога. Колонки перечислены явно: extra, note, patient_id, кто и когда работал с лидом,
   * данные пациента и записи сюда не выбираются. Источник и клинику запрос не принимает — только id из токена.
   */
  async listMarketerLeads(clinicId: number, marketerUserId: number, filters: MyLeadsFilters): Promise<MyLead[]> {
    const params: unknown[] = [clinicId, marketerUserId];
    const param = (value: unknown) => `$${params.push(value)}`;
    const before = filters.beforeId == null ? "" : ` AND l.id < ${param(filters.beforeId)}`;
    const result = await this.pool.query(
      `SELECT l.id, l.created_at, l.full_name, l.phone, s.name AS source_name, ${STAGE} AS stage
       FROM leads l
       JOIN lead_sources s ON s.clinic_id = l.clinic_id AND s.id = l.source_id
       ${STAGE_JOIN}
       WHERE l.clinic_id = $1 AND s.marketer_user_id = $2${before}
       ORDER BY l.id DESC LIMIT ${param(filters.limit)}`,
      params
    );
    return result.rows.map((raw) => {
      const row = raw as MyLeadRow;
      return {
        id: Number(row.id),
        receivedAt: iso(row.created_at),
        fullName: row.full_name,
        phone: row.phone,
        sourceName: row.source_name,
        stage: row.stage as LeadStage,
      };
    });
  }

  async listSourcesBrief(clinicId: number): Promise<LeadSourceBrief[]> {
    const result = await this.pool.query(`SELECT id, name FROM lead_sources WHERE clinic_id = $1 ORDER BY id`, [clinicId]);
    return result.rows.map((row) => ({ id: Number((row as { id: Id }).id), name: (row as { name: string }).name }));
  }

  async listSources(clinicId: number): Promise<LeadSourceRecord[]> {
    const result = await this.pool.query(`${SOURCE_SELECT} WHERE s.clinic_id = $1 ORDER BY s.id`, [clinicId]);
    return result.rows.map((row) => mapSource(row as SourceRow));
  }

  async findSource(clinicId: number, id: number): Promise<LeadSourceRecord | null> {
    const result = await this.pool.query(`${SOURCE_SELECT} WHERE s.clinic_id = $1 AND s.id = $2`, [clinicId, id]);
    return result.rows[0] ? mapSource(result.rows[0] as SourceRow) : null;
  }

  async createSource(clinicId: number, input: LeadSourceCreate, createdBy: number | null): Promise<LeadSourceRecord> {
    const result = await this.pool.query(
      `INSERT INTO lead_sources (clinic_id, name, marketer_user_id, spreadsheet_id, sheet_gid, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [clinicId, input.name, input.marketerUserId, input.sheet?.spreadsheetId ?? null, input.sheet?.gid ?? 0, createdBy]
    );
    return (await this.findSource(clinicId, Number((result.rows[0] as { id: Id }).id))) as LeadSourceRecord;
  }

  async updateSource(clinicId: number, id: number, changes: LeadSourceChanges): Promise<LeadSourceRecord | null> {
    const params: unknown[] = [clinicId, id];
    const param = (value: unknown, cast = "") => `$${params.push(value)}${cast}`;
    const sets: string[] = [];
    if (changes.name !== undefined) sets.push(`name = ${param(changes.name)}`);
    if (changes.marketerUserId !== undefined) sets.push(`marketer_user_id = ${param(changes.marketerUserId)}`);

    // Справа от «=» в UPDATE стоят старые значения строки: «таблица изменилась» считается по ним.
    let columnMap =
      changes.columnMap === undefined
        ? "column_map"
        : param(changes.columnMap === null ? null : JSON.stringify(changes.columnMap), "::jsonb");
    if (changes.sheet !== undefined) {
      const spreadsheetId = param(changes.sheet?.spreadsheetId ?? null, "::text");
      const gid = param(changes.sheet?.gid ?? 0, "::bigint");
      const changed = `(spreadsheet_id IS DISTINCT FROM ${spreadsheetId} OR sheet_gid <> ${gid})`;
      sets.push(`spreadsheet_id = ${spreadsheetId}`, `sheet_gid = ${gid}`);
      // Другая таблица или другой лист: прежние колонки и итог прошлого чтения к ним не относятся.
      // Та же ссылка, присланная формой повторно, ничего не сбрасывает.
      if (changes.columnMap === undefined) columnMap = `CASE WHEN ${changed} THEN NULL ELSE column_map END`;
      for (const column of LAST_SYNC_COLUMNS) sets.push(`${column} = CASE WHEN ${changed} THEN NULL ELSE ${column} END`);
    }
    let syncEnabled = "sync_enabled";
    if (changes.sheet === null) {
      // Без таблицы читать нечего (и CHECK lead_sources_sync_needs_sheet этого не допустит).
      syncEnabled = "FALSE";
    } else if (changes.syncEnabled !== undefined) {
      const requested = param(changes.syncEnabled, "::boolean");
      // Таблица не меняется этим запросом: чтение не включится, даже если её убрали между проверкой в сервисе и этим UPDATE.
      syncEnabled = changes.sheet !== undefined ? requested : `(${requested} AND spreadsheet_id IS NOT NULL)`;
    }
    sets.push(`column_map = ${columnMap}`, `sync_enabled = ${syncEnabled}`, "updated_at = now()");

    const result = await this.pool.query(
      `UPDATE lead_sources SET ${sets.join(", ")}
       WHERE clinic_id = $1 AND id = $2
       RETURNING id`,
      params
    );
    return result.rows.length > 0 ? this.findSource(clinicId, id) : null;
  }

  async isBindableMarketer(clinicId: number, userId: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM users
       WHERE clinic_id = $1 AND id = $2 AND role = 'marketer' AND deleted_at IS NULL AND COALESCE(is_active, true) = true
       LIMIT 1`,
      [clinicId, userId]
    );
    return result.rows.length > 0;
  }

  async listMarketers(clinicId: number): Promise<LeadMarketerOption[]> {
    const result = await this.pool.query(
      `SELECT id, full_name, username FROM users
       WHERE clinic_id = $1 AND role = 'marketer' AND deleted_at IS NULL AND COALESCE(is_active, true) = true
       ORDER BY full_name, id`,
      [clinicId]
    );
    return result.rows.map((row) => {
      const user = row as { id: Id; full_name: string | null; username: string };
      return { id: Number(user.id), fullName: user.full_name ?? user.username, username: user.username };
    });
  }

  /** Единственный запрос без clinic_id: планировщик чтения обходит источники всех клиник, клиника — из самой строки. */
  async listSyncEnabledSources(): Promise<LeadSyncTarget[]> {
    const result = await this.pool.query(
      `SELECT clinic_id, id, spreadsheet_id, sheet_gid, column_map FROM lead_sources
       WHERE sync_enabled AND spreadsheet_id IS NOT NULL
       ORDER BY clinic_id, id`
    );
    return result.rows.map((raw) => {
      const row = raw as Pick<SourceRow, "clinic_id" | "id" | "sheet_gid" | "column_map"> & { spreadsheet_id: string };
      return {
        clinicId: Number(row.clinic_id),
        id: Number(row.id),
        spreadsheetId: row.spreadsheet_id,
        gid: Number(row.sheet_gid),
        columnMap: mapColumnMap(row.column_map),
      };
    });
  }

  async recordSync(clinicId: number, sourceId: number, status: LeadSyncStatus, rows: number | null, skipped: number | null): Promise<void> {
    // updated_at не трогаем: это время изменения настроек, а чтение идёт каждые 5 минут.
    await this.pool.query(
      `UPDATE lead_sources SET last_sync_at = now(), last_sync_status = $3, last_sync_rows = $4, last_sync_skipped = $5
       WHERE clinic_id = $1 AND id = $2`,
      [clinicId, sourceId, status, rows, skipped]
    );
  }

  private async leadExists(clinicId: number, id: number): Promise<boolean> {
    const result = await this.pool.query(`SELECT 1 FROM leads WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
    return result.rows.length > 0;
  }
}
