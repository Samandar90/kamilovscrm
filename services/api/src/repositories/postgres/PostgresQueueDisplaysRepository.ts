import type {
  IQueueDisplaysRepository,
  QueueDisplay,
  QueueDisplayInput,
  QueueDisplayLanguage,
  QueueDisplayLookup,
} from "../interfaces/queueTypes";
import type { QueryPool } from "./queryPool";

type DisplayRow = {
  id: number | string;
  name: string;
  doctor_ids: Array<number | string> | null;
  show_names: boolean;
  language: string;
  voice_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type LookupRow = DisplayRow & {
  clinic_id: number | string;
  clinic_name: string | null;
  subscription_status: string | null;
  subscription_ends_at: Date | string | null;
};

// token_hash и revoked_at наружу не отдаются никогда.
const COLUMNS = "id, name, doctor_ids, show_names, language, voice_enabled, created_at, updated_at";

// pg отдаёт bigint и bigint[] строками, PGlite — числами: всегда Number(...).
const mapDisplay = (row: DisplayRow): QueueDisplay => ({
  id: Number(row.id),
  name: row.name,
  doctorIds: row.doctor_ids == null ? null : row.doctor_ids.map(Number),
  showNames: row.show_names === true,
  language: row.language as QueueDisplayLanguage,
  voiceEnabled: row.voice_enabled === true,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export class PostgresQueueDisplaysRepository implements IQueueDisplaysRepository {
  constructor(private readonly pool: QueryPool) {}

  async list(clinicId: number): Promise<QueueDisplay[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM queue_displays WHERE clinic_id = $1 AND revoked_at IS NULL ORDER BY id`,
      [clinicId]
    );
    return result.rows.map((row) => mapDisplay(row as DisplayRow));
  }

  async create(clinicId: number, input: QueueDisplayInput, tokenHash: string, createdBy: number | null): Promise<QueueDisplay> {
    const result = await this.pool.query(
      `INSERT INTO queue_displays (clinic_id, name, token_hash, doctor_ids, show_names, language, voice_enabled, created_by)
       VALUES ($1, $2, $3, $4::bigint[], $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [clinicId, input.name, tokenHash, input.doctorIds, input.showNames, input.language, input.voiceEnabled, createdBy]
    );
    return mapDisplay(result.rows[0] as DisplayRow);
  }

  async update(clinicId: number, id: number, patch: Partial<QueueDisplayInput>): Promise<QueueDisplay | null> {
    const params: unknown[] = [clinicId, id];
    const sets: string[] = [];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.doctorIds !== undefined) set("doctor_ids", patch.doctorIds, "::bigint[]");
    if (patch.showNames !== undefined) set("show_names", patch.showNames);
    if (patch.language !== undefined) set("language", patch.language);
    if (patch.voiceEnabled !== undefined) set("voice_enabled", patch.voiceEnabled);
    sets.push("updated_at = now()");
    const result = await this.pool.query(
      `UPDATE queue_displays SET ${sets.join(", ")}
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      params
    );
    return result.rows[0] ? mapDisplay(result.rows[0] as DisplayRow) : null;
  }

  async revoke(clinicId: number, id: number): Promise<boolean> {
    // RETURNING вместо rowCount: PGlite не заполняет rowCount.
    const result = await this.pool.query(
      `UPDATE queue_displays SET revoked_at = now(), updated_at = now()
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [clinicId, id]
    );
    return result.rows.length > 0;
  }

  async rotate(clinicId: number, id: number, tokenHash: string): Promise<QueueDisplay | null> {
    const result = await this.pool.query(
      `UPDATE queue_displays SET token_hash = $3, updated_at = now()
       WHERE clinic_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      [clinicId, id, tokenHash]
    );
    return result.rows[0] ? mapDisplay(result.rows[0] as DisplayRow) : null;
  }

  /** Публичный поиск экрана по хешу кода — без clinic-контекста (ТВ не авторизован). */
  async findByTokenHash(tokenHash: string): Promise<QueueDisplayLookup | null> {
    const result = await this.pool.query(
      `SELECT qd.id, qd.name, qd.doctor_ids, qd.show_names, qd.language, qd.voice_enabled, qd.created_at, qd.updated_at,
              qd.clinic_id, c.name AS clinic_name, c.subscription_status, c.subscription_ends_at
       FROM queue_displays qd
       JOIN clinics c ON c.id = qd.clinic_id
       WHERE qd.token_hash = $1 AND qd.revoked_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0] as LookupRow | undefined;
    if (!row) {
      return null;
    }
    return {
      display: mapDisplay(row),
      clinicId: Number(row.clinic_id),
      clinicName: row.clinic_name?.trim() || "Клиника",
      subscriptionStatus: row.subscription_status ?? null,
      subscriptionEndsAt: row.subscription_ends_at == null ? null : new Date(row.subscription_ends_at).toISOString(),
    };
  }

  async existingDoctorIds(clinicId: number, doctorIds: number[]): Promise<number[]> {
    if (doctorIds.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT id FROM doctors WHERE clinic_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
      [clinicId, doctorIds]
    );
    return result.rows.map((row) => Number((row as { id: number | string }).id));
  }
}
