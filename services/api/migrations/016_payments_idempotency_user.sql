-- Идемпотентность по паре (пользователь, ключ); автор платежа; разделение клиентского ключа и серверного UUID.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS created_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key_client_supplied BOOLEAN NOT NULL DEFAULT false;

-- Старые строки с ключом от клиента (015): помечаем как client-supplied.
UPDATE payments
SET idempotency_key_client_supplied = true
WHERE idempotency_key IS NOT NULL;

-- Остальным — серверный UUID (не участвует в replay по ключу).
UPDATE payments
SET idempotency_key = gen_random_uuid()::text
WHERE idempotency_key IS NULL;

ALTER TABLE payments
  ALTER COLUMN idempotency_key SET NOT NULL;

DROP INDEX IF EXISTS uq_payments_idempotency_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_user_client
  ON payments (created_by, idempotency_key)
  WHERE deleted_at IS NULL
    AND idempotency_key_client_supplied = true
    AND created_by IS NOT NULL;
