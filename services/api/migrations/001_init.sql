-- Kamilovs CRM — extensions (optional helpers for future UUID / crypto columns)
-- Domain PKs: BIGSERIAL — совместимость с текущим API (числовые id в JSON).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
