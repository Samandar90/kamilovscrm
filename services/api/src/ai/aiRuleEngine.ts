import { dbPool } from "../config/database";
import { env } from "../config/env";
import { getMockDb } from "../repositories/mockDatabase";
import { errorForLog, textForLog } from "../utils/logRedaction";
import type { AIAssistantAskResponse } from "./aiTypes";
import type { AiAskQuickIntent, AiDataIntent, ClinicFactsSnapshot } from "./aiTypes";

export const formatSum = (value: number): string => `${Math.round(value).toLocaleString("ru-RU")} сум`;

const normalize = (raw: string): string => raw.toLowerCase().replace(/\s+/g, " ").trim();

const wrapIlike = (raw: string): string => {
  const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${escaped}%`;
};

export class AiRuleEngine {
  answerHybrid(intent: AiDataIntent, data: Record<string, unknown>): string {
    try {
    if (intent === "revenue") {
      const revenueToday = Number(data.revenueToday ?? data.total ?? 0);
      const paymentsCountToday = Number(data.paymentsCountToday ?? 0);
      if (paymentsCountToday === 0 && revenueToday === 0) {
        return "Сегодня выручка составила 0 сум — по данным CRM нет учтённых оплат по счетам (не отменённым и не возвращённым) за текущий календарный день.";
      }
      return `Сегодня выручка составила ${formatSum(revenueToday)}.`;
    }
    if (intent === "unpaid") {
      const unpaidCount = Number(data.unpaidCount ?? 0);
      const unpaidTotal = Number(data.unpaidTotal ?? 0);
      return `Неоплаченных счетов: ${unpaidCount} на сумму ${formatSum(unpaidTotal)}. Рекомендация: закрыть остатки и проконтролировать дебиторку.`;
    }
    if (intent === "top_doctor") {
      const topDoctor = (data.topDoctor ?? null) as { name?: string; total?: number; share?: number } | null;
      if (!topDoctor) return "Пока недостаточно оплат, привязанных к врачам, для рейтинга.";
      const share = Number(topDoctor.share ?? 0);
      return `Топ-врач по оплаченной выручке: ${topDoctor.name ?? "—"} (${formatSum(Number(topDoctor.total ?? 0))}${share > 0 ? `, ~${share}% от суммы по врачам` : ""}).`;
    }
    if (intent === "top_service") {
      const topService = (data.topService ?? null) as { name?: string; total?: number } | null;
      if (!topService) return "Пока недостаточно оплат по услугам для рейтинга.";
      return `Топ-услуга по оплатам: ${topService.name ?? "—"} (${formatSum(Number(topService.total ?? 0))}).`;
    }
    if (intent === "cash_status") {
      const cashShiftOpen = Boolean(data.cashShiftOpen);
      return cashShiftOpen
        ? "Кассовая смена открыта — приём оплат возможен. Проверьте возвраты и остаток в кассе."
        : "Кассовая смена закрыта — откройте смену в разделе Касса перед приёмом оплат.";
    }
    return this.localHealthFromData(data);
    } catch (error) {
      console.error("[AI RULE ENGINE] answerHybrid", errorForLog(error));
      return "Не удалось получить данные CRM";
    }
  }

  localHealthFromData(data: Record<string, unknown>): string {
    const unpaid = Number(data.unpaidCount ?? 0);
    const revenueToday = Number(data.revenueToday ?? 0);
    const appointmentsToday = Number(data.appointmentsToday ?? 0);
    const avg7 = Number(data.avgDailyRevenue7Days ?? 0);
    const avgCt = Number(data.avgCheckToday ?? 0);
    const avgC7 = Number(data.avgCheck7d ?? 0);
    const topDoctor = data.topDoctor as { name?: string; total?: number } | null | undefined;
    const noShow = Number(data.noShowOrCancelled30d ?? 0);
    const lines: string[] = ["Кратко по CRM:"];
    if (revenueToday === 0 && avg7 === 0) {
      lines.push("За сегодня и за неделю нет учтённых оплат — проверьте кассу и выставление счетов.");
    } else if (revenueToday === 0) {
      lines.push("Сегодня оплат нет — проверьте записи и напоминания пациентам.");
    }
    if (unpaid >= 5) lines.push(`Много неоплаченных счетов (${unpaid}).`);
    else if (unpaid > 0) lines.push(`Есть неоплаченные счета (${unpaid}).`);
    if (appointmentsToday === 0) lines.push("На сегодня нет записей — усильте загрузку и маркетинг.");
    else if (appointmentsToday > 0 && appointmentsToday < 3) lines.push("Низкая загрузка по записям на сегодня.");
    if (topDoctor?.name) lines.push(`Лидер по оплатам: ${topDoctor.name}.`);
    if (avg7 > 0 && revenueToday > avg7 * 1.05) lines.push("Выручка сегодня выше среднего за неделю.");
    if (avgC7 > 0 && avgCt > 0 && avgCt < avgC7 * 0.86) {
      lines.push(`Средний чек сегодня ниже среднего за 7 дней — рассмотрите апсейл и пакеты.`);
    }
    if (noShow > 3) lines.push(`Много отмен/no-show за месяц (${noShow}) — усильте подтверждения визитов.`);
    return lines.join(" ");
  }

  /** Детерминированные рекомендации (уровень A), без LLM. */
  buildLocalRecommendationsList(facts: ClinicFactsSnapshot): string[] {
    const lines: string[] = [];
    if (facts.revenueToday === 0 && facts.revenue7d > 0) {
      lines.push("Сегодня оплат нет — сверьте кассу и напоминания по записям.");
    }
    if (facts.revenueToday === 0 && facts.revenue7d === 0) {
      lines.push("Нет учтённых оплат за неделю — проверьте процесс выставления счетов и оплаты.");
    }
    if (facts.unpaidCount > 0) {
      lines.push(`Дебиторка: ${facts.unpaidCount} счетов, ${formatSum(facts.unpaidTotal)} к оплате.`);
    }
    if (facts.avgCheck7d > 0 && facts.avgCheckToday > 0 && facts.avgCheckToday < facts.avgCheck7d * 0.86) {
      lines.push(
        `Средний чек сегодня ниже недельного на ${Math.round((1 - facts.avgCheckToday / facts.avgCheck7d) * 100)}% — апсейл после консультации.`
      );
    }
    if (facts.appointmentsToday < 3 && facts.doctorsCount > 0 && facts.revenueToday === 0) {
      lines.push("Мало записей на сегодня — маркетинг и напоминания.");
    }
    if (facts.appointmentsScheduledToday > facts.appointmentsCompletedToday * 2 && facts.appointmentsScheduledToday > 3) {
      lines.push("Много ожидающих визитов при мало завершённых — подтверждайте записи.");
    }
    if (facts.noShowOrCancelled30d > 5) {
      lines.push(`За 30 дней отмен/no-show: ${facts.noShowOrCancelled30d} — укрепите подтверждения и удержание.`);
    }
    if (facts.cashShiftOpen === false) {
      lines.push("Касса закрыта — откройте смену для приёма оплат.");
    }
    if (lines.length === 0) lines.push("Следите за оплатами в Биллинге и загрузкой расписания.");
    return lines.slice(0, 6);
  }

  generateLocalAnswerFromFacts(facts: ClinicFactsSnapshot): string {
    return this.buildLocalRecommendationsList(facts).slice(0, 3).join(" ");
  }

  fallbackGeneralCrmAdvice(facts: ClinicFactsSnapshot): string {
    const todayLine =
      facts.paymentsCountToday === 0 && facts.revenueToday === 0
        ? "Сегодня по CRM: 0 сум выручки (нет учтённых оплат за день)."
        : `Сегодня выручка ${formatSum(facts.revenueToday)}`;
    const parts = [
      `${todayLine}. За 7 дней: ${formatSum(facts.revenue7d)}.`,
      facts.unpaidCount > 0
        ? `Неоплаченных счетов: ${facts.unpaidCount} (${formatSum(facts.unpaidTotal)}).`
        : "Неоплаченных счетов нет.",
      facts.topDoctorName ? `Лидер по оплатам: ${facts.topDoctorName}.` : "",
    ].filter(Boolean);
    return parts.join(" ");
  }

  fallbackOwnerRecommendations(facts: ClinicFactsSnapshot): string {
    const todayPart =
      facts.paymentsCountToday === 0 ? "Нет оплат сегодня" : formatSum(facts.revenueToday);
    const parts = [
      `Сегодня ${todayPart}, за 7 дней ${formatSum(facts.revenue7d)}, неоплаченных: ${facts.unpaidCount}.`,
      facts.cashShiftOpen ? "Смена открыта." : "Откройте кассовую смену.",
    ];
    return parts.join(" ");
  }

  /**
   * Короткий ответ без LLM для «общих» формулировок, если уже есть сильные сигналы в данных.
   */
  tryDeterministicGeneralAnswer(message: string, facts: ClinicFactsSnapshot): string | null {
    const t = normalize(message);
    if (facts.unpaidCount > 5 && (t.includes("проблем") || t.includes("риск") || t.includes("что не так"))) {
      return `По данным CRM: ${facts.unpaidCount} неоплаченных счетов на ${formatSum(facts.unpaidTotal)} — в приоритете дебиторка и контроль оплат.`;
    }
    if (facts.revenueToday === 0 && facts.revenue7d > 1000 && t.includes("сегодня")) {
      return `Сегодня в CRM: 0 сум, за последние 7 дней было ${formatSum(facts.revenue7d)} — это разные календарные дни; цифра за сегодня относится только к текущему дню.`;
    }
    return null;
  }

  async answerAskQuick(
    intent: AiAskQuickIntent,
    facts: ClinicFactsSnapshot,
    message: string
  ): Promise<AIAssistantAskResponse | null> {
    try {
    if (intent === "unknown") return null;
    const text = normalize(message);

    if (intent === "revenue_today") {
      const unpaidLine =
        facts.unpaidCount > 0
          ? ` Неоплаченных счетов: ${facts.unpaidCount} на ${formatSum(facts.unpaidTotal)}.`
          : "";
      if (facts.paymentsCountToday === 0 && facts.revenueToday === 0) {
        return {
          answer:
            "Сегодня выручка составила 0 сум — в CRM нет учтённых оплат по счетам за текущий календарный день (в отчётной зоне клиники)." +
            unpaidLine,
          suggestions: ["Какая выручка за неделю?", "Общая выручка за всё время"],
        };
      }
      return {
        answer: `Сегодня выручка составила ${formatSum(facts.revenueToday)}.${unpaidLine}`,
        suggestions: ["Какая выручка за неделю?", "Кто приносит больше выручки?"],
      };
    }
    if (intent === "revenue_7d") {
      if (facts.revenue7d <= 0 && facts.paymentsCount7d === 0) {
        return {
          answer: "За последние 7 дней выручка составила 0 сум — нет учтённых оплат по счетам за этот период.",
          suggestions: ["Сколько заработали сегодня?", "Общая выручка за всё время"],
        };
      }
      return {
        answer: `За последние 7 дней выручка составила ${formatSum(facts.revenue7d)}.`,
        suggestions: ["Сколько заработали сегодня?", "Кто приносит больше выручки?"],
      };
    }
    if (intent === "revenue_total") {
      if (facts.revenueTotal <= 0) {
        return {
          answer:
            "Общая выручка за всё время: 0 сум — в CRM нет учтённых оплат по счетам или данные ещё не загружены.",
          suggestions: ["Сколько заработали сегодня?", "Какая выручка за неделю?"],
        };
      }
      return {
        answer: `Общая выручка за всё время: ${formatSum(facts.revenueTotal)}.`,
        suggestions: ["Сколько заработали сегодня?", "Какая выручка за неделю?"],
      };
    }
    if (intent === "unpaid_invoices") {
      return {
        answer: `Сейчас ${facts.unpaidCount} неоплаченных счетов на сумму ${formatSum(facts.unpaidTotal)}.`,
        action: { type: "navigate", payload: { to: "/billing/invoices" } },
        suggestions: ["Перейти в счета", "Сколько заработали сегодня?"],
      };
    }
    if (intent === "top_doctor") {
      if (!facts.topDoctorName) {
        return {
          answer:
            "Пока недостаточно оплат, привязанных к врачам, чтобы назвать лидера. Как только накопятся данные, картина станет яснее.",
          suggestions: ["Сколько заработали сегодня?", "Есть ли проблемы в кассе?"],
        };
      }
      return {
        answer: `Больше всего выручки приносит ${facts.topDoctorName} — ${formatSum(facts.topDoctorTotal)}.`,
        action: { type: "navigate", payload: { to: "/reports" } },
        suggestions: ["Сколько заработали сегодня?", "Найди пациента "],
      };
    }
    if (intent === "top_service") {
      if (!facts.topServiceName) {
        return {
          answer: "Пока мало оплат по услугам для сравнения.",
          suggestions: ["Кто приносит больше выручки?", "Сколько заработали сегодня?"],
        };
      }
      return {
        answer: `По сумме оплат лидирует услуга «${facts.topServiceName}» (${formatSum(facts.topServiceTotal)}).`,
        action: { type: "navigate", payload: { to: "/reports" } },
        suggestions: ["Кто приносит больше выручки?", "Есть ли проблемы в кассе?"],
      };
    }
    if (intent === "setup_status") {
      const ready = facts.doctorsCount > 0 && facts.servicesCount > 0 && facts.appointmentsCount > 0;
      return {
        answer: ready
          ? "CRM настроена базово: есть врачи, услуги и записи."
          : `Нужно наполнить справочники: врачи ${facts.doctorsCount}, услуги ${facts.servicesCount}, записи ${facts.appointmentsCount}.`,
        action: { type: "navigate", payload: { to: "/doctors" } },
      };
    }
    if (intent === "cashier_status") {
      const debt =
        facts.unpaidCount > 0
          ? ` Неоплаченных счетов: ${facts.unpaidCount} на ${formatSum(facts.unpaidTotal)}.`
          : "";
      return {
        answer: facts.cashShiftOpen
          ? `Кассовая смена открыта.${debt}`
          : `Кассовая смена закрыта.${debt}`,
        action: { type: "navigate", payload: { to: "/billing/cash-desk" } },
        suggestions: ["Сколько заработали сегодня?", "Кто приносит больше выручки?"],
      };
    }
    if (intent === "patient_search") {
      return this.answerPatientSearch(message);
    }
    if (intent === "business_advice") {
      if (facts.avgCheck7d > 0 && facts.avgCheckToday > 0 && facts.avgCheckToday < facts.avgCheck7d * 0.9) {
        const pct = Math.round((1 - facts.avgCheckToday / facts.avgCheck7d) * 100);
        return {
          answer: `Средний чек сегодня ниже среднего за 7 дней примерно на ${pct}% — добавьте сопутствующие услуги и пакеты после консультации.`,
          suggestions: ["Сколько заработали сегодня?", "Кто приносит больше выручки?"],
        };
      }
      if (facts.servicesCount < 3) {
        return {
          answer: "В справочнике мало услуг — расширьте прайс для апсейла и кросс-продаж.",
          suggestions: ["Сколько заработали сегодня?", "Есть ли проблемы в кассе?"],
        };
      }
      if (facts.unpaidCount > 0) {
        return {
          answer: `Сократите задолженность по ${facts.unpaidCount} счетам — это улучшит cashflow.`,
          suggestions: ["Есть ли проблемы в кассе?", "Сколько заработали сегодня?"],
        };
      }
      return {
        answer: `Средний чек сегодня ${formatSum(facts.avgCheckToday)}, за 7 дней ${formatSum(facts.avgCheck7d)}. Добавьте пакеты и контроль повторных визитов.`,
        suggestions: ["Сколько заработали сегодня?", "Кто приносит больше выручки?"],
      };
    }
    if (intent === "help_navigation") {
      if (text.includes("касс")) {
        return {
          answer: "Касса: Биллинг → Касса.",
          action: { type: "navigate", payload: { to: "/billing/cash-desk" } },
        };
      }
      if (text.includes("счет")) {
        return {
          answer: "Счета: Биллинг → Счета.",
          action: { type: "navigate", payload: { to: "/billing/invoices" } },
        };
      }
      if (text.includes("запис")) {
        return {
          answer: "Записи — раздел «Записи».",
          action: { type: "open_quick_create_appointment" },
        };
      }
      return { answer: "Могу подсказать путь к кассе, счетам, записям и отчётам." };
    }
    return null;
    } catch (error) {
      console.error("[AI RULE ENGINE] answerAskQuick", errorForLog(error));
      return { answer: "Не удалось получить данные CRM", suggestions: [] };
    }
  }

  private async answerPatientSearch(message: string): Promise<AIAssistantAskResponse> {
    try {
    const raw = message.trim();
    let q =
      /^найди\s+(?:пациента\s+)?(.+)/i.exec(raw)?.[1]?.trim() ??
      /^покажи\s+(?:пациента\s+)?(.+)/i.exec(raw)?.[1]?.trim() ??
      "";
    if (!q) {
      return { answer: "Уточните запрос, например: Найди пациента Иван или по телефону." };
    }
    // eslint-disable-next-line no-console
    console.log("[AI] patient_search query", JSON.stringify(textForLog(q)));

    if (env.dataProvider === "postgres") {
      const pattern = wrapIlike(q);
      const digits = q.replace(/\D/g, "");
      const idOnly = /^\d+$/.test(q) ? q : null;
      const rows = await dbPool.query<{ id: string; full_name: string; phone: string | null }>(
        `
        SELECT id::text, full_name, phone
        FROM patients
        WHERE deleted_at IS NULL
          AND (
            full_name ILIKE $1 ESCAPE '\\'
            OR phone ILIKE $1 ESCAPE '\\'
            OR ($3::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $3 || '%')
            OR ($2::text IS NOT NULL AND id::text = $2)
          )
        ORDER BY created_at DESC
        LIMIT 8
        `,
        [pattern, idOnly, digits.length >= 3 ? digits : ""]
      );
      // eslint-disable-next-line no-console
      console.log("[AI] patient_search rows count", rows.rows.length);
      if (rows.rows.length === 0) {
        return { answer: "Пациент не найден." };
      }
      const list = rows.rows
        .map((r) => `${r.full_name}${r.phone ? `, ${r.phone}` : ""}`)
        .join("; ");
      return {
        answer:
          rows.rows.length === 1
            ? `Найден: ${list}.`
            : `Найдено (${rows.rows.length}): ${list}.`,
        action: { type: "navigate", payload: { to: "/patients" } },
      };
    }

    const found = getMockDb().patients.filter((p) => {
      const name = p.fullName.toLowerCase().includes(q.toLowerCase());
      const phone = p.phone?.includes(q) ?? false;
      return name || phone;
    });
    // eslint-disable-next-line no-console
    console.log("[AI] patient_search rows count", found.length);
    if (found.length === 0) return { answer: "Пациент не найден." };
    const list = found
      .slice(0, 8)
      .map((p) => `${p.fullName}${p.phone ? `, ${p.phone}` : ""}`)
      .join("; ");
    return {
      answer: found.length === 1 ? `Найден: ${list}.` : `Найдено (${found.length}): ${list}.`,
      action: { type: "navigate", payload: { to: "/patients" } },
    };
    } catch (error) {
      console.error("[AI RULE ENGINE] answerPatientSearch", errorForLog(error));
      return { answer: "Не удалось получить данные CRM", suggestions: [] };
    }
  }
}
