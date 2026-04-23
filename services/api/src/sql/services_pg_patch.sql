-- Legacy/alternate services DDL (prefer packages/database/schema.sql for new installs)
CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(128) NOT NULL DEFAULT 'other',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  duration INTEGER NOT NULL DEFAULT 30 CHECK (duration > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_code_active
ON services (code)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_services_name_active
ON services (name)
WHERE deleted_at IS NULL;
