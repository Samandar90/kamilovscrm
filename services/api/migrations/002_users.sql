-- Users (FK doctor_id → doctors добавлен в 010)

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN (
      'superadmin',
      'reception',
      'doctor',
      'nurse',
      'cashier',
      'operator',
      'accountant',
      'manager',
      'director'
    )
  ),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  doctor_id BIGINT NULL,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ NULL,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT users_failed_login_reasonable CHECK (failed_login_attempts <= 1000)
);

CREATE UNIQUE INDEX uq_users_username_active
  ON users (lower(trim(username)))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_users_active_not_deleted
  ON users (is_active)
  WHERE is_active = TRUE AND deleted_at IS NULL;
