import { requireClinicId } from "../tenancy/clinicContext";
import type { ICallCenterRepository } from "./interfaces/ICallCenterRepository";
import type {
  CallMarkInput,
  CallQueueItem,
  CallReminderLog,
  CallReminderRule,
} from "./interfaces/callCenterTypes";
import { getMockDb, nextId } from "./mockDatabase";

type MockRule = CallReminderRule & { clinicId: number };
type MockLog = CallReminderLog & {
  clinicId: number;
  appointmentId: number;
  daysBefore: number;
};

/** In-memory состояние (dev-режим DATA_PROVIDER=mock). */
const rules: MockRule[] = [];
const logs: MockLog[] = [];

/** startAt в mock — ISO-строка «настенного» времени; дата — первые 10 символов. */
const wallDate = (startAt: string): string => startAt.slice(0, 10);
const wallTime = (startAt: string): string => startAt.slice(11, 16);

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const userName = (userId: number | null): string | null => {
  if (userId == null) return null;
  return getMockDb().users.find((u) => u.id === userId)?.fullName ?? null;
};

export class MockCallCenterRepository implements ICallCenterRepository {
  async listRules(): Promise<CallReminderRule[]> {
    const clinicId = requireClinicId();
    return rules
      .filter((r) => r.clinicId === clinicId)
      .sort((a, b) => b.daysBefore - a.daysBefore)
      .map(({ clinicId: _c, ...rule }) => rule);
  }

  async addRule(daysBefore: number): Promise<CallReminderRule> {
    const clinicId = requireClinicId();
    const existing = rules.find((r) => r.clinicId === clinicId && r.daysBefore === daysBefore);
    if (existing) {
      const { clinicId: _c, ...rule } = existing;
      return rule;
    }
    const created: MockRule = { clinicId, id: nextId(), daysBefore };
    rules.push(created);
    return { id: created.id, daysBefore: created.daysBefore };
  }

  async removeRule(id: number): Promise<boolean> {
    const clinicId = requireClinicId();
    const index = rules.findIndex((r) => r.clinicId === clinicId && r.id === id);
    if (index === -1) return false;
    rules.splice(index, 1);
    return true;
  }

  async queueForDate(callDate: string): Promise<CallQueueItem[]> {
    const clinicId = requireClinicId();
    const db = getMockDb();
    const items: CallQueueItem[] = [];
    for (const rule of rules.filter((r) => r.clinicId === clinicId)) {
      const targetDate = addDays(callDate, rule.daysBefore);
      for (const appt of db.appointments) {
        if (appt.status !== "scheduled" && appt.status !== "confirmed") continue;
        if (wallDate(appt.startAt) !== targetDate) continue;
        const patient = db.patients.find((p) => p.id === appt.patientId);
        const doctor = db.doctors.find((d) => d.id === appt.doctorId);
        const log =
          logs.find(
            (l) =>
              l.clinicId === clinicId &&
              l.appointmentId === appt.id &&
              l.daysBefore === rule.daysBefore
          ) ?? null;
        items.push({
          appointmentId: appt.id,
          daysBefore: rule.daysBefore,
          patientId: appt.patientId,
          patientName: patient?.fullName ?? `#${appt.patientId}`,
          patientPhone: patient?.phone ?? null,
          doctorName: doctor?.name ?? `#${appt.doctorId}`,
          appointmentDate: wallDate(appt.startAt),
          appointmentTime: wallTime(appt.startAt),
          appointmentStatus: appt.status,
          log: log
            ? {
                outcome: log.outcome,
                note: log.note,
                calledBy: log.calledBy,
                calledByName: userName(log.calledBy),
                calledAt: log.calledAt,
              }
            : null,
        });
      }
    }
    return items.sort(
      (a, b) =>
        b.daysBefore - a.daysBefore ||
        a.appointmentTime.localeCompare(b.appointmentTime) ||
        a.appointmentId - b.appointmentId
    );
  }

  async mark(input: CallMarkInput): Promise<CallReminderLog> {
    const clinicId = requireClinicId();
    const now = new Date().toISOString();
    let log = logs.find(
      (l) =>
        l.clinicId === clinicId &&
        l.appointmentId === input.appointmentId &&
        l.daysBefore === input.daysBefore
    );
    if (!log) {
      log = {
        clinicId,
        appointmentId: input.appointmentId,
        daysBefore: input.daysBefore,
        outcome: input.outcome,
        note: input.note,
        calledBy: input.calledBy,
        calledByName: null,
        calledAt: now,
      };
      logs.push(log);
    } else {
      log.outcome = input.outcome;
      log.note = input.note;
      log.calledBy = input.calledBy;
      log.calledAt = now;
    }
    return {
      outcome: log.outcome,
      note: log.note,
      calledBy: log.calledBy,
      calledByName: userName(log.calledBy),
      calledAt: log.calledAt,
    };
  }
}
