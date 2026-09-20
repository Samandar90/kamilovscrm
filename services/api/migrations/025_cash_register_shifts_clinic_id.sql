-- Мультитенантность: смена кассы привязана к клинике (как cash_register_entries / payments).
-- Идемпотентно: колонка могла быть добавлена ранее вручную (дрейф схемы) уже как NOT NULL.

ALTER TABLE cash_register_shifts
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT;

-- DEFAULT 1 — временная обратная совместимость на одно-клиничный период
-- (старый openShift вставлял смену без clinic_id). Убрать в фазе полной мультитенантности.
ALTER TABLE cash_register_shifts
  ALTER COLUMN clinic_id SET DEFAULT 1;

UPDATE cash_register_shifts
SET clinic_id = 1
WHERE clinic_id IS NULL;

ALTER TABLE cash_register_shifts
  ALTER COLUMN clinic_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_register_shifts_clinic_open
  ON cash_register_shifts (clinic_id, opened_at DESC);
