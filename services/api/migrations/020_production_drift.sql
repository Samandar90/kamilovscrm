-- Production schema that predates the migration log, so a fresh database matches it.
-- Production was built by hand before schema_migrations existed: it has clinics and
-- clinic_id columns that no earlier file creates (021, 027, 028 need them), and it
-- never received the NOT NULLs, checks, foreign keys and indexes that 001-020 declare.
-- This file adds the first and removes the second; 021-034 then complete the schema.
--
-- Production records this file without running it (npm start passes
-- --baseline=031_call_reminders.sql). Every statement is idempotent and changes
-- nothing on a database that already has production's schema.
--
-- Left as is: extensions (pgcrypto from 001 here, uuid-ossp in production; the code
-- uses neither), column order, and the two partial indexes 022 creates after this file
-- (idx_patients_created_by_doctor_active, idx_patients_created_by_user_active).

-- Added: tables, columns, indexes and constraints production has.

CREATE TABLE IF NOT EXISTS clinics (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  slug TEXT,
  logo_url TEXT,
  primary_color TEXT
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL;
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_doctor_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_doctor_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS cancelled_by_role VARCHAR(30);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clinic_id BIGINT NOT NULL DEFAULT 1;
-- 021, 024, 025 and 026 backfill these and make them NOT NULL.
ALTER TABLE cash_register_entries ADD COLUMN IF NOT EXISTS clinic_id BIGINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS clinic_id BIGINT;
ALTER TABLE cash_register_shifts ADD COLUMN IF NOT EXISTS clinic_id BIGINT;
ALTER TABLE nurses ADD COLUMN IF NOT EXISTS clinic_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_users_clinic_id ON users (clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients (clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_created_by_doctor_id ON patients (created_by_doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctors_clinic_id ON doctors (clinic_id);
CREATE INDEX IF NOT EXISTS idx_doctors_phone ON doctors (phone);
CREATE INDEX IF NOT EXISTS idx_services_clinic_id ON services (clinic_id);
CREATE INDEX IF NOT EXISTS idx_services_active ON services (active);
CREATE INDEX IF NOT EXISTS idx_services_deleted ON services (deleted_at);
CREATE INDEX IF NOT EXISTS idx_services_name ON services (name);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id ON appointments (clinic_id);
-- Same name as 023's partial index, so 023 keeps this one.
CREATE INDEX IF NOT EXISTS idx_appointments_created_by_doctor_id ON appointments (created_by_doctor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_clinic_id ON invoices (clinic_id);
CREATE INDEX IF NOT EXISTS idx_payments_clinic_id ON payments (clinic_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_clinic_id ON cash_register_entries (clinic_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_shifts_clinic_id ON cash_register_shifts (clinic_id);
CREATE INDEX IF NOT EXISTS idx_expenses_clinic_id ON expenses (clinic_id);
CREATE INDEX IF NOT EXISTS idx_nurses_clinic_id ON nurses (clinic_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_clinic_id_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES clinics (id);
  END IF;
  -- One invoice per appointment, ever (001-020 had a partial index for active invoices only).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND conname = 'unique_appointment_invoice') THEN
    ALTER TABLE invoices ADD CONSTRAINT unique_appointment_invoice UNIQUE (appointment_id);
  END IF;
END $$;

-- Removed: what 001-020 declare but production never had.

DROP TABLE IF EXISTS auth_otp_codes;

DROP INDEX IF EXISTS
  uq_users_username_active,
  idx_users_active_not_deleted,
  uq_users_doctor_profile_one_account,
  idx_patients_active_created,
  idx_patients_phone_active,
  idx_doctors_active_name,
  uq_services_code_active,
  idx_doctor_services_service_id,
  idx_appointments_patient_start,
  idx_appointments_doctor_start,
  idx_appointments_service_start,
  uq_invoices_active_appointment,
  idx_invoices_patient_created_active,
  idx_invoices_status_created_active,
  idx_invoices_id_active,
  idx_invoice_items_invoice_id,
  idx_payments_invoice_created,
  idx_payments_method_created,
  idx_payments_created_active,
  uq_payments_idempotency_user_client,
  uq_cash_register_single_active_shift,
  idx_cash_register_entries_shift_created,
  idx_cash_register_entries_payment,
  idx_cash_register_entries_method_created,
  idx_nurses_doctor_id,
  idx_login_audit_created,
  idx_login_audit_username_created,
  idx_ai_messages_user_created,
  idx_expenses_paid_at_active,
  idx_expenses_category_paid_at_active;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check,
  DROP CONSTRAINT IF EXISTS users_failed_login_attempts_check,
  DROP CONSTRAINT IF EXISTS users_failed_login_reasonable,
  DROP CONSTRAINT IF EXISTS users_doctor_id_fkey,
  ALTER COLUMN is_active DROP NOT NULL,
  ALTER COLUMN onboarding_completed DROP NOT NULL,
  ALTER COLUMN two_factor_enabled DROP NOT NULL,
  ALTER COLUMN failed_login_attempts DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_full_name_check,
  DROP CONSTRAINT IF EXISTS patients_gender_check,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE doctors
  DROP CONSTRAINT IF EXISTS doctors_full_name_check,
  DROP CONSTRAINT IF EXISTS doctors_percent_check,
  ALTER COLUMN specialty DROP NOT NULL,
  ALTER COLUMN specialty DROP DEFAULT,
  ALTER COLUMN percent DROP NOT NULL,
  ALTER COLUMN percent DROP DEFAULT,
  ALTER COLUMN active DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_name_check,
  DROP CONSTRAINT IF EXISTS services_duration_check,
  DROP COLUMN IF EXISTS code,
  DROP COLUMN IF EXISTS category,
  ALTER COLUMN price DROP NOT NULL,
  ALTER COLUMN duration DROP NOT NULL,
  ALTER COLUMN active DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check,
  DROP CONSTRAINT IF EXISTS appointments_time_order,
  ALTER COLUMN patient_id DROP NOT NULL,
  ALTER COLUMN doctor_id DROP NOT NULL,
  ALTER COLUMN service_id DROP NOT NULL,
  ALTER COLUMN start_at DROP NOT NULL,
  ALTER COLUMN end_at DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE appointment_services
  DROP CONSTRAINT IF EXISTS appointment_services_price_non_negative,
  DROP CONSTRAINT IF EXISTS appointment_services_quantity_positive;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_number_key,
  DROP CONSTRAINT IF EXISTS invoices_appointment_id_fkey,
  DROP CONSTRAINT IF EXISTS invoices_status_check,
  DROP CONSTRAINT IF EXISTS invoices_subtotal_check,
  DROP CONSTRAINT IF EXISTS invoices_discount_check,
  DROP CONSTRAINT IF EXISTS invoices_total_check,
  DROP CONSTRAINT IF EXISTS invoices_paid_amount_check,
  DROP CONSTRAINT IF EXISTS invoices_discount_le_subtotal,
  ALTER COLUMN number DROP NOT NULL,
  ALTER COLUMN number DROP DEFAULT,
  ALTER COLUMN patient_id DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN subtotal DROP NOT NULL,
  ALTER COLUMN subtotal DROP DEFAULT,
  ALTER COLUMN discount DROP NOT NULL,
  ALTER COLUMN discount DROP DEFAULT,
  ALTER COLUMN total DROP NOT NULL,
  ALTER COLUMN paid_amount DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;
DROP SEQUENCE IF EXISTS invoices_number_seq;

ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_service_id_fkey,
  DROP CONSTRAINT IF EXISTS invoice_items_quantity_check,
  DROP CONSTRAINT IF EXISTS invoice_items_unit_price_check,
  DROP CONSTRAINT IF EXISTS invoice_items_line_total_check,
  ALTER COLUMN invoice_id DROP NOT NULL,
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN unit_price DROP NOT NULL,
  ALTER COLUMN line_total DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_created_by_fkey,
  DROP CONSTRAINT IF EXISTS payments_amount_check,
  DROP CONSTRAINT IF EXISTS payments_refunded_amount_check,
  DROP CONSTRAINT IF EXISTS payments_method_check,
  DROP CONSTRAINT IF EXISTS payments_refund_lte_amount,
  ALTER COLUMN invoice_id DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL,
  ALTER COLUMN refunded_amount DROP NOT NULL,
  ALTER COLUMN method DROP NOT NULL,
  ALTER COLUMN idempotency_key DROP NOT NULL,
  ALTER COLUMN idempotency_key_client_supplied DROP NOT NULL,
  ALTER COLUMN idempotency_key_client_supplied DROP DEFAULT,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE cash_register_shifts
  DROP CONSTRAINT IF EXISTS cash_register_shifts_opened_by_fkey,
  DROP CONSTRAINT IF EXISTS cash_register_shifts_closed_by_fkey,
  DROP CONSTRAINT IF EXISTS cash_register_shifts_opening_balance_check,
  DROP CONSTRAINT IF EXISTS cash_register_shifts_closing_balance_check,
  ALTER COLUMN opened_at DROP NOT NULL,
  ALTER COLUMN opening_balance DROP NOT NULL,
  ALTER COLUMN opening_balance DROP DEFAULT,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE cash_register_entries
  DROP CONSTRAINT IF EXISTS cash_register_entries_payment_id_fkey,
  DROP CONSTRAINT IF EXISTS cash_register_entries_type_check,
  DROP CONSTRAINT IF EXISTS cash_register_entries_amount_check,
  DROP CONSTRAINT IF EXISTS cash_register_entries_method_check,
  ALTER COLUMN shift_id DROP NOT NULL,
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL,
  ALTER COLUMN method DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL;

ALTER TABLE nurses
  DROP CONSTRAINT IF EXISTS nurses_user_id_fkey,
  DROP CONSTRAINT IF EXISTS nurses_doctor_id_fkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN doctor_id DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL;

ALTER TABLE login_audit_logs
  DROP CONSTRAINT IF EXISTS login_audit_logs_user_id_fkey,
  ALTER COLUMN username DROP NOT NULL,
  ALTER COLUMN success DROP NOT NULL,
  ALTER COLUMN reason DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL;

ALTER TABLE ai_messages
  DROP CONSTRAINT IF EXISTS ai_messages_user_id_fkey,
  DROP CONSTRAINT IF EXISTS ai_messages_role_check,
  DROP CONSTRAINT IF EXISTS ai_messages_content_check,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN role DROP NOT NULL,
  ALTER COLUMN content DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL;

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_amount_check,
  DROP CONSTRAINT IF EXISTS expenses_category_check,
  ALTER COLUMN amount DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN paid_at DROP NOT NULL,
  ALTER COLUMN created_at DROP NOT NULL;

-- Production's column types (plain numeric where 001-020 fix a precision). Only columns that
-- differ are altered, so on production's schema nothing is rebuilt.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('doctors', 'phone', 'character varying(20)'),
      ('services', 'price', 'numeric'),
      ('appointment_services', 'quantity', 'integer'),
      ('invoices', 'subtotal', 'numeric'),
      ('invoices', 'discount', 'numeric'),
      ('invoices', 'total', 'numeric'),
      ('invoices', 'paid_amount', 'numeric'),
      ('invoice_items', 'quantity', 'numeric'),
      ('invoice_items', 'unit_price', 'numeric'),
      ('invoice_items', 'line_total', 'numeric'),
      ('payments', 'amount', 'numeric'),
      ('payments', 'refunded_amount', 'numeric'),
      ('cash_register_shifts', 'opening_balance', 'numeric'),
      ('cash_register_shifts', 'closing_balance', 'numeric'),
      ('cash_register_entries', 'amount', 'numeric'),
      ('expenses', 'amount', 'numeric')
    ) AS v (tbl, col, type)
  LOOP
    IF (
      SELECT format_type(atttypid, atttypmod) FROM pg_attribute
      WHERE attrelid = c.tbl::regclass AND attname = c.col
    ) <> c.type THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s', c.tbl, c.col, c.type);
    END IF;
  END LOOP;
END $$;

-- Production's foreign keys use the default NO ACTION where 001-020 say RESTRICT or CASCADE.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('appointments', 'appointments_patient_id_fkey', 'patient_id', 'patients'),
      ('appointments', 'appointments_doctor_id_fkey', 'doctor_id', 'doctors'),
      ('appointments', 'appointments_service_id_fkey', 'service_id', 'services'),
      ('invoices', 'invoices_patient_id_fkey', 'patient_id', 'patients'),
      ('payments', 'payments_invoice_id_fkey', 'invoice_id', 'invoices'),
      ('cash_register_entries', 'cash_register_entries_shift_id_fkey', 'shift_id', 'cash_register_shifts')
    ) AS v (tbl, name, col, ref)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = fk.tbl::regclass AND conname = fk.name AND confdeltype <> 'a'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id)',
        fk.tbl, fk.name, fk.name, fk.col, fk.ref
      );
    END IF;
  END LOOP;
END $$;
