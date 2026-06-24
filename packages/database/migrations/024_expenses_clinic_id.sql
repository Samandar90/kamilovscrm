-- Мультитенантность: каждая строка расходов привязана к клинике (как payments / invoices / cash_register_entries).
-- Безопасная миграция: только ADD COLUMN + backfill существующих строк на текущую клинику (id=1), данные не теряются.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT;

-- DEFAULT 1 — временная обратная совместимость: пока выкатывается новый код,
-- старый бэкенд вставляет расходы без clinic_id. Задаётся отдельным ALTER,
-- чтобы применилось и если колонка уже существовала (ADD COLUMN IF NOT EXISTS пропускается).
-- Убрать DEFAULT в фазе полной мультитенантности.
ALTER TABLE expenses
  ALTER COLUMN clinic_id SET DEFAULT 1;

-- Существующие расходы принадлежат первой (текущей) клинике.
UPDATE expenses
SET clinic_id = 1
WHERE clinic_id IS NULL;

ALTER TABLE expenses
  ALTER COLUMN clinic_id SET NOT NULL;

-- Индекс под основной запрос findAll: фильтр по клинике + сортировка по дате.
CREATE INDEX IF NOT EXISTS idx_expenses_clinic_paid_at_active
  ON expenses (clinic_id, paid_at DESC, id DESC)
  WHERE deleted_at IS NULL;
