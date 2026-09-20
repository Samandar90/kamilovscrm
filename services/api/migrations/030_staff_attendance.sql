-- Посещаемость сотрудников: одна отметка на сотрудника в день.
-- Отмечает только админ (RBAC-модуль attendance, по умолчанию — superadmin);
-- marked_by фиксирует, кто поставил отметку.
-- check_in / check_out — «настенное» время клиники (TIME, без таймзоны),
-- как и REPORTS_TIMEZONE-логика в отчётах.

CREATE TABLE IF NOT EXISTS staff_attendance (
  id BIGSERIAL PRIMARY KEY,
  clinic_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('present', 'late', 'absent', 'sick', 'vacation', 'day_off')
  ),
  check_in TIME NULL,
  check_out TIME NULL,
  note TEXT NULL,
  marked_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, user_id, work_date)
);

-- Дневной табель и месячная сводка ходят по (clinic_id, work_date).
CREATE INDEX IF NOT EXISTS idx_staff_attendance_clinic_date
  ON staff_attendance (clinic_id, work_date);
