import { dbPool } from "../../config/database";
import { env } from "../../config/env";
import { normalizeUzPhone, sendSms } from "./eskizClient";

const REMINDER_TYPE = "reminder_24h";

type DueRow = {
  appointment_id: number | string;
  clinic_id: number | string;
  patient_id: number | string;
  patient_name: string;
  phone: string | null;
  clinic_name: string;
  visit_date: string;
  visit_time: string;
};

const renderTemplate = (row: DueRow): string =>
  env.smsReminderTemplate
    .replace("{patient}", row.patient_name)
    .replace("{clinic}", row.clinic_name)
    .replace("{date}", row.visit_date)
    .replace("{time}", row.visit_time);

/**
 * Напоминание за сутки: записи, до которых осталось < 24ч (по настенному времени клиники).
 * start_at хранится как «настенное» время (wall clock as UTC), поэтому сравниваем
 * с now() AT TIME ZONE reportsTimezone, а не с now() напрямую.
 *
 * Отправка защищена от дублей уникальным индексом (appointment_id, type):
 * INSERT ... ON CONFLICT DO NOTHING — кто вставил строку, тот и шлёт.
 */
export const runSmsReminderCycle = async (): Promise<void> => {
  if (!env.smsEnabled || env.dataProvider !== "postgres") return;

  const due = await dbPool.query<DueRow>(
    `
      SELECT
        a.id AS appointment_id,
        a.clinic_id,
        p.id AS patient_id,
        COALESCE(NULLIF(TRIM(p.full_name), ''), 'Пациент') AS patient_name,
        p.phone,
        c.name AS clinic_name,
        to_char(a.start_at AT TIME ZONE 'UTC', 'DD.MM.YYYY') AS visit_date,
        to_char(a.start_at AT TIME ZONE 'UTC', 'HH24:MI') AS visit_time
      FROM appointments a
      INNER JOIN patients p ON p.id = a.patient_id AND p.deleted_at IS NULL
      INNER JOIN clinics c ON c.id = a.clinic_id AND c.sms_enabled = TRUE
      WHERE a.deleted_at IS NULL
        AND a.status IN ('scheduled', 'confirmed')
        AND (a.start_at AT TIME ZONE 'UTC') > (now() AT TIME ZONE $1)
        AND (a.start_at AT TIME ZONE 'UTC') <= (now() AT TIME ZONE $1) + interval '24 hours'
        AND p.phone IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sms_notifications s
          WHERE s.appointment_id = a.id AND s.type = $2
        )
      ORDER BY a.start_at
      LIMIT 50
    `,
    [env.reportsTimezone, REMINDER_TYPE]
  );

  for (const row of due.rows) {
    const phone = normalizeUzPhone(row.phone);
    const message = renderTemplate(row);

    // Клейм: только одна нода/итерация получит право отправки по этой записи.
    const claim = await dbPool.query<{ id: number }>(
      `
        INSERT INTO sms_notifications (clinic_id, appointment_id, patient_id, phone, type, message, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        ON CONFLICT (appointment_id, type) DO NOTHING
        RETURNING id
      `,
      [row.clinic_id, row.appointment_id, row.patient_id, phone ?? row.phone ?? "", REMINDER_TYPE, message]
    );
    const claimed = claim.rows[0];
    if (!claimed) continue;

    if (!phone) {
      await dbPool.query(
        `UPDATE sms_notifications SET status = 'failed', error = $2 WHERE id = $1`,
        [claimed.id, `Некорректный номер: ${row.phone ?? "—"}`]
      );
      continue;
    }

    const result = await sendSms(phone, message);
    if (result.ok) {
      await dbPool.query(
        `UPDATE sms_notifications SET status = 'sent', sent_at = now(), provider_message_id = $2 WHERE id = $1`,
        [claimed.id, result.providerId]
      );
    } else {
      await dbPool.query(
        `UPDATE sms_notifications SET status = 'failed', error = $2 WHERE id = $1`,
        [claimed.id, result.error.slice(0, 500)]
      );
      // eslint-disable-next-line no-console
      console.warn("[SMS] send failed", { appointmentId: row.appointment_id, error: result.error.slice(0, 200) });
    }
  }
};

const CYCLE_MS = 10 * 60 * 1000;

/** Запуск планировщика (вызывается из server.ts после старта). */
export const startSmsReminderScheduler = (): void => {
  if (!env.smsEnabled || env.dataProvider !== "postgres") {
    // eslint-disable-next-line no-console
    console.log("[SMS] scheduler disabled (SMS_ENABLED/credentials/postgres required)");
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[SMS] reminder scheduler started (every 10 min)");
  const tick = () => {
    runSmsReminderCycle().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[SMS] cycle error:", e instanceof Error ? e.message : String(e));
    });
  };
  setTimeout(tick, 30_000);
  setInterval(tick, CYCLE_MS);
};
