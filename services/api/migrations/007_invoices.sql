CREATE SEQUENCE invoices_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE DEFAULT (
    'INV-' || lpad(nextval('invoices_number_seq')::text, 8, '0')
  ),
  patient_id BIGINT NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  appointment_id BIGINT NULL REFERENCES appointments (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'issued',
      'partially_paid',
      'paid',
      'cancelled',
      'refunded'
    )
  ),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT invoices_discount_le_subtotal CHECK (discount <= subtotal + 0.000001)
);

CREATE UNIQUE INDEX uq_invoices_active_appointment
  ON invoices (appointment_id)
  WHERE
    appointment_id IS NOT NULL
    AND deleted_at IS NULL
    AND status IN ('draft', 'issued', 'partially_paid', 'paid');

CREATE INDEX idx_invoices_patient_created_active
  ON invoices (patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_invoices_status_created_active
  ON invoices (status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  service_id BIGINT NULL REFERENCES services (id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice_id
  ON invoice_items (invoice_id);
