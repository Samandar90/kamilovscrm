import { dbPool } from "../../config/database";
import { env } from "../../config/env";
import { errorForLog } from "../../utils/logRedaction";
import { getMockDb } from "../mockDatabase";

/** Метрики утреннего брифинга (согласованы с `AIService.getMorningBriefingData`). */
export type MorningBriefingData = {
  revenueYesterday: number;
  /** Выручка за календарный день до «вчера»: [y0−1d, y0). */
  revenueBeforeYesterday: number;
  /** Среднесуточная выручка за 7 календарных дней до «вчера» (интервалы [y0−7d,y0−6d) … [y0−1d,y0)), та же TZ и doctor scope. */
  revenueAvgPrior7Days: number;
  patientsYesterday: number;
  /** Визиты (приёмы) за день до «вчера», те же статусы, что и patientsYesterday. */
  patientsBeforeYesterday: number;
  newPatientsYesterday: number;
  cancellationsYesterday: number;
  unpaidInvoicesCount: number;
  appointmentsToday: number;
  /**
   * Свободные слоты на сегодня (оценка). Если в продукте нет источника — null.
   */
  freeSlotsToday: number | null;
};

/** Отчётная зона (по умолчанию Asia/Tashkent). Передаётся в SQL как $1. */
export const MORNING_BRIEFING_TIMEZONE = "Asia/Tashkent";

/**
 * Границы «вчера» и «сегодня» в IANA-TZ: [start, end) для использования с timestamptz.
 * Индексы: payments(created_at), appointments(doctor_id,start_at), patients(created_at) — см. sql/*_patch.sql.
 */
const SQL_BOUNDS_CTE = `
  b AS (
    SELECT
      ((date_trunc('day', (now() AT TIME ZONE $1::text)::timestamp) - interval '1 day')
        ::timestamp AT TIME ZONE $1::text) AS y0,
      ((date_trunc('day', (now() AT TIME ZONE $1::text)::timestamp))
        ::timestamp AT TIME ZONE $1::text) AS y1,
      ((date_trunc('day', (now() AT TIME ZONE $1::text)::timestamp))
        ::timestamp AT TIME ZONE $1::text) AS t0,
      ((date_trunc('day', (now() AT TIME ZONE $1::text)::timestamp) + interval '1 day')
        ::timestamp AT TIME ZONE $1::text) AS t1
  )
`;

/** Один round-trip: все скаляры из общего CTE границ. $1 = TZ, $2 = doctor_id или NULL (вся клиника). */
const SQL_MORNING_BRIEFING_PG = `
WITH ${SQL_BOUNDS_CTE}
SELECT
  (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
    CROSS JOIN b
    WHERE p.deleted_at IS NULL
      AND p.created_at >= b.y0 AND p.created_at < b.y1
      AND (
        $2::integer IS NULL
        OR EXISTS (
          SELECT 1
          FROM invoices i
          INNER JOIN appointments a
            ON a.id = i.appointment_id AND a.deleted_at IS NULL
          WHERE i.id = p.invoice_id
            AND i.deleted_at IS NULL
            AND a.doctor_id = $2
        )
      )
  )::text AS revenue_yesterday,
  (
    SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
    CROSS JOIN b
    WHERE p.deleted_at IS NULL
      AND p.created_at >= b.y0 - interval '1 day'
      AND p.created_at < b.y0
      AND (
        $2::integer IS NULL
        OR EXISTS (
          SELECT 1
          FROM invoices i
          INNER JOIN appointments a
            ON a.id = i.appointment_id AND a.deleted_at IS NULL
          WHERE i.id = p.invoice_id
            AND i.deleted_at IS NULL
            AND a.doctor_id = $2
        )
      )
  )::text AS revenue_before_yesterday,
  (
    SELECT COALESCE(SUM(lt.day_tot), 0)::numeric / 7.0
    FROM b
    CROSS JOIN generate_series(0, 6) AS s(n)
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS day_tot
      FROM payments p
      WHERE p.deleted_at IS NULL
        AND p.created_at >= b.y0 - ((s.n + 1) * interval '1 day')
        AND p.created_at < b.y0 - (s.n * interval '1 day')
        AND (
          $2::integer IS NULL
          OR EXISTS (
            SELECT 1
            FROM invoices i
            INNER JOIN appointments a2
              ON a2.id = i.appointment_id AND a2.deleted_at IS NULL
            WHERE i.id = p.invoice_id
              AND i.deleted_at IS NULL
              AND a2.doctor_id = $2
          )
        )
    ) lt
  )::text AS revenue_avg_prior_7d,
  (
    SELECT COUNT(*)::bigint
    FROM appointments a
    CROSS JOIN b
    WHERE a.deleted_at IS NULL
      AND a.start_at >= b.y0 AND a.start_at < b.y1
      AND a.status NOT IN ('cancelled', 'no_show')
      AND ($2::integer IS NULL OR a.doctor_id = $2)
  )::text AS patients_yesterday,
  (
    SELECT COUNT(*)::bigint
    FROM appointments a
    CROSS JOIN b
    WHERE a.deleted_at IS NULL
      AND a.start_at >= b.y0 - interval '1 day'
      AND a.start_at < b.y0
      AND a.status NOT IN ('cancelled', 'no_show')
      AND ($2::integer IS NULL OR a.doctor_id = $2)
  )::text AS patients_before_yesterday,
  (
    SELECT COUNT(*)::bigint
    FROM patients pat
    CROSS JOIN b
    WHERE pat.deleted_at IS NULL
      AND pat.created_at >= b.y0 AND pat.created_at < b.y1
      AND (
        $2::integer IS NULL
        OR EXISTS (
          SELECT 1 FROM appointments ax
          WHERE ax.deleted_at IS NULL
            AND ax.patient_id = pat.id
            AND ax.doctor_id = $2
        )
      )
  )::text AS new_patients_yesterday,
  (
    SELECT COUNT(*)::bigint
    FROM appointments a
    CROSS JOIN b
    WHERE a.deleted_at IS NULL
      AND a.status = 'cancelled'
      AND a.start_at >= b.y0 AND a.start_at < b.y1
      AND ($2::integer IS NULL OR a.doctor_id = $2)
  )::text AS cancellations_yesterday,
  (
    SELECT COUNT(*)::bigint
    FROM invoices inv
    WHERE inv.deleted_at IS NULL
      AND inv.status <> 'paid'
      AND (
        $2::integer IS NULL
        OR EXISTS (
          SELECT 1 FROM appointments au
          WHERE au.id = inv.appointment_id
            AND au.deleted_at IS NULL
            AND au.doctor_id = $2
        )
      )
  )::text AS unpaid_invoices,
  (
    SELECT COUNT(*)::bigint
    FROM appointments a
    CROSS JOIN b
    WHERE a.deleted_at IS NULL
      AND a.start_at >= b.t0 AND a.start_at < b.t1
      AND ($2::integer IS NULL OR a.doctor_id = $2)
  )::text AS appointments_today,
  NULL::text AS free_slots_today
`;

