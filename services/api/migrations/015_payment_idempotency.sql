-- Идемпотентность создания платежа (опциональный ключ с клиента).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

-- Один активный (не аннулированный) платёж на ключ; у удалённых ключ не участвует.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_active
  ON payments (idempotency_key)
  WHERE deleted_at IS NULL AND idempotency_key IS NOT NULL;
