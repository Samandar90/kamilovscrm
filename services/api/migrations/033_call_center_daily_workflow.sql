-- Additive only. Existing call history and patient records are preserved.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recommended_return_date DATE NULL;
CREATE INDEX IF NOT EXISTS idx_call_recommended_return ON appointments(clinic_id, recommended_return_date, patient_id)
  WHERE recommended_return_date IS NOT NULL AND deleted_at IS NULL AND status = 'completed';

CREATE TABLE IF NOT EXISTS call_center_patient_preferences (
  clinic_id BIGINT NOT NULL REFERENCES clinics(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  do_not_call BOOLEAN NOT NULL DEFAULT false,
  preferred_language TEXT NULL CHECK (preferred_language IN ('ru', 'uz')),
  preferred_call_start TIME NULL,
  preferred_call_end TIME NULL,
  updated_by BIGINT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, patient_id),
  CHECK ((preferred_call_start IS NULL AND preferred_call_end IS NULL)
    OR (preferred_call_start IS NOT NULL AND preferred_call_end IS NOT NULL AND preferred_call_start < preferred_call_end))
);
