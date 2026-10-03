import { dbPool } from "../config/database";
import { env } from "../config/env";
import { getMockDb } from "../repositories/mockDatabase";
import { errorForLog } from "../utils/logRedaction";
import type { QueryResultRow } from "pg";
import { sqlInvoiceValidForRevenue, sqlLocalDate, sqlNetPayment, sqlTodayLocal } from "./aiSql";
import {
  SQL_AVG_DAILY_REVENUE_7D,
  SQL_PAYMENTS_COUNT_7D,
  SQL_PAYMENTS_COUNT_TODAY,
  SQL_PAYMENTS_REVENUE_7D,
  SQL_PAYMENTS_REVENUE_TODAY,
  SQL_PAYMENTS_REVENUE_TODAY_HYBRID,
  SQL_PAYMENTS_REVENUE_TOTAL,
} from "./revenueMetricsSql";
import {
  createEmptyClinicFactsSnapshot,
  type AiAssistantStructuredContext,
  type AiContextDoctorItem,
  type AiContextServiceItem,
  type AiDataIntent,
  type ClinicFactsSnapshot,
} from "./aiTypes";

const sqlInvoicePaidSum = (invoiceAlias: string): string =>
  `COALESCE((SELECT SUM(${sqlNetPayment("p")}) FROM payments p WHERE p.invoice_id = ${invoiceAlias}.id AND p.deleted_at IS NULL), 0)::numeric`;

/** Имя врача в SQL: в БД только `doctors.full_name`. */
const SQL_DOCTOR_LABEL = `COALESCE(NULLIF(TRIM(d.full_name), ''), 'Врач #' || d.id::text)`;

export type { AiDataIntent } from "./aiTypes";

