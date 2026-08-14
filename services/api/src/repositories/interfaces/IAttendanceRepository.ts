import type {
  AttendanceRecord,
  AttendanceSummaryRow,
  AttendanceUpsertInput,
} from "./attendanceTypes";

export interface IAttendanceRepository {
  /** Отметки клиники за один день. */
  listByDate(workDate: string): Promise<AttendanceRecord[]>;
  /** Полная замена отметки сотрудника за день (INSERT … ON CONFLICT). */
  upsert(input: AttendanceUpsertInput): Promise<AttendanceRecord>;
  /** Снять отметку. true, если запись была. */
  remove(userId: number, workDate: string): Promise<boolean>;
  /** Счётчики статусов по сотрудникам за полуинтервал [dateFrom, dateTo). */
  summary(dateFrom: string, dateTo: string): Promise<AttendanceSummaryRow[]>;
}
