-- Лиды из Google-таблицы таргетолога: источники и заявки. Только добавления — ни одна существующая строка не затрагивается.
-- Все уникальные ключи начинаются с clinic_id; лид привязан к источнику своей клиники составным внешним ключом.
-- Миграция идемпотентна (IF NOT EXISTS везде), BEGIN/COMMIT ставит db-migrate.cjs.
SET LOCAL lock_timeout = '5s';

-- Источник — один лист одной таблицы одного таргетолога. marketer_user_id — единственное, что определяет, чьи лиды
-- видит таргетолог; NULL — никто вне клиники источник не видит. Лист задаётся номером gid из ссылки: он не меняется
-- при переименовании листа. column_map NULL — колонки ищутся по заголовкам, иначе {"phone": "<заголовок>", "name": "<заголовок>" | null}.
-- spreadsheet_id виден только superadmin и в логи не пишется.
CREATE TABLE IF NOT EXISTS lead_sources (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  marketer_user_id BIGINT NULL REFERENCES users(id),
  spreadsheet_id TEXT NULL CHECK (spreadsheet_id IS NULL OR spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  sheet_gid BIGINT NOT NULL DEFAULT 0 CHECK (sheet_gid >= 0),
  column_map JSONB NULL CHECK (column_map IS NULL OR jsonb_typeof(column_map) = 'object'),
  sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ NULL,
  last_sync_status TEXT NULL CHECK (last_sync_status IS NULL OR last_sync_status ~ '^[a-z0-9_]{1,40}$'),
  last_sync_rows INTEGER NULL,
  last_sync_skipped INTEGER NULL,
  created_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_sources_clinic_id_id_key UNIQUE (clinic_id, id),
  CONSTRAINT lead_sources_sync_needs_sheet CHECK (NOT sync_enabled OR spreadsheet_id IS NOT NULL)
);

-- Поля лида делятся на два набора. Чтение таблицы один раз пишет external_key, full_name, phone, extra и больше их
-- не меняет. Сотрудники пишут status, note, patient_id, staff_updated_*. Повторное чтение не может стереть работу
-- сотрудников. external_key = 'p:' + телефон: одна заявка на один телефон в рамках источника.
-- «Записан» и «Пришёл» по записям привязанного пациента не хранятся — вычисляются при чтении.
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL,
  source_id BIGINT NOT NULL,
  external_key TEXT NOT NULL CHECK (char_length(external_key) BETWEEN 3 AND 200),
  full_name TEXT NULL CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 200),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{10,15}$'),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extra) = 'object'),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'no_answer', 'booked', 'declined', 'invalid')),
  note TEXT NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  patient_id BIGINT NULL REFERENCES patients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_updated_at TIMESTAMPTZ NULL,
  staff_updated_by BIGINT NULL REFERENCES users(id),
  CONSTRAINT leads_source_fkey
    FOREIGN KEY (clinic_id, source_id) REFERENCES lead_sources (clinic_id, id),
  CONSTRAINT leads_clinic_source_key UNIQUE (clinic_id, source_id, external_key)
);

-- Список лидов клиники, новые сверху, постранично по id (страницы «Лиды» и «Мои лиды»).
CREATE INDEX IF NOT EXISTS idx_leads_clinic_recent ON leads (clinic_id, id DESC);