const net = sqlNetPayment("p");

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export class AiFactBuilderService {
  private async queryPg<T extends QueryResultRow>(
    query: string,
    values: unknown[] = [],
    queryName?: string
  ): Promise<{ rows: T[] }> {
    const inferred =
      queryName ??
      query
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 96);
    try {
      return await dbPool.query<T>(query, values);
    } catch (error) {
      console.error("[AI SQL ERROR]", inferred, errorForLog(error));
      throw error;
    }
  }

  /** Одна строка результата; при ошибке SQL — fallback, чтобы не обнулять весь снимок. */
  private async safeQueryPgRow<T extends QueryResultRow>(
    label: string,
    query: string,
    values: unknown[],
    fallback: T
  ): Promise<T> {
    try {
      const r = await this.queryPg<T>(query, values, label);
      return r.rows[0] ?? fallback;
    } catch (error) {
      console.error(`[AI FACTS] ${label} failed`, errorForLog(error));
      return fallback;
    }
  }

  async getClinicSnapshot(): Promise<ClinicFactsSnapshot> {
    try {
    if (env.dataProvider === "postgres") {
      const tz = env.reportsTimezone;
      const t = [tz];

      const [
        revenueTodayRes,
        revenue7dRes,
        revenueTotalRes,
        payCntTodayRes,
        payCnt7dRes,
        unpaidRes,
        topDoctorRes,
        topServiceRes,
        countsRes,
        cashShiftRes,
        apptTodayRes,
        apptDoneRes,
        apptSchedRes,
        noShowRes,
        avg7Derived,
      ] = await Promise.all([
        this.safeQueryPgRow<{ total: string }>(
          "revenue_today_dashboard",
          SQL_PAYMENTS_REVENUE_TODAY,
          t,
          { total: "0" }
        ),
        this.safeQueryPgRow<{ total: string }>(
          "revenue_7d_dashboard",
          SQL_PAYMENTS_REVENUE_7D,
          t,
          { total: "0" }
        ),
        this.safeQueryPgRow<{ total: string }>(
          "revenue_total_dashboard",
          SQL_PAYMENTS_REVENUE_TOTAL,
          t,
          { total: "0" }
        ),
        this.safeQueryPgRow<{ c: string }>("pay_count_today_dashboard", SQL_PAYMENTS_COUNT_TODAY, t, { c: "0" }),
        this.safeQueryPgRow<{ c: string }>("pay_count_7d_dashboard", SQL_PAYMENTS_COUNT_7D, t, { c: "0" }),
        this.safeQueryPgRow<{ cnt: string; total: string }>(
          "unpaid_invoices_dashboard",
          `
          SELECT COUNT(*)::text AS cnt,
                 COALESCE(SUM(GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0)), 0)::text AS total
          FROM invoices inv
          WHERE inv.deleted_at IS NULL
            AND inv.status IN ('draft','issued','partially_paid')
            AND GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0) > 0
          `,
          t,
          { cnt: "0", total: "0" }
        ),
        this.safeQueryPgRow<{ name: string; total: string }>(
          "top_doctor_dashboard",
          `
          SELECT sub.name, sub.total::text AS total FROM (
            SELECT
              d.id,
              MAX(${SQL_DOCTOR_LABEL}) AS name,
              COALESCE(SUM(${net}), 0) AS total
            FROM doctors d
            INNER JOIN appointments a ON a.doctor_id = d.id AND a.deleted_at IS NULL
            INNER JOIN invoices i ON i.appointment_id = a.id AND i.deleted_at IS NULL
            INNER JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
            WHERE ${sqlInvoiceValidForRevenue("i")}
            GROUP BY d.id
          ) sub
          ORDER BY sub.total DESC NULLS LAST
          LIMIT 1
          `,
          t,
          { name: "", total: "0" }
        ),
        this.safeQueryPgRow<{ name: string; total: string }>(
          "top_service_dashboard",
          `
          SELECT s.name, COALESCE(SUM(${net}), 0)::text AS total
          FROM services s
          INNER JOIN appointments a ON a.service_id = s.id AND a.deleted_at IS NULL
          INNER JOIN invoices i ON i.appointment_id = a.id AND i.deleted_at IS NULL
          INNER JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
          WHERE ${sqlInvoiceValidForRevenue("i")}
          GROUP BY s.id, s.name
          ORDER BY COALESCE(SUM(${net}), 0) DESC NULLS LAST
          LIMIT 1
          `,
          t,
          { name: "", total: "0" }
        ),
        this.safeQueryPgRow<{ doctors: string; services: string; appointments: string }>(
          "counts_dashboard",
          `
          SELECT
            (SELECT COUNT(*) FROM doctors WHERE COALESCE(active, true) = true)::text AS doctors,
            (SELECT COUNT(*) FROM services WHERE COALESCE(active, true) = true)::text AS services,
            (SELECT COUNT(*) FROM appointments WHERE deleted_at IS NULL)::text AS appointments
          `,
          t,
          { doctors: "0", services: "0", appointments: "0" }
        ),
        this.safeQueryPgRow<{ id: string }>(
          "cash_shift_dashboard",
          `SELECT id::text FROM cash_register_shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
          t,
          { id: "" }
        ),
        this.safeQueryPgRow<{ cnt: string }>(
          "appt_today_dashboard",
          `
          SELECT COUNT(*)::text AS cnt
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND ${sqlLocalDate("a.start_at")} = ${sqlTodayLocal()}
          `,
          t,
          { cnt: "0" }
        ),
        this.safeQueryPgRow<{ cnt: string }>(
          "appt_done_dashboard",
          `
          SELECT COUNT(*)::text AS cnt
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND a.status = 'completed'
            AND ${sqlLocalDate("a.start_at")} = ${sqlTodayLocal()}
          `,
          t,
          { cnt: "0" }
        ),
        this.safeQueryPgRow<{ cnt: string }>(
          "appt_sched_dashboard",
          `
          SELECT COUNT(*)::text AS cnt
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND a.status IN ('scheduled','confirmed','arrived','in_consultation')
            AND ${sqlLocalDate("a.start_at")} = ${sqlTodayLocal()}
          `,
          t,
          { cnt: "0" }
        ),
        this.safeQueryPgRow<{ cnt: string }>(
          "noshow_dashboard",
          `
          SELECT COUNT(*)::text AS cnt
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND a.status IN ('cancelled','no_show')
            AND a.start_at >= (now() - interval '30 days')
          `,
          t,
          { cnt: "0" }
        ),
        this.safeQueryPgRow<{ avg: string }>(
          "avg_daily_revenue_7d_dashboard",
          SQL_AVG_DAILY_REVENUE_7D,
          t,
          { avg: "0" }
        ),
      ]);

      const revenueToday = Number(revenueTodayRes.total ?? 0);
      const revenue7d = Number(revenue7dRes.total ?? 0);
      const revenueTotal = Number(revenueTotalRes.total ?? 0);
      const paymentsCountToday = Number(payCntTodayRes.c ?? 0);
      const paymentsCount7d = Number(payCnt7dRes.c ?? 0);

      // eslint-disable-next-line no-console
      console.log("[AI FACTS] revenueToday:", revenueToday);
      // eslint-disable-next-line no-console
      console.log("[AI FACTS] revenue7d:", revenue7d);
      // eslint-disable-next-line no-console
      console.log("[AI FACTS] paymentsCountToday:", paymentsCountToday);
      // eslint-disable-next-line no-console
      console.log(
        "[AI FACTS] source used:",
        `payments+invoices net; p.created_at; date_trunc+AT TIME ZONE; TZ=${tz}; (aligned with reports metrics)`
      );
      const avgCheckToday =
        paymentsCountToday > 0 ? round2(revenueToday / paymentsCountToday) : 0;
      const avgCheck7d = paymentsCount7d > 0 ? round2(revenue7d / paymentsCount7d) : 0;

      return {
        revenueToday,
        revenue7d,
        revenueTotal,
        unpaidCount: Number(unpaidRes.cnt ?? 0),
        unpaidTotal: Number(unpaidRes.total ?? 0),
        avgCheckToday,
        avgCheck7d,
        paymentsCountToday,
        paymentsCount7d,
        topDoctorName: topDoctorRes.name?.trim() ? topDoctorRes.name : null,
        topDoctorTotal: Number(topDoctorRes.total ?? 0),
        topServiceName: topServiceRes.name?.trim() ? topServiceRes.name : null,
        topServiceTotal: Number(topServiceRes.total ?? 0),
        doctorsCount: Number(countsRes.doctors ?? 0),
        servicesCount: Number(countsRes.services ?? 0),
        appointmentsCount: Number(countsRes.appointments ?? 0),
        appointmentsToday: Number(apptTodayRes.cnt ?? 0),
        appointmentsCompletedToday: Number(apptDoneRes.cnt ?? 0),
        appointmentsScheduledToday: Number(apptSchedRes.cnt ?? 0),
        noShowOrCancelled30d: Number(noShowRes.cnt ?? 0),
        avgDailyRevenue7Days: Number(avg7Derived.avg ?? 0),
        cashShiftOpen: Boolean(cashShiftRes.id),
      };
    }

    const db = getMockDb();
    const today = new Date().toDateString();

    const isValidInv = (inv: (typeof db.invoices)[0]): boolean =>
      inv.deletedAt === null && inv.status !== "cancelled" && inv.status !== "refunded";

    const netPay = (p: (typeof db.payments)[0]): number =>
      Math.max(0, p.amount - (p.refundedAmount ?? 0));

    const inLocalDay = (iso: string, dayStr: string): boolean => {
      const d = new Date(iso);
      return d.toDateString() === dayStr;
    };

    const inLast7LocalDays = (iso: string): boolean => {
      const d = new Date(iso);
      for (let i = 0; i < 7; i += 1) {
        const x = new Date();
        x.setHours(0, 0, 0, 0);
        x.setDate(x.getDate() - i);
        if (d.toDateString() === x.toDateString()) return true;
      }
      return false;
    };

    let revenueToday = 0;
    let revenue7d = 0;
    let revenueTotal = 0;
    let paymentsCountToday = 0;
    let paymentsCount7d = 0;

    /** Как Postgres: оплаты по счетам (не cancelled/refunded), net-сумма. */
    db.payments.forEach((p) => {
      if (p.deletedAt) return;
      const inv = db.invoices.find((i) => i.id === p.invoiceId);
      if (!inv || !isValidInv(inv)) return;
      const n = netPay(p);
      revenueTotal += n;
      if (inLocalDay(p.createdAt, today)) {
        revenueToday += n;
        if (n > 0) paymentsCountToday += 1;
      }
      if (inLast7LocalDays(p.createdAt)) {
        revenue7d += n;
        if (n > 0) paymentsCount7d += 1;
      }
    });
    // eslint-disable-next-line no-console
    console.log("[AI FACTS] revenueToday:", revenueToday);
    // eslint-disable-next-line no-console
    console.log("[AI FACTS] revenue7d:", revenue7d);
    // eslint-disable-next-line no-console
    console.log("[AI FACTS] paymentsCountToday:", paymentsCountToday);
    // eslint-disable-next-line no-console
    console.log("[AI FACTS] source used: mock DB; payments+invoices net (aligned with reports)");

    const unpaidInvoices = db.invoices.filter(
      (i) =>
        i.deletedAt === null &&
        ["draft", "issued", "partially_paid"].includes(i.status) &&
        Math.max(0, i.total - i.paidAmount) > 0
    );
    const unpaidTotal = unpaidInvoices.reduce((acc, i) => acc + Math.max(0, i.total - i.paidAmount), 0);

    const doctorRevenue = new Map<number, number>();
    const serviceRevenue = new Map<number, number>();
    db.payments.forEach((p) => {
      if (p.deletedAt) return;
      const inv = db.invoices.find((i) => i.id === p.invoiceId);
      if (!inv || !isValidInv(inv) || !inv.appointmentId) return;
      const ap = db.appointments.find((a) => a.id === inv.appointmentId);
      if (!ap) return;
      doctorRevenue.set(ap.doctorId, (doctorRevenue.get(ap.doctorId) ?? 0) + netPay(p));
      serviceRevenue.set(ap.serviceId, (serviceRevenue.get(ap.serviceId) ?? 0) + netPay(p));
    });
    const topDoctorEntry = [...doctorRevenue.entries()].sort((a, b) => b[1] - a[1])[0];
    const topServiceEntry = [...serviceRevenue.entries()].sort((a, b) => b[1] - a[1])[0];

    const appointmentsToday = db.appointments.filter(
      (a) => new Date(a.startAt).toDateString() === today
    ).length;
    const appointmentsCompletedToday = db.appointments.filter(
      (a) => a.status === "completed" && new Date(a.startAt).toDateString() === today
    ).length;
    const appointmentsScheduledToday = db.appointments.filter(
      (a) =>
        ["scheduled", "confirmed", "arrived", "in_consultation"].includes(a.status) &&
        new Date(a.startAt).toDateString() === today
    ).length;
    const noShowOrCancelled30d = db.appointments.filter((a) => {
      if (!["cancelled", "no_show"].includes(a.status)) return false;
      return new Date(a.startAt).getTime() >= Date.now() - 30 * 86_400_000;
    }).length;

    const avgCheckToday =
      paymentsCountToday > 0 ? round2(revenueToday / paymentsCountToday) : 0;
    const avgCheck7d = paymentsCount7d > 0 ? round2(revenue7d / paymentsCount7d) : 0;

    return {
      revenueToday,
      revenue7d,
      revenueTotal,
      unpaidCount: unpaidInvoices.length,
      unpaidTotal,
      avgCheckToday,
      avgCheck7d,
      paymentsCountToday,
      paymentsCount7d,
      topDoctorName: topDoctorEntry ? db.doctors.find((d) => d.id === topDoctorEntry[0])?.name ?? null : null,
      topDoctorTotal: topDoctorEntry?.[1] ?? 0,
      topServiceName: topServiceEntry ? db.services.find((s) => s.id === topServiceEntry[0])?.name ?? null : null,
      topServiceTotal: topServiceEntry?.[1] ?? 0,
      doctorsCount: db.doctors.filter((d) => d.active).length,
      servicesCount: db.services.filter((s) => s.active).length,
      appointmentsCount: db.appointments.length,
      appointmentsToday,
      appointmentsCompletedToday,
      appointmentsScheduledToday,
      noShowOrCancelled30d,
      avgDailyRevenue7Days: revenue7d / 7,
      cashShiftOpen: db.cashRegisterShifts.some((s) => !s.closedAt),
    };
    } catch (error) {
      console.error("[AI FACT BUILDER] getClinicSnapshot failed", errorForLog(error));
      return createEmptyClinicFactsSnapshot();
    }
  }

  async fetchHybridData(intent: AiDataIntent): Promise<Record<string, unknown>> {
    if (env.dataProvider === "postgres") {
      const tz = env.reportsTimezone;
      const t = [tz];
      const netP = sqlNetPayment("p");

      switch (intent) {
        case "revenue": {
          const row = await this.safeQueryPgRow<{ total: string; cnt: string }>(
            "hybrid_revenue_today_dashboard",
            SQL_PAYMENTS_REVENUE_TODAY_HYBRID,
            t,
            { total: "0", cnt: "0" }
          );
          const total = Number(row.total ?? 0);
          const paymentsCountToday = Number(row.cnt ?? 0);
          return { total, revenueToday: total, paymentsCountToday };
        }
        case "unpaid": {
          const summary = await this.queryPg<{ cnt: string; total: string }>(
            `
            SELECT COUNT(*)::text AS cnt,
                   COALESCE(SUM(GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0)), 0)::text AS total
            FROM invoices inv
            WHERE inv.deleted_at IS NULL
              AND inv.status IN ('draft','issued','partially_paid')
              AND GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0) > 0
            `,
            t
          );
          const rows = await this.queryPg<{ number: string; remainder: string }>(
            `
            SELECT inv.number,
                   GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0)::text AS remainder
            FROM invoices inv
            WHERE inv.deleted_at IS NULL
              AND inv.status IN ('draft','issued','partially_paid')
              AND GREATEST(inv.total::numeric - ${sqlInvoicePaidSum("inv")}, 0) > 0
            ORDER BY inv.created_at DESC
            LIMIT 5
            `,
            t
          );
          return {
            count: Number(summary.rows[0]?.cnt ?? 0),
            unpaidCount: Number(summary.rows[0]?.cnt ?? 0),
            unpaidTotal: Number(summary.rows[0]?.total ?? 0),
            recentInvoices: rows.rows.map((r) => ({
              number: r.number,
              remainder: Number(r.remainder),
            })),
          };
        }
        case "top_doctor": {
          const row = await this.queryPg<{ name: string; total: string; share: string }>(
            `
            WITH doctor_totals AS (
              SELECT
                d.id,
                MAX(${SQL_DOCTOR_LABEL}) AS name,
                COALESCE(SUM(${netP}), 0) AS total
              FROM doctors d
              INNER JOIN appointments a ON a.doctor_id = d.id AND a.deleted_at IS NULL
              INNER JOIN invoices i ON i.appointment_id = a.id AND i.deleted_at IS NULL
              INNER JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
              WHERE ${sqlInvoiceValidForRevenue("i")}
              GROUP BY d.id
            ),
            grand AS (SELECT COALESCE(SUM(total), 0) AS all_total FROM doctor_totals)
            SELECT dt.name,
                   dt.total::text AS total,
                   CASE WHEN g.all_total > 0 THEN ROUND((dt.total / g.all_total) * 100, 2)::text ELSE '0' END AS share
            FROM doctor_totals dt
            CROSS JOIN grand g
            ORDER BY dt.total DESC NULLS LAST
            LIMIT 1
            `,
            t
          );
          return {
            topDoctor: row.rows[0]
              ? {
                  name: row.rows[0].name,
                  total: Number(row.rows[0].total),
                  share: Number(row.rows[0].share ?? 0),
                }
              : null,
          };
        }
        case "top_service": {
          const row = await this.queryPg<{ name: string; total: string }>(
            `
            SELECT s.name, COALESCE(SUM(${netP}), 0)::text AS total
            FROM services s
            INNER JOIN appointments a ON a.service_id = s.id AND a.deleted_at IS NULL
            INNER JOIN invoices i ON i.appointment_id = a.id AND i.deleted_at IS NULL
            INNER JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
            WHERE ${sqlInvoiceValidForRevenue("i")}
            GROUP BY s.id, s.name
            ORDER BY COALESCE(SUM(${netP}), 0) DESC NULLS LAST
            LIMIT 1
            `,
            t
          );
          return {
            topService: row.rows[0]
              ? { name: row.rows[0].name, total: Number(row.rows[0].total) }
              : null,
          };
        }
        case "cash_status": {
          const row = await this.queryPg<{ id: string; opened_at: string }>(
            `SELECT id::text, opened_at::text
             FROM cash_register_shifts
             WHERE closed_at IS NULL
             ORDER BY opened_at DESC
             LIMIT 1`,
            t
          );
          return {
            cashShiftOpen: Boolean(row.rows[0]),
            currentShift: row.rows[0] ?? null,
          };
        }
        case "health": {
          const snap = await this.getClinicSnapshot();
          return {
            revenueToday: snap.revenueToday,
            unpaidCount: snap.unpaidCount,
            topDoctor: snap.topDoctorName
              ? { name: snap.topDoctorName, total: snap.topDoctorTotal }
              : null,
            topService: snap.topServiceName
              ? { name: snap.topServiceName, total: snap.topServiceTotal }
              : null,
            appointmentsToday: snap.appointmentsToday,
            avgDailyRevenue7Days: snap.avgDailyRevenue7Days,
            avgCheckToday: snap.avgCheckToday,
            avgCheck7d: snap.avgCheck7d,
            noShowOrCancelled30d: snap.noShowOrCancelled30d,
          };
        }
        default:
          return {};
      }
    }

    const snap = await this.getClinicSnapshot();
    if (intent === "revenue") {
      return { total: snap.revenueToday, revenueToday: snap.revenueToday };
    }
    if (intent === "unpaid") {
      const unpaidInvoices = getMockDb().invoices.filter(
        (i) =>
          i.deletedAt === null &&
          ["draft", "issued", "partially_paid"].includes(i.status) &&
          Math.max(0, i.total - i.paidAmount) > 0
      );
      return {
        count: unpaidInvoices.length,
        unpaidCount: unpaidInvoices.length,
        unpaidTotal: unpaidInvoices.reduce((a, i) => a + Math.max(0, i.total - i.paidAmount), 0),
        recentInvoices: unpaidInvoices.slice(0, 5).map((i) => ({
          number: i.number,
          remainder: Math.max(0, i.total - i.paidAmount),
        })),
      };
    }
    if (intent === "top_doctor") {
      const doctorRevenue = new Map<number, number>();
      getMockDb().payments.forEach((p) => {
        if (p.deletedAt) return;
        const inv = getMockDb().invoices.find((i) => i.id === p.invoiceId);
        if (!inv?.appointmentId || inv.status === "cancelled" || inv.status === "refunded") return;
        const ap = getMockDb().appointments.find((a) => a.id === inv.appointmentId);
        if (!ap) return;
        doctorRevenue.set(ap.doctorId, (doctorRevenue.get(ap.doctorId) ?? 0) + netPay(p));
      });
      const top = [...doctorRevenue.entries()].sort((a, b) => b[1] - a[1])[0];
      const totalRevenue = [...doctorRevenue.values()].reduce((acc, v) => acc + v, 0);
      return {
        topDoctor: top
          ? {
              name: getMockDb().doctors.find((d) => d.id === top[0])?.name ?? "—",
              total: top[1],
              share: totalRevenue > 0 ? Math.round((top[1] / totalRevenue) * 10000) / 100 : 0,
            }
          : null,
      };
    }
    if (intent === "top_service") {
      const serviceRevenue = new Map<number, number>();
      getMockDb().payments.forEach((p) => {
        if (p.deletedAt) return;
        const inv = getMockDb().invoices.find((i) => i.id === p.invoiceId);
        if (!inv?.appointmentId || inv.status === "cancelled" || inv.status === "refunded") return;
        const ap = getMockDb().appointments.find((a) => a.id === inv.appointmentId);
        if (!ap) return;
        serviceRevenue.set(ap.serviceId, (serviceRevenue.get(ap.serviceId) ?? 0) + netPay(p));
      });
      const top = [...serviceRevenue.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        topService: top
          ? { name: getMockDb().services.find((s) => s.id === top[0])?.name ?? "—", total: top[1] }
          : null,
      };
    }
    if (intent === "cash_status") {
      const currentShift = getMockDb().cashRegisterShifts.find((s) => !s.closedAt) ?? null;
      return { cashShiftOpen: Boolean(currentShift), currentShift };
    }
    if (intent === "health") {
      return {
        revenueToday: snap.revenueToday,
        unpaidCount: snap.unpaidCount,
        topDoctor: snap.topDoctorName
          ? { name: snap.topDoctorName, total: snap.topDoctorTotal }
          : null,
        topService: snap.topServiceName
          ? { name: snap.topServiceName, total: snap.topServiceTotal }
          : null,
        appointmentsToday: snap.appointmentsToday,
        avgDailyRevenue7Days: snap.avgDailyRevenue7Days,
        avgCheckToday: snap.avgCheckToday,
        avgCheck7d: snap.avgCheck7d,
        noShowOrCancelled30d: snap.noShowOrCancelled30d,
      };
    }
    return {};
  }

  async buildStructuredContext(snapshot: ClinicFactsSnapshot): Promise<AiAssistantStructuredContext> {
    try {
      if (env.dataProvider === "postgres") {
        const doctorsRows = await this.queryPg<{ name: string; specialty: string | null }>(
          `
          SELECT
            COALESCE(NULLIF(TRIM(full_name), ''), 'Врач #' || id::text) AS name,
            NULLIF(TRIM(specialty), '') AS specialty
          FROM doctors
          WHERE deleted_at IS NULL
            AND COALESCE(active, true) = true
          ORDER BY full_name ASC
          LIMIT 12
          `
        );
        const servicesRows = await this.queryPg<{ name: string; price: string | null }>(
          `
          SELECT
            name,
            CASE WHEN price IS NULL THEN NULL ELSE price::text END AS price
          FROM services
          WHERE deleted_at IS NULL
            AND COALESCE(active, true) = true
          ORDER BY name ASC
          LIMIT 12
          `
        );
        const doctors: AiContextDoctorItem[] = doctorsRows.rows.map((d) => ({
          name: d.name,
          specialty: d.specialty,
        }));
        const activeServices: AiContextServiceItem[] = servicesRows.rows.map((s) => ({
          name: s.name,
          price: s.price == null ? null : Number(s.price),
        }));
        return {
          revenueToday: snapshot.revenueToday,
          revenue7d: snapshot.revenue7d,
          unpaidInvoicesCount: snapshot.unpaidCount,
          unpaidInvoicesAmount: snapshot.unpaidTotal,
          appointmentsToday: snapshot.appointmentsToday,
          completedToday: snapshot.appointmentsCompletedToday,
          pendingToday: snapshot.appointmentsScheduledToday,
          avgCheckToday: snapshot.avgCheckToday,
          avgCheck7d: snapshot.avgCheck7d,
          topDoctor: snapshot.topDoctorName,
          cashShiftStatus: snapshot.cashShiftOpen ? "open" : "closed",
          noShow30d: snapshot.noShowOrCancelled30d,
          doctors,
          activeServices,
        };
      }

      const db = getMockDb();
      const doctors: AiContextDoctorItem[] = db.doctors
        .filter((d) => d.active)
        .slice(0, 12)
        .map((d) => ({ name: d.name, specialty: d.speciality }));
      const activeServices: AiContextServiceItem[] = db.services
        .filter((s) => s.active)
        .slice(0, 12)
        .map((s) => ({ name: s.name, price: Number(s.price) }));
      return {
        revenueToday: snapshot.revenueToday,
        revenue7d: snapshot.revenue7d,
        unpaidInvoicesCount: snapshot.unpaidCount,
        unpaidInvoicesAmount: snapshot.unpaidTotal,
        appointmentsToday: snapshot.appointmentsToday,
        completedToday: snapshot.appointmentsCompletedToday,
        pendingToday: snapshot.appointmentsScheduledToday,
        avgCheckToday: snapshot.avgCheckToday,
        avgCheck7d: snapshot.avgCheck7d,
        topDoctor: snapshot.topDoctorName,
        cashShiftStatus: snapshot.cashShiftOpen ? "open" : "closed",
        noShow30d: snapshot.noShowOrCancelled30d,
        doctors,
        activeServices,
      };
    } catch (error) {
      console.error("[AI FACT BUILDER] buildStructuredContext failed", errorForLog(error));
      return {
        revenueToday: snapshot.revenueToday,
        revenue7d: snapshot.revenue7d,
        unpaidInvoicesCount: snapshot.unpaidCount,
        unpaidInvoicesAmount: snapshot.unpaidTotal,
        appointmentsToday: snapshot.appointmentsToday,
        completedToday: snapshot.appointmentsCompletedToday,
        pendingToday: snapshot.appointmentsScheduledToday,
        avgCheckToday: snapshot.avgCheckToday,
        avgCheck7d: snapshot.avgCheck7d,
        topDoctor: snapshot.topDoctorName,
        cashShiftStatus: snapshot.cashShiftOpen ? "open" : "closed",
        noShow30d: snapshot.noShowOrCancelled30d,
        doctors: [],
        activeServices: [],
      };
    }
  }

  enrichData(intent: AiDataIntent, data: Record<string, unknown>): Record<string, unknown> {
    const next = { ...data } as Record<string, unknown>;
    if (intent === "revenue") {
      const total = Number(next.total ?? next.revenueToday ?? 0);
      const pct = Number(next.paymentsCountToday ?? 0);
      if (total === 0 && pct === 0) next.note = "no_payments_today";
    }
    if (intent === "top_doctor") {
      const topDoctor = (next.topDoctor ?? null) as { share?: number } | null;
      const share = Number(topDoctor?.share ?? 0);
      if (share > 80) next.risk = "Один врач генерирует почти всю выручку";
    }
    if (intent === "unpaid") {
      const count = Number(next.count ?? next.unpaidCount ?? 0);
      if (count > 0) next.problem = "Есть неоплаченные счета";
    }
    return next;
  }
}

function netPay(p: { amount: number; refundedAmount?: number }): number {
  return Math.max(0, p.amount - (p.refundedAmount ?? 0));
}
