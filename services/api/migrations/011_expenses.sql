CREATE TABLE expenses (
  id BIGSERIAL PRIMARY KEY,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL CHECK (char_length(trim(category)) > 0),
  description TEXT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_expenses_paid_at_active
  ON expenses (paid_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_expenses_category_paid_at_active
  ON expenses (category, paid_at DESC)
  WHERE deleted_at IS NULL;

