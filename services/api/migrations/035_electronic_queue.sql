-- Электронная очередь: номер у каждого врача на день, вызов на ТВ-экран. Только добавления.
-- Статусы записи остаются единственным источником правды: «Ждёт» = arrived без вызова, «Вызван» = arrived с вызовом,
-- «На приёме» = in_consultation. Миграция идемпотентна (IF NOT EXISTS везде), BEGIN/COMMIT ставит db-migrate.cjs.

-- Кабинет врача (показывается на ТВ и талоне) и необязательная буква очереди («К» → талон «К-05»).
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS room TEXT NULL
    CHECK (room IS NULL OR char_length(btrim(room)) BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL
    CHECK (queue_prefix IS NULL OR char_length(queue_prefix) = 1);

-- Номер в очереди врача на день (queue_date — календарный день клиники) и история вызова.
-- queue_prefix — снимок буквы врача на момент выдачи: напечатанный талон не меняется, если букву врача поменяют позже.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS queue_number INTEGER NULL CHECK (queue_number > 0),
  ADD COLUMN IF NOT EXISTS queue_prefix TEXT NULL,
  ADD COLUMN IF NOT EXISTS queue_date DATE NULL,
  ADD COLUMN IF NOT EXISTS queue_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_called_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS queue_call_count INTEGER NOT NULL DEFAULT 0;

-- Страховка от дублей поверх счётчика: один номер у врача в день выдаётся один раз.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_queue_ticket
  ON appointments (doctor_id, queue_date, queue_number)
  WHERE queue_number IS NOT NULL;
-- Очередь клиники на день (ТВ и страница «Очередь»): ветка «номер на этот день».
CREATE INDEX IF NOT EXISTS idx_appointments_queue_day
  ON appointments (clinic_id, queue_date, doctor_id)
  WHERE queue_number IS NOT NULL AND deleted_at IS NULL;
-- Вторая ветка того же запроса: «На приёме» с start_at в границах дня (в том числе без номера, если врач принял
-- пациента напрямую). Запрос выполняется при каждом опросе ТВ (2 с) и страницы «Очередь» (5 с), а в production
-- у appointments нет индекса по start_at (есть только pkey и индексы по clinic_id/created_by_doctor_id/обзвону).
-- С этим индексом обе ветки OR читаются через BitmapOr, без полного просмотра записей клиники.
CREATE INDEX IF NOT EXISTS idx_appointments_in_consultation_day
  ON appointments (clinic_id, start_at)
  WHERE status = 'in_consultation' AND deleted_at IS NULL;

-- Атомарный счётчик номеров: INSERT ... ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING.
-- Номера за день не переиспользуются: отмена записи счётчик не уменьшает.
CREATE TABLE IF NOT EXISTS queue_counters (
  clinic_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL REFERENCES doctors(id),
  queue_date DATE NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (doctor_id, queue_date)
);

-- ТВ-экраны клиники. Сам код экрана не хранится — только sha256 (hex); код показывается один раз.
-- doctor_ids NULL — все врачи, у кого сегодня есть очередь; удаление экрана — revoked_at.
CREATE TABLE IF NOT EXISTS queue_displays (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE,
  doctor_ids BIGINT[] NULL,
  show_names BOOLEAN NOT NULL DEFAULT TRUE,
  language TEXT NOT NULL DEFAULT 'uz_ru' CHECK (language IN ('uz', 'ru', 'uz_ru')),
  voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_displays_clinic
  ON queue_displays (clinic_id) WHERE revoked_at IS NULL;
