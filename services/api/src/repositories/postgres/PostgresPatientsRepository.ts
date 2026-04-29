import type { IPatientsRepository } from "../interfaces/IPatientsRepository";
import type {
  Patient,
  PatientCreateInput,
  PatientFilters,
  PatientGender,
  PatientSource,
  PatientUpdateInput,
} from "../interfaces/coreTypes";
import { dbPool } from "../../config/database";
import { requireClinicId } from "../../tenancy/clinicContext";

type PatientRow = {
  id: number;
  full_name: string;
  phone: string | null;
  gender: PatientGender | null;
  birth_date: string | Date | null;
  source: string | null;
  notes: string | null;
  created_at: string | Date;
};

const toDateOnly = (value: string | Date | null): string | null => {
  if (value === null) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
};

const toIso = (value: string | Date): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
};

const mapPatientRow = (row: PatientRow): Patient => ({
  id: Number(row.id),
  fullName: row.full_name,
  phone: row.phone,
  gender: row.gender,
  birthDate: toDateOnly(row.birth_date),
  source: mapSourceColumn(row.source),
  notes: row.notes ?? null,
  createdAt: toIso(row.created_at),
});

const PATIENT_SEARCH_LIMIT = 20;

const SOURCE_VALUES = new Set<string>([
  "instagram",
  "telegram",
  "advertising",
  "referral",
  "other",
]);

const mapSourceColumn = (value: string | null): PatientSource | null => {
  if (value === null || value === "") return null;
  return SOURCE_VALUES.has(value) ? (value as PatientSource) : null;
};

/** Escape %, _, \ for ILIKE ... ESCAPE '\' */
const wrapIlikeContainsPattern = (raw: string): string => {
  const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
};

const SELECT_LIST = `
  id,
  full_name,
  phone,
  gender,
  birth_date,
  source,
  notes,
  created_at
`;

/**
 * `pg` передаёт JS-массив в PostgreSQL как литерал массива; элементы вроде `NaN`, `undefined`, `""`
 * ломают приведение к `bigint[]` с ошибкой 22P02 (Invalid input syntax).
 */
function sanitizePositiveIntIdsForBigintArray(raw: readonly unknown[]): {
  ids: number[];
  droppedCount: number;
  hadNaN: boolean;
} {
  const positive: number[] = [];
  let droppedCount = 0;
  let hadNaN = false;
  for (const item of raw) {
    const n = Number(item);
    if (Number.isNaN(n)) {
      hadNaN = true;
      droppedCount++;
      continue;
    }
    if (Number.isInteger(n) && n > 0) {
      positive.push(n);
    } else {
      droppedCount++;
    }
  }
  const ids = [...new Set(positive)];
  return { ids, droppedCount, hadNaN };
}

