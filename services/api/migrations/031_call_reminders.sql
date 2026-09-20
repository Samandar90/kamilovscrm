-- Напоминания колл-центра.
-- Правила: за сколько дней до приёма звонить (набор точек на клинику,
-- например 3 и 1 = два звонка каждому пациенту). Настраивает админ.
-- Журнал: исход каждого звонка; unique (appointment_id, days_before) —
-- одно напоминание на запись на каждую точку правила, исход можно менять upsert-ом.

CREATE TABLE IF NOT EXISTS call_reminder_rules (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL,
  days_before INT NOT NULL CHECK (days_before BETWEEN 0 AND 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, days_before)
);

CREATE TABLE IF NOT EXISTS call_reminder_logs (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL,
  appointment_id BIGINT NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  days_before INT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('confirmed', 'no_answer', 'rescheduled', 'cancelled')
  ),
  note TEXT NULL,
  called_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, days_before)
);

CREATE INDEX IF NOT EXISTS idx_call_reminder_logs_clinic_called
  ON call_reminder_logs (clinic_id, called_at);
