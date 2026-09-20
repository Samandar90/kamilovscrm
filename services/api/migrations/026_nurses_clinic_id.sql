-- Мультитенантность: медсестра привязана к клинике.
-- Идемпотентно: колонка могла быть добавлена ранее вручную (дрейф схемы) уже как NOT NULL без дефолта.

ALTER TABLE nurses
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT;

-- DEFAULT 1 — временная обратная совместимость на одно-клиничный период
-- (старый upsert вставлял медсестру без clinic_id). Убрать в фазе полной мультитенантности.
ALTER TABLE nurses
  ALTER COLUMN clinic_id SET DEFAULT 1;

UPDATE nurses
SET clinic_id = 1
WHERE clinic_id IS NULL;

ALTER TABLE nurses
  ALTER COLUMN clinic_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nurses_clinic
  ON nurses (clinic_id);
