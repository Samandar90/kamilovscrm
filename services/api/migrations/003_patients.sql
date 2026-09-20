CREATE TABLE patients (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) > 0),
  phone TEXT NULL,
  gender TEXT NULL CHECK (
    gender IS NULL OR gender IN ('male', 'female', 'other', 'unknown')
  ),
  birth_date DATE NULL,
  source TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_patients_active_created
  ON patients (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_patients_phone_active
  ON patients (phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;
