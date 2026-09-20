-- Сторно аннулирования платежа: тип void, сумма может быть отрицательной (обратное движение к приходу).
ALTER TABLE cash_register_entries DROP CONSTRAINT IF EXISTS cash_register_entries_type_check;
ALTER TABLE cash_register_entries DROP CONSTRAINT IF EXISTS cash_register_entries_amount_check;

ALTER TABLE cash_register_entries
  ADD CONSTRAINT cash_register_entries_type_check
  CHECK (type IN ('payment', 'refund', 'manual_in', 'manual_out', 'void'));

ALTER TABLE cash_register_entries
  ADD CONSTRAINT cash_register_entries_amount_check
  CHECK (amount <> 0);
