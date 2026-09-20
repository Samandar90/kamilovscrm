CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  refunded_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  void_reason TEXT NULL,
  CONSTRAINT payments_refund_lte_amount CHECK (refunded_amount <= amount + 0.000001)
);

CREATE INDEX idx_payments_invoice_created
  ON payments (invoice_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_payments_method_created
  ON payments (method, created_at DESC)
  WHERE deleted_at IS NULL;
