-- Платформенный администратор SaaS (владелец): управляет подписками всех клиник.
-- Отличается от per-clinic superadmin — действует поверх всех клиник.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Суперадмин основателя (клиника 1) — платформенный владелец.
UPDATE users
SET is_platform_admin = TRUE
WHERE clinic_id = 1
  AND role = 'superadmin'
  AND deleted_at IS NULL;
