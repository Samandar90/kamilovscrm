CREATE TABLE appointments (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  doctor_id BIGINT NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  service_id BIGINT NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'scheduled',
      'confirmed',
      'arrived',
      'in_consultation',
      'completed',
      'cancelled',
      'no_show'
    )
  ),
  diagnosis TEXT NULL,
  treatment TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT appointments_time_order CHECK (end_at > start_at)
);

CREATE INDEX idx_appointments_patient_start
  ON appointments (patient_id, start_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_appointments_doctor_start
  ON appointments (doctor_id, start_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_appointments_service_start
  ON appointments (service_id, start_at DESC)
  WHERE deleted_at IS NULL;
