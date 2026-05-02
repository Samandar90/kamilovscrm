-- Мультитенантность: каждая строка кассы привязана к клинике (как payments / invoices).

ALTER TABLE cash_register_entries
  ADD COLUMN IF NOT EXISTS clinic_id BIGINT;

UPDATE cash_register_entries AS e
SET clinic_id = p.clinic_id
FROM payments AS p
WHERE e.payment_id IS NOT NULL
  AND e.payment_id = p.id
  AND e.clinic_id IS NULL;

UPDATE cash_register_entries AS e
SET clinic_id = sub.cid
FROM (
  SELECT
    e1.id,
    (
      SELECT e2.clinic_id
      FROM cash_register_entries e2
      WHERE e2.shift_id = e1.shift_id
        AND e2.clinic_id IS NOT NULL
      LIMIT 1
    ) AS cid
  FROM cash_register_entries e1
  WHERE e1.clinic_id IS NULL
) AS sub
WHERE e.id = sub.id
  AND sub.cid IS NOT NULL;

UPDATE cash_register_entries
SET clinic_id = 1
WHERE clinic_id IS NULL;

ALTER TABLE cash_register_entries
  ALTER COLUMN clinic_id SET NOT NULL;
