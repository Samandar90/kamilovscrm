ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS created_by_doctor_id BIGINT NULL REFERENCES doctors (id),
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_created_by_doctor_id
  ON appointments (created_by_doctor_id)
  WHERE created_by_doctor_id IS NOT NULL;
