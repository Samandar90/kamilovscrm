-- SaaS-подписки (единый тариф, ручная оплата, trial 14 дней).
-- Поля живут на clinics: статус и дата окончания доступа.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing';

-- NULL = без срока (безлимит). Иначе доступ валиден до этого момента.
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

ALTER TABLE clinics
  DROP CONSTRAINT IF EXISTS clinics_subscription_status_chk;
ALTER TABLE clinics
  ADD CONSTRAINT clinics_subscription_status_chk
  CHECK (subscription_status IN ('trialing', 'active', 'expired', 'suspended'));

-- Существующие клиники предшествуют системе подписок и являются «владельцами» —
-- делаем их active без срока, чтобы живую систему не заблокировать enforcement-ом.
UPDATE clinics
SET subscription_status = 'active',
    subscription_ends_at = NULL
WHERE subscription_status = 'trialing'
  AND created_at < now();
