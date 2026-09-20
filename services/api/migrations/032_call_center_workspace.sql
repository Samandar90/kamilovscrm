-- Additive patient workspace. Existing reminder rules/logs remain untouched.
CREATE TABLE IF NOT EXISTS call_center_settings (
  clinic_id BIGINT PRIMARY KEY REFERENCES clinics(id),
  settings JSONB NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_center_tasks (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  campaign TEXT NOT NULL CHECK (campaign IN ('base','recall','followup','reminder')),
  episode_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','callback','done','exhausted')),
  due_at TIMESTAMPTZ NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  assigned_to BIGINT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, patient_id, campaign, episode_key)
);
CREATE INDEX IF NOT EXISTS idx_call_center_tasks_callbacks ON call_center_tasks(clinic_id, due_at, id) WHERE status = 'callback';
CREATE INDEX IF NOT EXISTS idx_call_center_tasks_assignee ON call_center_tasks(clinic_id, assigned_to, status);

CREATE TABLE IF NOT EXISTS call_patient_leases (
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  task_id BIGINT NOT NULL REFERENCES call_center_tasks(id),
  claimed_by BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (clinic_id, patient_id)
);

-- No update/delete application endpoint: every contact is a new immutable record.
CREATE TABLE IF NOT EXISTS call_contact_attempts (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  task_id BIGINT NOT NULL REFERENCES call_center_tasks(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  patient_name TEXT NOT NULL,
  campaign TEXT NOT NULL CHECK (campaign IN ('base','recall','followup','reminder')),
  outcome TEXT NOT NULL CHECK (outcome IN ('contacted','confirmed','no_answer','callback','declined','wrong_number')),
  note TEXT NULL CHECK (char_length(note) <= 2000),
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_by BIGINT NOT NULL REFERENCES users(id),
  called_by_name TEXT NOT NULL,
  callback_at TIMESTAMPTZ NULL,
  request_id TEXT NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 128),
  UNIQUE (clinic_id, called_by, request_id)
);
CREATE INDEX IF NOT EXISTS idx_call_contacts_patient_history ON call_contact_attempts(clinic_id, patient_id, called_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_call_contacts_history ON call_contact_attempts(clinic_id, called_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_call_contacts_task ON call_contact_attempts(clinic_id, task_id, called_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_call_workspace_appointments ON appointments(clinic_id, patient_id, status, start_at DESC) WHERE deleted_at IS NULL;