function boundsForMock(): { y0: number; y1: number; t0: number; t1: number } {
  const tz = MORNING_BRIEFING_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = (d: Date) => {
    const s = fmt.format(d);
    const [y, m, day] = s.split("-").map(Number);
    return { y, m, day };
  };
  const utcMidnightForLocalCalendar = (y: number, m: number, day: number): number => {
    const guess = Date.UTC(y, m - 1, day, 12, 0, 0);
    let t = guess;
    for (let i = 0; i < 3; i += 1) {
      const p = parts(new Date(t));
      const want = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const got = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      if (got === want) break;
      t += (want < got ? -1 : 1) * 60 * 60 * 1000;
    }
    return t;
  };
  const now = Date.now();
  const { y, m, day } = parts(new Date(now));
  const t0 = utcMidnightForLocalCalendar(y, m, day);
  const t1 = t0 + 86_400_000;
  const prev = new Date(t0 - 86_400_000);
  const py = parts(prev);
  const y0 = utcMidnightForLocalCalendar(py.y, py.m, py.day);
  const y1 = t0;
  return { y0, y1, t0, t1 };
}

function loadMockMorningBriefingData(doctorId: number | null): MorningBriefingData {
  const db = getMockDb();
  const { y0, y1, t0, t1 } = boundsForMock();

  const inRange = (ts: string, start: number, end: number) => {
    const x = new Date(ts).getTime();
    return x >= start && x < end;
  };

  const apptScope = (doctor: number | null, a: (typeof db.appointments)[0]) =>
    doctor == null || a.doctorId === doctor;

  const paymentInDoctorScope = (p: (typeof db.payments)[0]): boolean => {
    if (doctorId == null) return true;
    const inv = db.invoices.find((i) => i.id === p.invoiceId);
    if (!inv || inv.deletedAt) return false;
    if (inv.appointmentId == null) return false;
    const ap = db.appointments.find((x) => x.id === inv.appointmentId);
    return ap != null && ap.doctorId === doctorId;
  };

  let revenueYesterday = 0;
  for (const p of db.payments) {
    if (p.deletedAt) continue;
    if (!inRange(p.createdAt, y0, y1)) continue;
    if (!paymentInDoctorScope(p)) continue;
    revenueYesterday += p.amount;
  }

  const by0 = y0 - 86_400_000;
  const by1 = y0;
  let revenueBeforeYesterday = 0;
  for (const p of db.payments) {
    if (p.deletedAt) continue;
    if (!inRange(p.createdAt, by0, by1)) continue;
    if (!paymentInDoctorScope(p)) continue;
    revenueBeforeYesterday += p.amount;
  }

  const y0Ms = y0;
  let revenueSumPrior7 = 0;
  for (let n = 0; n < 7; n += 1) {
    const segEnd = y0Ms - n * 86_400_000;
    const segStart = y0Ms - (n + 1) * 86_400_000;
    let dayTot = 0;
    for (const p of db.payments) {
      if (p.deletedAt) continue;
      if (!paymentInDoctorScope(p)) continue;
      const t = new Date(p.createdAt).getTime();
      if (t >= segStart && t < segEnd) dayTot += p.amount;
    }
    revenueSumPrior7 += dayTot;
  }
  const revenueAvgPrior7Days = revenueSumPrior7 / 7;

  const patientsYesterday = db.appointments.filter(
    (a) =>
      apptScope(doctorId, a) &&
      inRange(a.startAt, y0, y1) &&
      a.status !== "cancelled" &&
      a.status !== "no_show"
  ).length;

  const patientsBeforeYesterday = db.appointments.filter(
    (a) =>
      apptScope(doctorId, a) &&
      inRange(a.startAt, by0, by1) &&
      a.status !== "cancelled" &&
      a.status !== "no_show"
  ).length;

  const cancellationsYesterday = db.appointments.filter(
    (a) =>
      apptScope(doctorId, a) &&
      a.status === "cancelled" &&
      inRange(a.startAt, y0, y1)
  ).length;

  const newPatientsYesterday = db.patients.filter((pat) => {
    if (pat.deletedAt) return false;
    if (!inRange(pat.createdAt, y0, y1)) return false;
    if (doctorId == null) return true;
    return db.appointments.some((ax) => ax.patientId === pat.id && ax.doctorId === doctorId);
  }).length;

  const unpaidInvoicesCount = db.invoices.filter((inv) => {
    if (inv.deletedAt) return false;
    if (inv.status === "paid") return false;
    if (doctorId == null) return true;
    if (inv.appointmentId == null) return false;
    const ap = db.appointments.find((x) => x.id === inv.appointmentId);
    return ap != null && ap.doctorId === doctorId;
  }).length;

  const appointmentsToday = db.appointments.filter(
    (a) => apptScope(doctorId, a) && inRange(a.startAt, t0, t1)
  ).length;

  return {
    revenueYesterday,
    revenueBeforeYesterday,
    revenueAvgPrior7Days,
    patientsYesterday,
    patientsBeforeYesterday,
    newPatientsYesterday,
    cancellationsYesterday,
    unpaidInvoicesCount,
    appointmentsToday,
    freeSlotsToday: null,
  };
}

