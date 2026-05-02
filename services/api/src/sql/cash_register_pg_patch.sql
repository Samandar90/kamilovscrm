CREATE TABLE IF NOT EXISTS cash_register_shifts (
  id BIGSERIAL PRIMARY KEY,
  opened_by BIGINT NULL,
  closed_by BIGINT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  closing_balance NUMERIC(12,2) NULL CHECK (closing_balance >= 0),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_register_entries (
  id BIGSERIAL PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES cash_register_shifts(id),
  payment_id BIGINT NULL REFERENCES payments(id),
  type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'manual_in', 'manual_out')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clinic_id BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_single_active_shift
ON cash_register_shifts ((closed_at IS NULL))
WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_register_entries_shift_created
ON cash_register_entries (shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_register_entries_payment
ON cash_register_entries (payment_id);

CREATE INDEX IF NOT EXISTS idx_cash_register_entries_method_created
ON cash_register_entries (method, created_at DESC);

ALTER TABLE cash_register_entries DROP CONSTRAINT IF EXISTS cash_register_entries_type_check;
ALTER TABLE cash_register_entries DROP CONSTRAINT IF EXISTS cash_register_entries_amount_check;

ALTER TABLE cash_register_entries
  ADD CONSTRAINT cash_register_entries_type_check
  CHECK (type IN ('payment', 'refund', 'manual_in', 'manual_out', 'void'));

ALTER TABLE cash_register_entries
  ADD CONSTRAINT cash_register_entries_amount_check
  CHECK (amount <> 0);
