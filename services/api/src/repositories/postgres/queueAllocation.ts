import type { QueryClient } from "./queryPool";

/**
 * Atomic per-doctor/day counter + doctor letter snapshot. Must run inside the caller's transaction on `client`:
 * the upsert row-locks the counter until COMMIT, so concurrent issues for one doctor get consecutive numbers,
 * and a ROLLBACK gives the number back. The letter is copied onto the appointment (`queue_prefix`) so a printed
 * ticket stays valid if the doctor's letter changes later.
 */
export async function allocateQueueNumber(
  client: QueryClient,
  clinicId: number,
  doctorId: number,
  day: string
): Promise<{ queueNumber: number; queuePrefix: string | null }> {
  const counter = await client.query(
    `
      INSERT INTO queue_counters (clinic_id, doctor_id, queue_date, last_number)
      VALUES ($1, $2, $3::date, 1)
      ON CONFLICT (doctor_id, queue_date) DO UPDATE SET last_number = queue_counters.last_number + 1
      RETURNING last_number
    `,
    [clinicId, doctorId, day]
  );
  const doctor = await client.query(
    `SELECT queue_prefix FROM doctors WHERE id = $1 AND clinic_id = $2`,
    [doctorId, clinicId]
  );
  const prefix: unknown = doctor.rows[0]?.queue_prefix;
  return {
    // pg returns INTEGER as number already; Number() keeps PGlite and pg identical.
    queueNumber: Number(counter.rows[0].last_number),
    queuePrefix: typeof prefix === "string" && prefix.trim() !== "" ? prefix : null,
  };
}