/**
 * Сырые метрики для брифинга (PostgreSQL — один запрос; иначе mock-агрегация).
 * @param doctorId — только для врача: фильтр по doctor_id (остальные роли — null).
 */
export async function loadMorningBriefingData(doctorId: number | null): Promise<MorningBriefingData> {
  if (env.dataProvider !== "postgres") {
    return loadMockMorningBriefingData(doctorId);
  }

  const tz = env.reportsTimezone.trim() || MORNING_BRIEFING_TIMEZONE;

  try {
    const res = await dbPool.query<{
      revenue_yesterday: string;
      revenue_before_yesterday: string;
      revenue_avg_prior_7d: string;
      patients_yesterday: string;
      patients_before_yesterday: string;
      new_patients_yesterday: string;
      cancellations_yesterday: string;
      unpaid_invoices: string;
      appointments_today: string;
      free_slots_today: string | null;
    }>(SQL_MORNING_BRIEFING_PG, [tz, doctorId]);

    const row = res.rows[0];
    if (!row) {
      return loadMockMorningBriefingData(doctorId);
    }

    return {
      revenueYesterday: Number(row.revenue_yesterday ?? 0),
      revenueBeforeYesterday: Number(row.revenue_before_yesterday ?? 0),
      revenueAvgPrior7Days: Number(row.revenue_avg_prior_7d ?? 0),
      patientsYesterday: Number(row.patients_yesterday ?? 0),
      patientsBeforeYesterday: Number(row.patients_before_yesterday ?? 0),
      newPatientsYesterday: Number(row.new_patients_yesterday ?? 0),
      cancellationsYesterday: Number(row.cancellations_yesterday ?? 0),
      unpaidInvoicesCount: Number(row.unpaid_invoices ?? 0),
      appointmentsToday: Number(row.appointments_today ?? 0),
      freeSlotsToday:
        row.free_slots_today != null && row.free_slots_today !== ""
          ? Number(row.free_slots_today)
          : null,
    };
  } catch (e) {
    console.error("[morningBriefingMetricsRepository] PostgreSQL morning briefing failed", errorForLog(e));
    return loadMockMorningBriefingData(doctorId);
  }
}

/** @deprecated используйте `loadMorningBriefingData` */
export type MorningBriefingMetrics = MorningBriefingData;

/** @deprecated используйте `loadMorningBriefingData` */
export async function loadMorningBriefingMetrics(
  doctorId: number | null,
  _includeFinancial?: boolean
): Promise<MorningBriefingData> {
  void _includeFinancial;
  return loadMorningBriefingData(doctorId);
}
