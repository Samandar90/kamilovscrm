-- 037_users_role_marketer.sql
-- Новая роль "marketer": аккаунт внешнего таргетолога.
-- Список ролей проверяет API (src/auth/permissions.ts). В production ограничения на users.role нет,
-- там этот файл ничего не меняет. В базе, собранной из файлов, users_role_check из 002_users.sql
-- перечисляет девять старых ролей и не пустил бы новую. Ограничение не возвращается: значения
-- ролей в production не проверены. Только DROP: строки не читаются, повторный запуск безопасен.
-- BEGIN/COMMIT добавляет db-migrate.cjs.
SET LOCAL lock_timeout = '5s';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
