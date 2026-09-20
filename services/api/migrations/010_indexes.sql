-- Отложенный FK users.doctor_id → doctors, вспомогательные таблицы, доп. индексы

ALTER TABLE users
  ADD CONSTRAINT users_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_users_doctor_profile_one_account
  ON users (doctor_id)
  WHERE
    role = 'doctor'
    AND doctor_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE TABLE nurses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  doctor_id BIGINT NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nurses_doctor_id
  ON nurses (doctor_id);

CREATE TABLE login_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NULL REFERENCES users (id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_audit_created
  ON login_audit_logs (created_at DESC);

CREATE INDEX idx_login_audit_username_created
  ON login_audit_logs (lower(trim(username)), created_at DESC);

CREATE TABLE auth_otp_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  temp_token_hash TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts_left INTEGER NOT NULL DEFAULT 5 CHECK (attempts_left >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_auth_otp_user_expires
  ON auth_otp_codes (user_id, expires_at DESC);

CREATE TABLE ai_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (char_length(trim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_messages_user_created
  ON ai_messages (user_id, created_at ASC);

CREATE INDEX idx_payments_created_active
  ON payments (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_invoices_id_active
  ON invoices (id)
  WHERE deleted_at IS NULL;
