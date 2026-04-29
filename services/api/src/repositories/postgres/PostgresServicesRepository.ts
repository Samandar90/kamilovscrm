import type { PoolClient } from "pg";
import type { IServicesRepository } from "../interfaces/IServicesRepository";
import type {
  Service,
  ServiceCreateInput,
  ServiceFilters,
  ServiceUpdateInput,
} from "../interfaces/coreTypes";
import { dbPool } from "../../config/database";
import { ApiError } from "../../middleware/errorHandler";
import { parseNonNegativeMoneyFromPg, parseNumericInput } from "../../utils/numbers";
import { requireClinicId } from "../../tenancy/clinicContext";

type ServiceDbRow = {
  id: string | number;
  name: string;
  price: string | number;
  duration: string | number;
  active: boolean | null;
  created_at: Date | string;
  doctor_ids: number[] | null;
};

const toIso = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const mapRow = (row: ServiceDbRow): Service => ({
  id: Number(row.id),
  name: row.name,
  category: "other",
  price: parseNonNegativeMoneyFromPg(row.price),
  duration: (() => {
    const d = parseNumericInput(row.duration);
    return d != null && d > 0 ? Math.round(d) : 1;
  })(),
  active: row.active !== false,
  doctorIds: (row.doctor_ids ?? []).map((id) => Number(id)).sort((a, b) => a - b),
  createdAt: toIso(row.created_at),
});

const replaceServiceDoctors = async (
  client: PoolClient,
  serviceId: number,
  doctorIds: number[]
): Promise<void> => {
  const clinicId = requireClinicId();
  await client.query(`DELETE FROM doctor_services WHERE service_id = $1`, [serviceId]);
  const uniqueSorted = [...new Set(doctorIds)].sort((a, b) => a - b);
  for (const doctorId of uniqueSorted) {
    await client.query(
      `
        INSERT INTO doctor_services (doctor_id, service_id)
        SELECT $1, $2
        WHERE EXISTS (SELECT 1 FROM doctors d WHERE d.id = $1 AND d.clinic_id = $3)
      `,
      [doctorId, serviceId, clinicId]
    );
  }
};

