CREATE TABLE services (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  category TEXT NOT NULL DEFAULT 'other',
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  duration INTEGER NOT NULL CHECK (duration > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX uq_services_code_active
  ON services (lower(trim(code)))
  WHERE code IS NOT NULL AND trim(code) <> '' AND deleted_at IS NULL;

CREATE TABLE doctor_services (
  doctor_id BIGINT NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  service_id BIGINT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, service_id)
);

CREATE INDEX idx_doctor_services_service_id
  ON doctor_services (service_id);
