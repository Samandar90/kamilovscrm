import { requireClinicId } from "../tenancy/clinicContext";
import type { IAttendanceRepository } from "./interfaces/IAttendanceRepository";
import type {
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRow,
  AttendanceUpsertInput,
} from "./interfaces/attendanceTypes";
import { ATTENDANCE_STATUSES } from "./interfaces/attendanceTypes";
import { getMockDb, nextId } from "./mockDatabase";

type MockAttendanceRow = AttendanceRecord & { clinicId: number };

/** In-memory отметки (dev-режим DATA_PROVIDER=mock). */
const rows: MockAttendanceRow[] = [];

const emptyCounts = (): Record<AttendanceStatus, number> =>
  Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>;

const userName = (userId: number | null): string | null => {
  if (userId == null) return null;
  const user = getMockDb().users.find((u) => u.id === userId);
  return user?.fullName ?? null;
};

export class MockAttendanceRepository implements IAttendanceRepository {
  async listByDate(workDate: string): Promise<AttendanceRecord[]> {
    const clinicId = requireClinicId();
    return rows
      .filter((r) => r.clinicId === clinicId && r.workDate === workDate)
      .map(({ clinicId: _c, ...record }) => ({
        ...record,
        markedByName: userName(record.markedBy),
      }));
  }

  async upsert(input: AttendanceUpsertInput): Promise<AttendanceRecord> {
    const clinicId = requireClinicId();
    const now = new Date().toISOString();
    let row = rows.find(
      (r) => r.clinicId === clinicId && r.userId === input.userId && r.workDate === input.workDate
    );
    if (!row) {
      row = {
        clinicId,
        id: nextId(),
        userId: input.userId,
        workDate: input.workDate,
        status: input.status,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        note: input.note,
        markedBy: input.markedBy,
        markedByName: null,
        updatedAt: now,
      };
      rows.push(row);
    } else {
      row.status = input.status;
      row.checkIn = input.checkIn;
      row.checkOut = input.checkOut;
      row.note = input.note;
      row.markedBy = input.markedBy;
      row.updatedAt = now;
    }
    const { clinicId: _c, ...record } = row;
    return { ...record, markedByName: userName(record.markedBy) };
  }

  async remove(userId: number, workDate: string): Promise<boolean> {
    const clinicId = requireClinicId();
    const index = rows.findIndex(
      (r) => r.clinicId === clinicId && r.userId === userId && r.workDate === workDate
    );
    if (index === -1) return false;
    rows.splice(index, 1);
    return true;
  }

  async summary(dateFrom: string, dateTo: string): Promise<AttendanceSummaryRow[]> {
    const clinicId = requireClinicId();
    const byUser = new Map<number, AttendanceSummaryRow>();
    for (const row of rows) {
      if (row.clinicId !== clinicId) continue;
      if (row.workDate < dateFrom || row.workDate >= dateTo) continue;
      let entry = byUser.get(row.userId);
      if (!entry) {
        entry = { userId: row.userId, counts: emptyCounts() };
        byUser.set(row.userId, entry);
      }
      entry.counts[row.status] += 1;
    }
    return [...byUser.values()];
  }
}