const assertDoctorsExist = async (
  client: PoolClient | typeof dbPool,
  doctorIds: number[]
): Promise<void> => {
  const clinicId = requireClinicId();
  if (doctorIds.length === 0) return;
  const unique = [...new Set(doctorIds)];
  const result = await client.query<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
      FROM doctors
      WHERE id = ANY($1::bigint[])
        AND clinic_id = $2
        AND deleted_at IS NULL
    `,
    [unique, clinicId]
  );
  const count = Number(result.rows[0]?.c ?? 0);
  if (count !== unique.length) {
    throw new ApiError(400, "One or more doctorIds are invalid or deleted");
  }
};

const baseSelect = `
  SELECT
    s.id,
    s.name,
    s.price,
    s.duration,
    s.active,
    s.created_at,
    COALESCE(
      array_agg(ds.doctor_id::bigint ORDER BY ds.doctor_id)
        FILTER (WHERE ds.doctor_id IS NOT NULL),
      ARRAY[]::bigint[]
    ) AS doctor_ids
  FROM services s
  LEFT JOIN doctor_services ds ON ds.service_id = s.id
`;

const groupByService = `
  GROUP BY
    s.id,
    s.name,
    s.price,
    s.duration,
    s.active,
    s.created_at
`;

export class PostgresServicesRepository implements IServicesRepository {
  async findAll(filters: ServiceFilters = {}): Promise<Service[]> {
    const clinicId = requireClinicId();
    const conditions: string[] = ["s.deleted_at IS NULL", "s.clinic_id = $1"];
    const values: Array<number | boolean> = [clinicId];

    if (filters.activeOnly === true) {
      conditions.push("s.active = true");
    }

    if (filters.doctorId !== undefined) {
      values.push(filters.doctorId);
      conditions.push(
        `EXISTS (
          SELECT 1 FROM doctor_services ds2
          WHERE ds2.service_id = s.id AND ds2.doctor_id = $${values.length}
        )`
      );
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      ${baseSelect}
      ${where}
      ${groupByService}
      ORDER BY s.name ASC
    `;

    const result = await dbPool.query<ServiceDbRow>(query, values);
    return result.rows.map(mapRow);
  }

  async findById(id: number): Promise<Service | null> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<ServiceDbRow>(
      `
        ${baseSelect}
        WHERE s.id = $1 AND s.deleted_at IS NULL AND s.clinic_id = $2
        ${groupByService}
        LIMIT 1
      `,
      [id, clinicId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async create(data: ServiceCreateInput): Promise<Service> {
    const clinicId = requireClinicId();
    const doctorIds = data.doctorIds ?? [];
    const name = data.name.trim();

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await assertDoctorsExist(client, doctorIds);

      const insertResult = await client.query<ServiceDbRow>(
        `
          INSERT INTO services (clinic_id, name, price, duration, active)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING
            id,
            name,
            price,
            duration,
            active,
            created_at,
            ARRAY[]::bigint[] AS doctor_ids
        `,
        [clinicId, name, data.price, data.duration, data.active]
      );
      const row = insertResult.rows[0];
      const serviceId = Number(row.id);
      await replaceServiceDoctors(client, serviceId, doctorIds);

      await client.query("COMMIT");

      const loaded = await this.findById(serviceId);
      if (!loaded) {
        throw new ApiError(500, "Service created but could not be reloaded");
      }
      return loaded;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: number, data: ServiceUpdateInput): Promise<Service | null> {
    const clinicId = requireClinicId();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ id: string | number }>(
        `SELECT id FROM services WHERE id = $1 AND deleted_at IS NULL AND clinic_id = $2 FOR UPDATE`,
        [id, clinicId]
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      if (data.doctorIds !== undefined) {
        await assertDoctorsExist(client, data.doctorIds);
      }

      const setClauses: string[] = [];
      const values: Array<string | number | boolean> = [];

      if (data.name !== undefined) {
        values.push(data.name.trim());
        setClauses.push(`name = $${values.length}`);
      }
      if (data.price !== undefined) {
        values.push(data.price);
        setClauses.push(`price = $${values.length}`);
      }
      if (data.duration !== undefined) {
        values.push(data.duration);
        setClauses.push(`duration = $${values.length}`);
      }
      if (data.active !== undefined) {
        values.push(data.active);
        setClauses.push(`active = $${values.length}`);
      }

      if (setClauses.length > 0) {
        values.push(id);
        values.push(clinicId);
        const updateResult = await client.query(
          `
            UPDATE services
            SET ${setClauses.join(", ")}
            WHERE id = $${values.length - 1} AND clinic_id = $${values.length}
            RETURNING id
          `,
          values
        );
        if (updateResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return null;
        }
      }

      if (data.doctorIds !== undefined) {
        await replaceServiceDoctors(client, id, data.doctorIds);
      }

      await client.query("COMMIT");

      return this.findById(id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: number }>(
        `DELETE FROM services WHERE id = $1 AND clinic_id = $2 RETURNING id`,
        [id, clinicId]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(`DELETE FROM doctor_services WHERE service_id = $1`, [id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async isServiceAssignedToDoctor(serviceId: number, doctorId: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const result = await dbPool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM doctor_services ds
          INNER JOIN services s ON s.id = ds.service_id AND s.deleted_at IS NULL
          INNER JOIN doctors d ON d.id = ds.doctor_id
          WHERE ds.service_id = $1
            AND ds.doctor_id = $2
            AND s.clinic_id = $3
            AND d.clinic_id = $3
        ) AS exists
      `,
      [serviceId, doctorId, clinicId]
    );
    return result.rows[0]?.exists === true;
  }
}
