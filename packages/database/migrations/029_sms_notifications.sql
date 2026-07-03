-- SMS-напоминания пациентам (Eskiz.uz).
-- Включается по клинике (sms_enabled); журнал отправок с защитой от дублей.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sms_notifications (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL,
  appointment_id BIGINT NOT NULL,
  patient_id BIGINT NULL,
  phone TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reminder_24h',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ NULL
);

-- Одно напоминание данного типа на запись: клейм строки = право на отправку.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_appointment_type
  ON sms_notifications (appointment_id, type);

CREATE INDEX IF NOT EXISTS idx_sms_clinic_created
  ON sms_notifications (clinic_id, created_at DESC);
