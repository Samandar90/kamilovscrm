import { ApiError } from "../middleware/errorHandler";
import type { IAttendanceRepository } from "../repositories/interfaces/IAttendanceRepository";
import type { IUsersRepository } from "../repositories/interfaces/IUsersRepository";
import type {
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRow,
} from "../repositories/interfaces/attendanceTypes";
import { ATTENDANCE_STATUSES } from "../repositories/interfaces/attendanceTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const parseDate = (raw: unknown): string => {
  const value = String(raw ?? "").trim();
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, "Дата должна быть в формате YYYY-MM-DD");
  }
  return value;
};

const parseTime = (raw: unknown, field: string): string | null => {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();
  if (!TIME_RE.test(value)) {
    throw new ApiError(400, `${field}: время должно быть в формате HH:MM`);
  }
  return value;
};

/** Полуинтервал месяца [первое число, первое число следующего месяца). */
const monthBounds = (raw: unknown): { dateFrom: string; dateTo: string } => {
  const value = String(raw ?? "").trim();
  if (!MONTH_RE.test(value)) {
    throw new ApiError(400, "Месяц должен быть в формате YYYY-MM");
  }
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) {
    throw new ApiError(400, "Месяц должен быть в формате YYYY-MM");
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    dateFrom: `${year}-${pad(month)}-01`,
    dateTo: `${nextYear}-${pad(nextMonth)}-01`,
  };
};

export type AttendanceUpsertBody = {
  userId?: unknown;
  workDate?: unknown;
  status?: unknown;
  checkIn?: unknown;
  checkOut?: unknown;
  note?: unknown;
};

export class AttendanceService {
  constructor(
    private readonly attendanceRepository: IAttendanceRepository,
    private readonly usersRepository: IUsersRepository
  ) {}

  async listByDate(_auth: AuthTokenPayload, rawDate: unknown): Promise<AttendanceRecord[]> {
    return this.attendanceRepository.listByDate(parseDate(rawDate));
  }

  async upsert(auth: AuthTokenPayload, body: AttendanceUpsertBody): Promise<AttendanceRecord> {
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new ApiError(400, "userId is required");
    }
    const workDate = parseDate(body.workDate);

    const status = String(body.status ?? "") as AttendanceStatus;
    if (!ATTENDANCE_STATUSES.includes(status)) {
      throw new ApiError(400, `Недопустимый статус: ${String(body.status)}`);
    }

    const checkIn = parseTime(body.checkIn, "checkIn");
    const checkOut = parseTime(body.checkOut, "checkOut");
    if (checkIn && checkOut && checkOut < checkIn) {
      throw new ApiError(400, "Время ухода раньше времени прихода");
    }

    const note = body.note == null ? null : String(body.note).trim() || null;
    if (note && note.length > 500) {
      throw new ApiError(400, "Заметка длиннее 500 символов");
    }

    const target = await this.usersRepository.findById(userId);
    if (!target || target.clinicId !== auth.clinicId) {
      throw new ApiError(404, "Сотрудник не найден");
    }

    return this.attendanceRepository.upsert({
      userId,
      workDate,
      status,
      checkIn,
      checkOut,
      note,
      markedBy: auth.userId,
    });
  }

  async remove(auth: AuthTokenPayload, rawUserId: unknown, rawDate: unknown): Promise<boolean> {
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new ApiError(400, "userId is required");
    }
    const target = await this.usersRepository.findById(userId);
    if (!target || target.clinicId !== auth.clinicId) {
      throw new ApiError(404, "Сотрудник не найден");
    }
    return this.attendanceRepository.remove(userId, parseDate(rawDate));
  }

  async summary(_auth: AuthTokenPayload, rawMonth: unknown): Promise<AttendanceSummaryRow[]> {
    const { dateFrom, dateTo } = monthBounds(rawMonth);
    return this.attendanceRepository.summary(dateFrom, dateTo);
  }
}
