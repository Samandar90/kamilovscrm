import type { IReportsRepository } from "../interfaces/IReportsRepository";
import type { RecommendationsAnalyticsData } from "../interfaces/aiRecommendationsTypes";
import type {
  InvoiceStatusSummaryRow,
  PaymentsByMethodRow,
  ReportMetrics,
  ReportsDateRange,
  ReportsGranularity,
  ReportsSummaryData,
  RevenueByDoctorRow,
  RevenueByServiceRow,
  RevenuePoint,
} from "../interfaces/billingTypes";
import { dbPool } from "../../config/database";
import { env } from "../../config/env";
import { parseMoneyColumn } from "../../utils/numbers";
import { requireClinicId } from "../../tenancy/clinicContext";

type BoundRow = {
  from_inclusive: Date | null;
  to_exclusive: Date | null;
  to_inclusive: Date | null;
};

const num = (v: string | number): number => parseMoneyColumn(v, 0);

const formatYmdInTimeZone = (isoNow: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(isoNow);

const addDaysYmd = (ymd: string, deltaDays: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
};

/** Payments: calendar end uses exclusive upper bound; full timestamps use inclusive end. */
const PAYMENT_TIME = `
  ($1::timestamptz IS NULL OR p.created_at >= $1::timestamptz)
  AND ($2::timestamptz IS NULL OR p.created_at < $2::timestamptz)
  AND ($3::timestamptz IS NULL OR p.created_at <= $3::timestamptz)
`;

const INVOICE_TIME = `
  ($1::timestamptz IS NULL OR inv.created_at >= $1::timestamptz)
  AND ($2::timestamptz IS NULL OR inv.created_at < $2::timestamptz)
  AND ($3::timestamptz IS NULL OR inv.created_at <= $3::timestamptz)
`;

const APPOINTMENT_TIME = `
  ($1::timestamptz IS NULL OR a.start_at >= $1::timestamptz)
  AND ($2::timestamptz IS NULL OR a.start_at < $2::timestamptz)
  AND ($3::timestamptz IS NULL OR a.start_at <= $3::timestamptz)
`;

export class PostgresReportsRepository implements IReportsRepository {
  private async resolveBounds(range: ReportsDateRange): Promise<BoundRow> {
    const tz = env.reportsTimezone;
    const df = range.dateFrom?.trim() ?? "";
    const dt = range.dateTo?.trim() ?? "";
    const r = await dbPool.query<BoundRow>(
      `
        SELECT
          CASE
            WHEN trim(coalesce($2::text, '')) = '' THEN NULL::timestamptz
            WHEN trim($2) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (trim($2)::date AT TIME ZONE $1::text)
            ELSE trim($2)::timestamptz
          END AS from_inclusive,
          CASE
            WHEN trim(coalesce($3::text, '')) = '' THEN NULL::timestamptz
            WHEN trim($3) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ((trim($3)::date + interval '1 day') AT TIME ZONE $1::text)
            ELSE NULL::timestamptz
          END AS to_exclusive,
          CASE
            WHEN trim(coalesce($3::text, '')) = '' THEN NULL::timestamptz
            WHEN trim($3) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN NULL::timestamptz
            ELSE trim($3)::timestamptz
          END AS to_inclusive
      `,
      [tz, df || null, dt || null]
    );
    return r.rows[0];
  }

  private boundTriplet(b: BoundRow): [Date | null, Date | null, Date | null] {
    return [b.from_inclusive, b.to_exclusive, b.to_inclusive];
  }

  async getRevenueReport(
    granularity: ReportsGranularity,
    range: ReportsDateRange
  ): Promise<RevenuePoint[]> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const tz = env.reportsTimezone;
    const truncUnit =
      granularity === "day" ? "day" : granularity === "week" ? "week" : "month";
    const t = this.boundTriplet(b);

    const result = await dbPool.query<{ period_start: string; total_revenue: string | number }>(
      `
        SELECT
          to_char(
            date_trunc($4::text, p.created_at AT TIME ZONE $5::text),
            'YYYY-MM-DD'
          ) AS period_start,
          COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS total_revenue
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        WHERE i.status NOT IN ('cancelled', 'refunded')
          AND p.deleted_at IS NULL
          AND p.clinic_id = $6
          AND ${PAYMENT_TIME}
        GROUP BY 1
        ORDER BY 1
      `,
      [...t, truncUnit, tz, clinicId]
    );

    return result.rows.map((row) => ({
      periodStart: row.period_start,
      totalRevenue: num(row.total_revenue),
    }));
  }

  async getPaymentsByMethodReport(range: ReportsDateRange): Promise<PaymentsByMethodRow[]> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const t = this.boundTriplet(b);

    const result = await dbPool.query<{ method: string; total_amount: string | number }>(
      `
        SELECT
          CASE WHEN p.method = 'cash' THEN 'cash' ELSE 'card' END AS method,
          COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS total_amount
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        WHERE i.status NOT IN ('cancelled', 'refunded')
          AND p.deleted_at IS NULL
          AND p.clinic_id = $4
          AND ${PAYMENT_TIME}
        GROUP BY 1
        ORDER BY 1
      `,
      [...t, clinicId]
    );

    return result.rows.map((row) => ({
      method: row.method as PaymentsByMethodRow["method"],
      totalAmount: num(row.total_amount),
    }));
  }

  async getInvoicesStatusSummaryReport(
    range: ReportsDateRange
  ): Promise<InvoiceStatusSummaryRow[]> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const t = this.boundTriplet(b);

    const result = await dbPool.query<{
      status: string;
      cnt: string | number;
      total_amount: string | number;
    }>(
      `
        SELECT
          inv.status,
          COUNT(*)::int AS cnt,
          COALESCE(SUM(inv.total), 0)::float8 AS total_amount
        FROM invoices inv
        WHERE inv.deleted_at IS NULL
          AND inv.clinic_id = $4
          AND ${INVOICE_TIME}
        GROUP BY inv.status
        ORDER BY inv.status
      `,
      [...t, clinicId]
    );

    return result.rows.map((row) => ({
      status: row.status,
      count: num(row.cnt),
      totalAmount: num(row.total_amount),
    }));
  }

  async getRevenueByDoctor(range: ReportsDateRange): Promise<RevenueByDoctorRow[]> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const t = this.boundTriplet(b);

    const result = await dbPool.query<{
      doctor_id: string | number | null;
      doctor_name: string | null;
      total_revenue: string | number;
    }>(
      `
        SELECT
          a.doctor_id,
          MAX(COALESCE(NULLIF(TRIM(d.full_name), ''), '—')) AS doctor_name,
          COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS total_revenue
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        LEFT JOIN appointments a ON a.id = i.appointment_id AND a.deleted_at IS NULL
        LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE i.status NOT IN ('cancelled', 'refunded')
          AND p.deleted_at IS NULL
          AND p.clinic_id = $4
          AND ${PAYMENT_TIME}
        GROUP BY a.doctor_id
        ORDER BY total_revenue DESC
      `,
      [...t, clinicId]
    );

    return result.rows.map((row) => ({
      doctorId: row.doctor_id != null ? Number(row.doctor_id) : null,
      doctorName: row.doctor_name,
      totalRevenue: num(row.total_revenue),
    }));
  }

  async getRevenueByService(range: ReportsDateRange): Promise<RevenueByServiceRow[]> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const t = this.boundTriplet(b);

    const result = await dbPool.query<{
      service_id: string | number | null;
      service_name: string | null;
      total_revenue: string | number;
    }>(
      `
        SELECT
          a.service_id,
          MAX(COALESCE(NULLIF(TRIM(s.name), ''), '—')) AS service_name,
          COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS total_revenue
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        LEFT JOIN appointments a ON a.id = i.appointment_id AND a.deleted_at IS NULL
        LEFT JOIN services s ON s.id = a.service_id
        WHERE i.status NOT IN ('cancelled', 'refunded')
          AND p.deleted_at IS NULL
          AND p.clinic_id = $4
          AND ${PAYMENT_TIME}
        GROUP BY a.service_id
        ORDER BY total_revenue DESC
      `,
      [...t, clinicId]
    );

    return result.rows.map((row) => ({
      serviceId: row.service_id != null ? Number(row.service_id) : null,
      serviceName: row.service_name,
      totalRevenue: num(row.total_revenue),
    }));
  }

  async getReportMetrics(range: ReportsDateRange): Promise<ReportMetrics> {
    const clinicId = requireClinicId();
    const b = await this.resolveBounds(range);
    const t = this.boundTriplet(b);

    const [payRes, apptRes] = await Promise.all([
      dbPool.query<{ s: string | number; c: string | number }>(
        `
          SELECT
            COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS s,
            COALESCE(
              SUM(
                CASE
                  WHEN GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0)) > 0
                    THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS c
          FROM payments p
          INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
          WHERE i.status NOT IN ('cancelled', 'refunded')
            AND p.deleted_at IS NULL
            AND p.clinic_id = $4
            AND ${PAYMENT_TIME}
        `,
        [...t, clinicId]
      ),
      dbPool.query<{ c: string | number }>(
        `
          SELECT COUNT(*)::int AS c
          FROM appointments a
          WHERE a.deleted_at IS NULL
            AND a.clinic_id = $4
            AND ${APPOINTMENT_TIME}
        `,
        [...t, clinicId]
      ),
    ]);

    return {
      totalPaymentsAmount: num(payRes.rows[0]?.s ?? 0),
      paymentsCount: num(payRes.rows[0]?.c ?? 0),
      appointmentsCount: num(apptRes.rows[0]?.c ?? 0),
    };
  }

  async getReportsSummary(): Promise<ReportsSummaryData> {
    const clinicId = requireClinicId();
    const tz = env.reportsTimezone;

    const [totalsRes, byDayRes, byDoctorRes, byServiceRes] = await Promise.all([
      dbPool.query<{
        revenue_today: string | number;
        revenue_yesterday: string | number;
        revenue_week: string | number;
        revenue_previous_week: string | number;
        revenue_month: string | number;
      }>(
        `
        WITH b1 AS (
          SELECT
            $1::text AS tz,
            (now() AT TIME ZONE $1::text)::date AS today_d
        ),
        b2 AS (
          SELECT
            b1.tz,
            b1.today_d,
            b1.today_d - 1 AS yest_d,
            (date_trunc('week', now() AT TIME ZONE b1.tz))::date AS week_start_d,
            (date_trunc('month', now() AT TIME ZONE b1.tz))::date AS month_start_d
          FROM b1
        ),
        b3 AS (
          SELECT
            b2.*,
            LEAST(
              (b2.month_start_d::timestamp AT TIME ZONE b2.tz),
              (b2.week_start_d::timestamp AT TIME ZONE b2.tz),
              ((b2.today_d - 1)::timestamp AT TIME ZONE b2.tz)
            ) AS lower_ts
          FROM b2
        ),
        pay AS (
          SELECT
            GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0)) AS net,
            (p.created_at AT TIME ZONE (SELECT tz FROM b3 LIMIT 1))::date AS pay_d
          FROM payments p
          INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
          WHERE p.deleted_at IS NULL
            AND i.status NOT IN ('cancelled', 'refunded')
            AND p.clinic_id = $2
            AND p.created_at >= (SELECT lower_ts FROM b3 LIMIT 1)
        )
        SELECT
          COALESCE(SUM(pay.net) FILTER (WHERE pay.pay_d = b3.today_d), 0)::float8 AS revenue_today,
          COALESCE(SUM(pay.net) FILTER (WHERE pay.pay_d = b3.yest_d), 0)::float8 AS revenue_yesterday,
          COALESCE(
            SUM(pay.net) FILTER (
              WHERE pay.pay_d >= b3.week_start_d AND pay.pay_d <= b3.today_d
            ),
            0
          )::float8 AS revenue_week,
          COALESCE(
            SUM(pay.net) FILTER (
              WHERE pay.pay_d >= (b3.week_start_d - 7) AND pay.pay_d < b3.week_start_d
            ),
            0
          )::float8 AS revenue_previous_week,
          COALESCE(
            SUM(pay.net) FILTER (
              WHERE pay.pay_d >= b3.month_start_d AND pay.pay_d <= b3.today_d
            ),
            0
          )::float8 AS revenue_month
        FROM b3
        LEFT JOIN pay ON TRUE
        GROUP BY b3.today_d, b3.yest_d, b3.week_start_d, b3.month_start_d
        `,
        [tz, clinicId]
      ),
      dbPool.query<{ date: string; amount: string | number }>(
        `
        WITH b AS (
          SELECT (now() AT TIME ZONE $1::text)::date AS today_d
        ),
        series AS (
          SELECT gs::date AS day
          FROM b,
            generate_series(b.today_d - 29, b.today_d, interval '1 day') AS gs
        ),
        agg AS (
          SELECT
            (p.created_at AT TIME ZONE $1::text)::date AS d,
            SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0)))::numeric AS amt
          FROM payments p
          INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
          WHERE p.deleted_at IS NULL
            AND i.status NOT IN ('cancelled', 'refunded')
            AND p.clinic_id = $2
            AND (p.created_at AT TIME ZONE $1::text)::date >= (SELECT today_d - 29 FROM b)
            AND (p.created_at AT TIME ZONE $1::text)::date <= (SELECT today_d FROM b)
          GROUP BY 1
        )
        SELECT
          to_char(s.day, 'YYYY-MM-DD') AS date,
          COALESCE(a.amt, 0)::float8 AS amount
        FROM series s
        LEFT JOIN agg a ON a.d = s.day
        ORDER BY s.day
        `,
        [tz, clinicId]
      ),
      dbPool.query<{ doctor_name: string | null; amount: string | number }>(
        `
        WITH b AS (
          SELECT (now() AT TIME ZONE $1::text)::date AS today_d
        )
        SELECT
          MAX(COALESCE(NULLIF(TRIM(d.full_name), ''), '—')) AS doctor_name,
          COALESCE(
            SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))),
            0
          )::float8 AS amount
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        LEFT JOIN appointments a ON a.id = i.appointment_id AND a.deleted_at IS NULL
        LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE p.deleted_at IS NULL
          AND i.status NOT IN ('cancelled', 'refunded')
          AND p.clinic_id = $2
          AND (p.created_at AT TIME ZONE $1::text)::date >= (SELECT today_d - 29 FROM b)
          AND (p.created_at AT TIME ZONE $1::text)::date <= (SELECT today_d FROM b)
        GROUP BY a.doctor_id
        HAVING COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0) > 0
        ORDER BY amount DESC
        LIMIT 5
        `,
        [tz, clinicId]
      ),
      dbPool.query<{ service_name: string | null; amount: string | number; cnt: string | number }>(
        `
        WITH b AS (
          SELECT (now() AT TIME ZONE $1::text)::date AS today_d
        )
        SELECT
          MAX(
            CASE
              WHEN ii.service_id IS NULL THEN 'Без услуги'
              ELSE COALESCE(NULLIF(TRIM(s.name), ''), '—')
            END
          ) AS service_name,
          COUNT(DISTINCT ii.id)::int AS cnt,
          COALESCE(
            SUM(
              GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))
              * (ii.line_total::numeric / NULLIF(ls.lines_sum, 0))
            ),
            0
          )::float8 AS amount
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
        INNER JOIN invoice_items ii ON ii.invoice_id = i.id
        INNER JOIN LATERAL (
          SELECT COALESCE(SUM(i2.line_total), 0)::numeric AS lines_sum
          FROM invoice_items i2
          WHERE i2.invoice_id = i.id
        ) ls ON ls.lines_sum > 0
        LEFT JOIN services s ON s.id = ii.service_id
        WHERE p.deleted_at IS NULL
          AND i.status NOT IN ('cancelled', 'refunded')
          AND p.clinic_id = $2
          AND (p.created_at AT TIME ZONE $1::text)::date >= (SELECT today_d - 29 FROM b)
          AND (p.created_at AT TIME ZONE $1::text)::date <= (SELECT today_d FROM b)
        GROUP BY ii.service_id
        HAVING COALESCE(
          SUM(
            GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))
            * (ii.line_total::numeric / NULLIF(ls.lines_sum, 0))
          ),
          0
        ) > 0
        ORDER BY amount DESC
        LIMIT 5
        `,
        [tz, clinicId]
      ),
    ]);

    const t = totalsRes.rows[0];
    return {
      revenueToday: num(t?.revenue_today ?? 0),
      revenueYesterday: num(t?.revenue_yesterday ?? 0),
      revenueWeek: num(t?.revenue_week ?? 0),
      revenuePreviousWeek: num(t?.revenue_previous_week ?? 0),
      revenueMonth: num(t?.revenue_month ?? 0),
      revenueByDay: byDayRes.rows.map((r) => ({ date: r.date, amount: num(r.amount) })),
      revenueByDoctor: byDoctorRes.rows.map((r) => ({
        doctorName: r.doctor_name ?? "—",
        amount: num(r.amount),
      })),
      revenueByService: byServiceRes.rows.map((r) => ({
        serviceName: r.service_name ?? "—",
        amount: num(r.amount),
        count: Math.round(num(r.cnt)),
      })),
    };
  }

  async getRecommendationsAnalytics(): Promise<RecommendationsAnalyticsData> {
    const clinicId = requireClinicId();
    const tz = env.reportsTimezone;
    const dateTo = formatYmdInTimeZone(new Date(), tz);
    const dateFrom = addDaysYmd(dateTo, -6);

    const [
      metrics,
      byDoctor,
      byService,
      points,
      countRes,
      todayRes,
      unpaidRes,
      loadsRes,
    ] = await Promise.all([
      this.getReportMetrics({}),
      this.getRevenueByDoctor({}),
      this.getRevenueByService({}),
      this.getRevenueReport("day", { dateFrom, dateTo }),
      dbPool.query<{ c: string | number }>(
        `
          SELECT COUNT(*)::int AS c
          FROM payments p
          INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
          WHERE i.status NOT IN ('cancelled', 'refunded')
            AND p.deleted_at IS NULL
            AND p.clinic_id = $1
        `,
        [clinicId]
      ),
      dbPool.query<{ total: string | number }>(
        `
          SELECT COALESCE(SUM(GREATEST(0::numeric, p.amount - COALESCE(p.refunded_amount, 0))), 0)::float8 AS total
          FROM payments p
          INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
          WHERE i.status NOT IN ('cancelled', 'refunded')
            AND p.deleted_at IS NULL
            AND p.clinic_id = $2
            AND date_trunc('day', p.created_at AT TIME ZONE $1::text)
              = date_trunc('day', now() AT TIME ZONE $1::text)
        `,
        [tz, clinicId]
      ),
      dbPool.query<{ c: string | number }>(
        `
          SELECT COUNT(*)::int AS c
          FROM invoices inv
          WHERE inv.deleted_at IS NULL
            AND inv.status IN ('issued', 'partially_paid')
            AND inv.clinic_id = $1
        `,
        [clinicId]
      ),
      dbPool.query<{ doctor_name: string; load_pct: string | number }>(
        `
          WITH doc AS (
            SELECT
              d.id,
              MAX(COALESCE(NULLIF(TRIM(d.full_name), ''), 'Врач #' || d.id::text)) AS doctor_name,
              COUNT(*)::int AS cnt
            FROM appointments a
            INNER JOIN doctors d ON d.id = a.doctor_id
            WHERE a.deleted_at IS NULL
              AND d.deleted_at IS NULL
              AND a.clinic_id = $1
              AND a.start_at >= (now() - interval '30 days')
            GROUP BY d.id
          ),
          tot AS (
            SELECT COALESCE(SUM(cnt), 0)::int AS total FROM doc
          )
          SELECT doc.doctor_name,
            CASE
              WHEN tot.total > 0 THEN ROUND((doc.cnt::numeric / tot.total::numeric) * 100, 1)::float8
              ELSE 0::float8
            END AS load_pct
          FROM doc
          CROSS JOIN tot
          ORDER BY doc.cnt DESC
          LIMIT 8
        `,
        [clinicId]
      ),
    ]);

    const pointMap = new Map(points.map((p) => [p.periodStart, p.totalRevenue]));
    const dailyRevenueLast7Days: number[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const ymd = addDaysYmd(dateTo, -i);
      dailyRevenueLast7Days.push(num(pointMap.get(ymd) ?? 0));
    }

    const topD = byDoctor[0];
    const topS = byService[0];
    const topDoctor =
      topD && (topD.totalRevenue > 0 || topD.doctorName)
        ? { name: topD.doctorName ?? "—", revenue: num(topD.totalRevenue) }
        : null;
    const topService =
      topS && (topS.totalRevenue > 0 || topS.serviceName)
        ? { name: topS.serviceName ?? "—", revenue: num(topS.totalRevenue) }
        : null;

    return {
      qualifyingPaymentsCount: num(countRes.rows[0]?.c ?? 0),
      revenueTotal: metrics.totalPaymentsAmount,
      revenueToday: num(todayRes.rows[0]?.total ?? 0),
      topDoctor,
      topService,
      unpaidInvoicesCount: num(unpaidRes.rows[0]?.c ?? 0),
      dailyRevenueLast7Days,
      doctorLoads: loadsRes.rows.map((r) => ({
        doctorName: r.doctor_name,
        loadPct: num(r.load_pct),
      })),
    };
  }
}
