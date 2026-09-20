CREATE TABLE cash_register_shifts (
  id BIGSERIAL PRIMARY KEY,
  opened_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL,
  closed_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ NULL,
  opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  closing_balance NUMERIC(12, 2) NULL CHECK (closing_balance IS NULL OR closing_balance >= 0),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Не более одной открытой смены (closed_at IS NULL).
CREATE UNIQUE INDEX uq_cash_register_single_active_shift
  ON cash_register_shifts ((1))
  WHERE closed_at IS NULL;

CREATE TABLE cash_register_entries (
  id BIGSERIAL PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES cash_register_shifts (id) ON DELETE CASCADE,
  payment_id BIGINT NULL REFERENCES payments (id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (
    type IN ('payment', 'refund', 'manual_in', 'manual_out')
  ),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_register_entries_shift_created
  ON cash_register_entries (shift_id, created_at DESC);

CREATE INDEX idx_cash_register_entries_payment
  ON cash_register_entries (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX idx_cash_register_entries_method_created
  ON cash_register_entries (method, created_at DESC);
