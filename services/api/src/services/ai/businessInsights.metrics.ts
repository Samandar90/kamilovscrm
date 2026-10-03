import { sqlLocalDate, sqlTodayLocal } from "../../ai/aiSql";
import { AiFactBuilderService } from "../../ai/aiFactBuilderService";
import type { ClinicFactsSnapshot } from "../../ai/aiTypes";
import { SQL_PAYMENTS_REVENUE_PREV_7D } from "../../ai/revenueMetricsSql";
import { dbPool } from "../../config/database";
import { env } from "../../config/env";
import { getMockDb } from "../../repositories/mockDatabase";
import type { AuthTokenPayload } from "../../repositories/interfaces/userTypes";
import { errorForLog } from "../../utils/logRedaction";
import type { BusinessInsightsMetrics } from "./businessInsights.types";

const SQL_DOCTOR_LABEL = `COALESCE(NULLIF(TRIM(d.full_name), ''), 'Врач #' || d.id::text)`;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function inPrev7LocalDays(iso: string): boolean {
  const d = new Date(iso);
  for (let i = 7; i <= 13; i += 1) {
    const x = new Date();
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - i);
    if (d.toDateString() === x.toDateString()) return true;
  }
  return false;
}

function scopedDoctorIdFromAuth(auth: AuthTokenPayload): number | null {
  if (auth.role === "doctor" && auth.doctorId != null) return auth.doctorId;
  if (auth.role === "nurse" && auth.nurseDoctorId != null) return auth.nurseDoctorId;
  return null;
}

export async function loadBusinessInsightsMetrics(auth: AuthTokenPayload): Promise<BusinessInsightsMetrics> {
  const facts = new AiFactBuilderService();
  const snapshot = await facts.getClinicSnapshot();
  const scopedDoctorId = scopedDoctorIdFromAuth(auth);

  if (env.dataProvider !== "postgres") {
    return loadMockMetrics(snapshot, scopedDoctorId);
  }

  const tz = env.reportsTimezone;
  const t = [tz];

  try {
    const [prev7Res, loadsRes, cancelledRes, myTodayRes, myNoShowRes] = await Promise.all([
      dbPool.query<{ total: string }>(SQL_PAYMENTS_REVENUE_PREV_7D, t),
      dbPool.query<{ name: string; cnt: string }>(
        `
        SELECT ${SQL_DOCTOR_LABEL} AS name, COUNT(a.id)::text AS cnt
        FROM doctors d
        LEFT JOIN appointments a
          ON a.doctor_id = d.id
          AND a.deleted_at IS NULL
          AND (a.start_at AT TIME ZONE $1::text)::date >= (now() AT TIME ZONE $1::text)::date - interval '30 days'
        WHERE d.deleted_at IS NULL AND COALESCE(d.active, true) = true
        GROUP BY d.id, d.full_name
        ORDER BY COUNT(a.id) DESC
        `,
        t
      ),
      dbPool.query<{ c: string }>(
        `
        SELECT COUNT(*)::text AS c
        FROM appointments a
        WHERE a.deleted_at IS NULL
          AND a.status = 'cancelled'
          AND ${sqlLocalDate("a.start_at")} = ${sqlTodayLocal()}
        `,
        t
      ),
      scopedDoctorId != null
        ? dbPool.query<{ c: string }>(
            `
            SELECT COUNT(*)::text AS c
            FROM appointments a
            WHERE a.deleted_at IS NULL
              AND a.doctor_id = $2
              AND ${sqlLocalDate("a.start_at")} = ${sqlTodayLocal()}
            `,
            [tz, scopedDoctorId]
          )
        : Promise.resolve({ rows: [{ c: "0" }] }),
      scopedDoctorId != null
        ? dbPool.query<{ c: string }>(
            `
            SELECT COUNT(*)::text AS c
            FROM appointments a
            WHERE a.deleted_at IS NULL
              AND a.doctor_id = $2
              AND a.status IN ('cancelled', 'no_show')
              AND (a.start_at AT TIME ZONE $1::text)::date >= (now() AT TIME ZONE $1::text)::date - interval '30 days'
            `,
            [tz, scopedDoctorId]
          )
        : Promise.resolve({ rows: [{ c: "0" }] }),
    ]);

    const doctorAppointmentLoads = loadsRes.rows.map((r) => ({
      name: r.name,
      count: Number(r.cnt ?? 0),
    }));

    return {
      revenueToday: snapshot.revenueToday,
      revenue7d: snapshot.revenue7d,
      revenuePrev7d: Number(prev7Res.rows[0]?.total ?? 0),
      paymentsCountToday: snapshot.paymentsCountToday,
      paymentsCount7d: snapshot.paymentsCount7d,
      unpaidInvoicesCount: snapshot.unpaidCount,
      unpaidInvoicesAmount: snapshot.unpaidTotal,
      appointmentsToday: snapshot.appointmentsToday,
      completedToday: snapshot.appointmentsCompletedToday,
      pendingToday: snapshot.appointmentsScheduledToday,
      cancelledToday: Number(cancelledRes.rows[0]?.c ?? 0),
      noShow30d: snapshot.noShowOrCancelled30d,
      avgCheckToday: snapshot.avgCheckToday,
      avgCheck7d: snapshot.avgCheck7d,
      topDoctor: snapshot.topDoctorName,
      cashShiftOpen: snapshot.cashShiftOpen,
      doctorsCount: snapshot.doctorsCount,
      appointmentsCount: snapshot.appointmentsCount,
      doctorAppointmentLoads,
      scopedDoctorId,
      myAppointmentsToday:
        scopedDoctorId != null ? Number(myTodayRes.rows[0]?.c ?? 0) : null,
      myNoShowOrCancelled30d:
        scopedDoctorId != null ? Number(myNoShowRes.rows[0]?.c ?? 0) : null,
    };
  } catch (error) {
    console.error("[businessInsights.metrics] postgres load failed", errorForLog(error));
    return loadMockMetrics(snapshot, scopedDoctorId);
  }
}

