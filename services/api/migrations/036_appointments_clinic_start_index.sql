-- Список записей клиники за период (страницы «Записи» и «Панель управления», подсказка свободного времени):
--   WHERE clinic_id = $1 AND deleted_at IS NULL AND start_at >= $2 AND start_at <= $3 ORDER BY start_at DESC.
-- В production у appointments индекс по start_at есть только для статуса in_consultation (035): без этого индекса
-- запрос за один день просматривает все записи клиники за всё время.
-- Только добавление, миграция идемпотентна, BEGIN/COMMIT ставит db-migrate.cjs.
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_start
  ON appointments (clinic_id, start_at)
  WHERE deleted_at IS NULL;
