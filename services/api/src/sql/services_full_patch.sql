-- Full CRM service fields + non-negative price (run after baseline services table exists;
-- apply services_duration_patch.sql first if duration column is missing.)

ALTER TABLE services
ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 30;

ALTER TABLE services
ADD COLUMN IF NOT EXISTS category VARCHAR(128) NOT NULL DEFAULT 'other';

ALTER TABLE services
ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_duration_positive'
  ) THEN
    ALTER TABLE services
    ADD CONSTRAINT services_duration_positive CHECK (duration > 0);
  END IF;
END
$$;

UPDATE services
SET price = 0
WHERE price IS NOT NULL
  AND price < 0
  AND deleted_at IS NULL;

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_price_check;

ALTER TABLE services
ADD CONSTRAINT services_price_check CHECK (price >= 0);
