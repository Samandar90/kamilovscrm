export const ATTENDANCE_STATUSES = [
  "present",
  "late",
  "absent",
  "sick",
  "vacation",
  "day_off",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceRecord = {
  id: number;
  userId: number;
  /** YYYY-MM-DD (настенная дата клиники). */
  workDate: string;
  status: AttendanceStatus;
  /** HH:MM либо null. */
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  markedBy: number | null;
  markedByName: string | null;
  updatedAt: string;
};

/** Upsert всегда несёт полное желаемое состояние отметки за день (не патч). */
export type AttendanceUpsertInput = {
  userId: number;
  workDate: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  markedBy: number;
};

export type AttendanceSummaryRow = {
  userId: number;
  counts: Record<AttendanceStatus, number>;
};