export class PostgresPatientsRepository implements IPatientsRepository {
  async findAll(filters: PatientFilters = {}): Promise<Patient[]> {
    const clinicId = requireClinicId();
    const incDel = filters.includeDeleted === true;
    const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
    const hasSearch = searchTerm.length > 0;

    if (filters.ids !== undefined) {
      if (filters.ids.length === 0) {
        return [];
      }

      const { ids: safeIds, droppedCount, hadNaN } =
        sanitizePositiveIntIdsForBigintArray(filters.ids);
      if (droppedCount > 0) {
        // eslint-disable-next-line no-console -- защита от «плохих» id в ANY(bigint[]); см. sanitize выше
        console.warn(
          `[PostgresPatientsRepository] Dropped ${droppedCount} invalid patient id(s) before ANY($1::bigint[])${hadNaN ? " (NaN present)" : ""}`
        );
      }
      if (safeIds.length === 0) {
        return [];
      }

      if (hasSearch) {
        const pattern = wrapIlikeContainsPattern(searchTerm);
        const scopedResult = await dbPool.query<PatientRow>(
          `
            SELECT ${SELECT_LIST}
            FROM patients
            WHERE id = ANY($1::bigint[])
            AND clinic_id = $4
            AND deleted_at IS NULL
            AND (
              full_name ILIKE $2 ESCAPE '\\'
              OR phone ILIKE $2 ESCAPE '\\'
              OR (
                char_length(regexp_replace($3::text, '[^0-9]', '', 'g')) >= 3
                AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
                  LIKE (
                    '%'
                    || regexp_replace($3::text, '[^0-9]', '', 'g')
                    || '%'
                  )
              )
            )
            ORDER BY created_at DESC
            LIMIT ${PATIENT_SEARCH_LIMIT}
          `,
          [safeIds, pattern, searchTerm, clinicId]
        );
        return scopedResult.rows.map(mapPatientRow);
      }
      const scopedResult = await dbPool.query<PatientRow>(
        `
          SELECT ${SELECT_LIST}
          FROM patients
          WHERE id = ANY($1::bigint[])
          AND clinic_id = $2
          ${incDel ? "" : "AND deleted_at IS NULL"}
          ORDER BY created_at DESC
        `,
        [safeIds, clinicId]
      );
      return scopedResult.rows.map(mapPatientRow);
    }

    if (hasSearch) {
      const pattern = wrapIlikeContainsPattern(searchTerm);
      const result = await dbPool.query<PatientRow>(
        `
          SELECT ${SELECT_LIST}
          FROM patients
          WHERE deleted_at IS NULL
          AND clinic_id = $3
          AND (
            full_name ILIKE $1 ESCAPE '\\'
            OR phone ILIKE $1 ESCAPE '\\'
            OR (
              char_length(regexp_replace($2::text, '[^0-9]', '', 'g')) >= 3
              AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
                LIKE (
                  '%'
                  || regexp_replace($2::text, '[^0-9]', '', 'g')
                  || '%'
                )
            )
          )
          ORDER BY created_at DESC
          LIMIT ${PATIENT_SEARCH_LIMIT}
        `,
        [pattern, searchTerm, clinicId]
      );
      return result.rows.map(mapPatientRow);
    }

    const result = await dbPool.query<PatientRow>(
      `
        SELECT ${SELECT_LIST}
        FROM patients
        WHERE deleted_at IS NULL
          AND clinic_id = $1
        ORDER BY created_at DESC
      `,
      [clinicId]
    );
    return result.rows.map(mapPatientRow);
  }

  /** По id — в т.ч. архивный (история, просмотр по прямой ссылке). */
  async findById(id: number): Promise<Patient | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<PatientRow>(
      `
        SELECT ${SELECT_LIST}
        FROM patients
        WHERE id = $1 AND clinic_id = $2
        LIMIT 1
      `,
      [id, clinicId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapPatientRow(result.rows[0]);
  }

  async create(data: PatientCreateInput): Promise<Patient> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<PatientRow>(
      `
        INSERT INTO patients (
          clinic_id,
          full_name,
          phone,
          gender,
          birth_date,
          source,
          notes
        )
        VALUES ($1, $2, $3, $4, $5::date, $6, $7)
        RETURNING ${SELECT_LIST}
      `,
      [clinicId, data.fullName, data.phone, data.gender, data.birthDate, data.source ?? null, data.notes ?? null]
    );

    return mapPatientRow(result.rows[0]);
  }

  async update(id: number, data: PatientUpdateInput): Promise<Patient | null> {
    const clinicId = requireClinicId();
    const setClauses: string[] = [];
    const values: Array<string | number | null> = [];

    if (data.fullName !== undefined) {
      values.push(data.fullName);
      setClauses.push(`full_name = $${values.length}`);
    }
    if (data.phone !== undefined) {
      values.push(data.phone);
      setClauses.push(`phone = $${values.length}`);
    }
    if (data.gender !== undefined) {
      values.push(data.gender);
      setClauses.push(`gender = $${values.length}`);
    }
    if (data.birthDate !== undefined) {
      values.push(data.birthDate);
      setClauses.push(`birth_date = $${values.length}::date`);
    }
    if (data.source !== undefined) {
      values.push(data.source);
      setClauses.push(`source = $${values.length}`);
    }
    if (data.notes !== undefined) {
      values.push(data.notes);
      setClauses.push(`notes = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    values.push(clinicId);

    const result = await dbPool.query<PatientRow>(
      `
        UPDATE patients
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length - 1} AND clinic_id = $${values.length} AND deleted_at IS NULL
        RETURNING ${SELECT_LIST}
      `,
      values
    );

    if (result.rows.length === 0) {
      return null;
    }

    return mapPatientRow(result.rows[0]);
  }

  async delete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ id: number }>(
      `
        UPDATE patients
        SET deleted_at = NOW()
        WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
        RETURNING id
      `,
      [id, clinicId]
    );
    return result.rows.length > 0;
  }
}
