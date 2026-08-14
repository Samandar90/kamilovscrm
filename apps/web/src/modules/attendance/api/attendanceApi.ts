import { requestJson } from "../../../api/http";

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
  workDate: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  markedBy: number | null;
  markedByName: string | null;
  updatedAt: string;
};

export type AttendanceUpsertInput = {
  userId: number;
  workDate: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
};

export type AttendanceSummaryRow = {
  userId: number;
  counts: Record<AttendanceStatus, number>;
};

export const attendanceApi = {
  listByDate: (date: string) =>
    requestJson<AttendanceRecord[]>(`/api/attendance?date=${date}`),

  summary: (month: string) =>
    requestJson<AttendanceSummaryRow[]>(`/api/attendance/summary?month=${month}`),

  upsert: (input: AttendanceUpsertInput) =>
    requestJson<AttendanceRecord>("/api/attendance", { method: "PUT", body: input }),

  remove: (userId: number, workDate: string) =>
    requestJson<{ success: boolean }>(`/api/attendance/${userId}/${workDate}`, {
      method: "DELETE",
    }),
};
