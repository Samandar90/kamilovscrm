-- Audit: who registered the patient (doctor workflow vs reception).

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS created_by_doctor_id BIGINT NULL REFERENCES doctors (id) ON DELETE SET NULL;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_created_by_doctor_active
  ON patients (created_by_doctor_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patients_created_by_user_active
  ON patients (created_by_user_id)
  WHERE deleted_at IS NULL;
