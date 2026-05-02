-- Снимок цены и количества по строке записи (источник для счёта — appointment_services, не services.price).

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2);

UPDATE appointment_services
SET price = 0
WHERE price IS NULL;

UPDATE appointment_services
SET quantity = 1
WHERE quantity IS NULL OR quantity <= 0;

ALTER TABLE appointment_services
  ALTER COLUMN price SET DEFAULT 0,
  ALTER COLUMN price SET NOT NULL;

ALTER TABLE appointment_services
  ALTER COLUMN quantity SET DEFAULT 1,
  ALTER COLUMN quantity SET NOT NULL;

ALTER TABLE appointment_services
  DROP CONSTRAINT IF EXISTS appointment_services_price_non_negative;

ALTER TABLE appointment_services
  ADD CONSTRAINT appointment_services_price_non_negative CHECK (price >= 0);

ALTER TABLE appointment_services
  DROP CONSTRAINT IF EXISTS appointment_services_quantity_positive;

ALTER TABLE appointment_services
  ADD CONSTRAINT appointment_services_quantity_positive CHECK (quantity > 0);

-- Существующие строки без цены: подставить каталожную (разовый снимок для старых данных).
UPDATE appointment_services aps
SET price = s.price::numeric
FROM services s
WHERE aps.service_id = s.id
  AND aps.price = 0;

-- Записи без ни одной строки в appointment_services: добавить основную услугу из appointments.
INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
SELECT a.id,
       a.service_id,
       COALESCE(a.price::numeric, s.price::numeric, 0),
       1,
       NULL
FROM appointments a
INNER JOIN services s ON s.id = a.service_id
WHERE a.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM appointment_services x
    WHERE x.appointment_id = a.id
  );

-- Основная услуга записи отсутствует среди строк (есть только дополнительные): добавить.
INSERT INTO appointment_services (appointment_id, service_id, price, quantity, created_by)
SELECT a.id,
       a.service_id,
       COALESCE(a.price::numeric, s.price::numeric, 0),
       1,
       NULL
FROM appointments a
INNER JOIN services s ON s.id = a.service_id
WHERE a.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM appointment_services x
    WHERE x.appointment_id = a.id
      AND x.service_id = a.service_id
  );