function loadMockMetrics(snapshot: ClinicFactsSnapshot, scopedDoctorId: number | null): BusinessInsightsMetrics {
  const db = getMockDb();
  const today = new Date().toDateString();

  let revenuePrev7d = 0;
  const isValidInv = (inv: (typeof db.invoices)[0]): boolean =>
    inv.deletedAt === null && inv.status !== "cancelled" && inv.status !== "refunded";
  const netPay = (p: (typeof db.payments)[0]): number =>
    Math.max(0, p.amount - (p.refundedAmount ?? 0));

  db.payments.forEach((p) => {
    if (p.deletedAt) return;
    const inv = db.invoices.find((i) => i.id === p.invoiceId);
    if (!inv || !isValidInv(inv)) return;
    const n = netPay(p);
    if (inPrev7LocalDays(p.createdAt)) revenuePrev7d += n;
  });

  const loadsMap = new Map<string, number>();
  db.doctors.filter((d) => d.active).forEach((d) => {
    loadsMap.set(d.name, 0);
  });
  const cutoff = Date.now() - 30 * 86_400_000;
  db.appointments.forEach((a) => {
    if (new Date(a.startAt).getTime() < cutoff) return;
    const doc = db.doctors.find((d) => d.id === a.doctorId);
    const name = doc?.name ?? `Врач #${a.doctorId}`;
    loadsMap.set(name, (loadsMap.get(name) ?? 0) + 1);
  });
  const doctorAppointmentLoads = [...loadsMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const cancelledToday = db.appointments.filter(
    (a) => a.status === "cancelled" && new Date(a.startAt).toDateString() === today
  ).length;

  let myAppointmentsToday: number | null = null;
  let myNoShowOrCancelled30d: number | null = null;
  if (scopedDoctorId != null) {
    myAppointmentsToday = db.appointments.filter(
      (a) => a.doctorId === scopedDoctorId && new Date(a.startAt).toDateString() === today
    ).length;
    myNoShowOrCancelled30d = db.appointments.filter(
      (a) =>
        a.doctorId === scopedDoctorId &&
        ["cancelled", "no_show"].includes(a.status) &&
        new Date(a.startAt).getTime() >= cutoff
    ).length;
  }

  return {
    revenueToday: snapshot.revenueToday,
    revenue7d: snapshot.revenue7d,
    revenuePrev7d: round2(revenuePrev7d),
    paymentsCountToday: snapshot.paymentsCountToday,
    paymentsCount7d: snapshot.paymentsCount7d,
    unpaidInvoicesCount: snapshot.unpaidCount,
    unpaidInvoicesAmount: snapshot.unpaidTotal,
    appointmentsToday: snapshot.appointmentsToday,
    completedToday: snapshot.appointmentsCompletedToday,
    pendingToday: snapshot.appointmentsScheduledToday,
    cancelledToday,
    noShow30d: snapshot.noShowOrCancelled30d,
    avgCheckToday: snapshot.avgCheckToday,
    avgCheck7d: snapshot.avgCheck7d,
    topDoctor: snapshot.topDoctorName,
    cashShiftOpen: snapshot.cashShiftOpen,
    doctorsCount: snapshot.doctorsCount,
    appointmentsCount: snapshot.appointmentsCount,
    doctorAppointmentLoads,
    scopedDoctorId,
    myAppointmentsToday,
    myNoShowOrCancelled30d,
  };
}
