CREATE TABLE doctors (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) > 0),
  specialty TEXT NOT NULL DEFAULT ''::text,
  percent NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_doctors_active_name
  ON doctors (active, full_name)
  WHERE deleted_at IS NULL;
