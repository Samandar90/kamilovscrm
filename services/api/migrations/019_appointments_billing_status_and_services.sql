ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_billing_status_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_billing_status_check
  CHECK (billing_status IN ('draft', 'ready_for_payment', 'paid'));

CREATE TABLE IF NOT EXISTS appointment_services (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  service_id BIGINT NOT NULL REFERENCES services (id) ON DELETE RESTRICT,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_services_appointment_id
  ON appointment_services (appointment_id);
