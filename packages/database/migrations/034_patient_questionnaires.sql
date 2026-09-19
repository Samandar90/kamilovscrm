-- Анкеты пациентов: шаблоны (конструктор) и заполненные анкеты. Аддитивно, существующие таблицы не меняются.
-- Заполненная анкета хранит снимок названия и вопросов шаблона на момент заполнения:
-- правка или отключение шаблона не искажает уже собранные ответы.
-- Шаблоны не удаляются, а отключаются (active = false), поэтому ссылка template_id всегда валидна.

CREATE TABLE IF NOT EXISTS questionnaire_templates (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description TEXT NULL CHECK (char_length(description) <= 2000),
  -- NULL — шаблон для всех врачей клиники; иначе — шаблон конкретного врача.
  doctor_id BIGINT NULL REFERENCES doctors(id),
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL REFERENCES users(id),
  updated_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_templates_clinic
  ON questionnaire_templates(clinic_id, active, title);

CREATE TABLE IF NOT EXISTS patient_questionnaires (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  template_id BIGINT NULL REFERENCES questionnaire_templates(id),
  appointment_id BIGINT NULL REFERENCES appointments(id) ON DELETE SET NULL,
  -- Врач, в контексте которого заполнена анкета (для фильтра «по врачу»).
  doctor_id BIGINT NULL REFERENCES doctors(id),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  created_by BIGINT NULL REFERENCES users(id),
  updated_by BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_patient_questionnaires_patient
  ON patient_questionnaires(clinic_id, patient_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patient_questionnaires_recent
  ON patient_questionnaires(clinic_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patient_questionnaires_template
  ON patient_questionnaires(clinic_id, template_id)
  WHERE deleted_at IS NULL;
