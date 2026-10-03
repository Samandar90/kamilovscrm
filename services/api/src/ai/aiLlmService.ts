import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";
import type { UserRole } from "../auth/permissions";
import { env } from "../config/env";
import { hasOpenAI, openai } from "@/lib/openai";
import { textForLog } from "../utils/logRedaction";
import type { AiAssistantStructuredContext, AiDomainIntent, AiLlmSummaryFacts } from "./aiTypes";
import { formatSum } from "./aiRuleEngine";
import {
  redactStructuredContextForRole,
  redactSummaryFactsForRole,
} from "./aiAssistantRoleAccess";
import { getSystemPrompt } from "./aiAssistantRolePrompts";

/** Публичная модель чата — стабильное имя в API OpenAI (см. документацию Models). */
export const OPENAI_CHAT_MODEL = "gpt-4o-mini";

const MAX_OUT_TOKENS = 220;

/** Префикс ответа при сбое API (оркестратор не подменяет на rule-fallback). */
export const AI_UNAVAILABLE_PREFIX = "AI временно недоступен:";

/** @deprecated Используйте getSystemPrompt(role) в completeAssistantChat. */
export const ASSISTANT_CHAT_SYSTEM = `Устаревший базовый промпт; роль задаётся через getSystemPrompt(role).`;

const CRM_SNAPSHOT_RULES = `Интерпретация снимка:
— Нули и отсутствие оплат — это тоже факт CRM; формулируй нейтрально, без догадок о кассе, если это не следует из данных.
— Суммы выручки — net по счетам (как отчёты), зона дат — REPORTS_TIMEZONE в блоке фактов.
— Дай 1–2 практичных шага только там, где уместно; не заполняй ответ общими фразами.`;

function buildStructuredContextBlock(ctx: AiAssistantStructuredContext): string {
  const doctors = ctx.doctors.length > 0
    ? ctx.doctors.map((d) => `${d.name}${d.specialty ? ` (${d.specialty})` : ""}`).join("; ")
    : "нет данных";
  const services = ctx.activeServices.length > 0
    ? ctx.activeServices.map((s) => `${s.name}${s.price != null ? ` (${formatSum(s.price)})` : ""}`).join("; ")
    : "нет данных";
  return [
    "Структурированный контекст CRM:",
    `revenueToday=${ctx.revenueToday}`,
    `revenue7d=${ctx.revenue7d}`,
    `unpaidInvoicesCount=${ctx.unpaidInvoicesCount}`,
    `unpaidInvoicesAmount=${ctx.unpaidInvoicesAmount}`,
    `appointmentsToday=${ctx.appointmentsToday}`,
    `completedToday=${ctx.completedToday}`,
    `pendingToday=${ctx.pendingToday}`,
    `avgCheckToday=${ctx.avgCheckToday}`,
    `avgCheck7d=${ctx.avgCheck7d}`,
    `topDoctor=${ctx.topDoctor ?? "null"}`,
    `cashShiftStatus=${ctx.cashShiftStatus}`,
    `noShow30d=${ctx.noShow30d}`,
    `doctors=${doctors}`,
    `activeServices=${services}`,
  ].join("\n");
}

function keepOnlyRussianChars(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => /[а-яё]/i.test(line) || /\d/.test(line));
  return (filtered.length > 0 ? filtered : lines).join("\n");
}

function cutToMaxSentences(raw: string, maxSentences = 4): string {
  const parts = raw.match(/[^.!?]+[.!?]?/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  if (parts.length <= maxSentences) return raw.trim();
  return parts.slice(0, maxSentences).join(" ").trim();
}

export function shapeAssistantAnswer(raw: string): string {
  const cleaned = keepOnlyRussianChars(raw)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "Недостаточно данных.";

  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-•*]/.test(line));
  let normalized: string;
  if (bulletLines.length > 0) {
    normalized = bulletLines.slice(0, 3).map((line) => line.replace(/^[•*]/, "-")).join("\n");
  } else {
    normalized = cutToMaxSentences(cleaned, 3);
  }

  if (/^(as an ai|i am|assistant:)/i.test(normalized)) return "Недостаточно данных.";
  return normalized.slice(0, 560).trim() || "Недостаточно данных.";
}

/** Ключевые метрики для контекста в чате. */
export function formatCrmContextCompact(f: AiLlmSummaryFacts): string {
  const todayMoney =
    f.paymentsCountToday === 0
      ? "оплат сегодня не зафиксировано (0 платежей)"
      : `${formatSum(f.revenueToday)} (${f.paymentsCountToday} платежей)`;
  return [
    `Сегодня: ${todayMoney}`,
    `Записей на сегодня: ${f.appointmentsToday} (завершено ${f.appointmentsCompletedToday}, в ожидании ${f.appointmentsScheduledToday})`,
    `Неоплаченных счетов: ${f.unpaidCount} на ${formatSum(f.unpaidTotal)}`,
    `Средний чек сегодня: ${f.avgCheckToday > 0 ? formatSum(f.avgCheckToday) : "нет данных (нет платежей)"}`,
  ].join("\n");
}

/** Текст для промпта: только агрегаты, без массивов и сырых выгрузок. */
export function formatFactsForPrompt(f: AiLlmSummaryFacts): string {
  const todayLine =
    f.paymentsCountToday === 0
      ? `Выручка сегодня: оплат не зафиксировано (0 платежей; сумма по оплатам ${formatSum(f.revenueToday)})`
      : `Выручка сегодня: ${formatSum(f.revenueToday)} (${f.paymentsCountToday} платежей)`;
  return [
    todayLine,
    `Выручка за 7 дней: ${formatSum(f.revenue7d)} (${f.paymentsCount7d} платежей)`,
    `Выручка за всё время (все успешные оплаты в CRM): ${formatSum(f.revenueTotal)}`,
    `Средний чек сегодня / за 7 дней: ${f.avgCheckToday > 0 ? formatSum(f.avgCheckToday) : "—"} / ${f.avgCheck7d > 0 ? formatSum(f.avgCheck7d) : "—"}`,
    `Неоплаченных счетов: ${f.unpaidCount}, на сумму ${formatSum(f.unpaidTotal)}`,
    `Записей сегодня: всего ${f.appointmentsToday}, завершено ${f.appointmentsCompletedToday}, в ожидании ${f.appointmentsScheduledToday}`,
    `Отмен/no-show за 30 дней: ${f.noShowOrCancelled30d}`,
    `Средняя дневная выручка (7 дней): ${formatSum(f.avgDailyRevenue7Days)}`,
    `Смена кассы: ${f.cashShiftOpen ? "открыта" : "закрыта"}`,
    `Топ-врач по оплатам: ${f.topDoctorName ?? "нет данных"} (${f.topDoctorTotal > 0 ? formatSum(f.topDoctorTotal) : "—"})`,
    `Топ-услуга по оплатам: ${f.topServiceName ?? "нет данных"} (${f.topServiceTotal > 0 ? formatSum(f.topServiceTotal) : "—"})`,
    `Справочники: врачей ${f.doctorsCount}, услуг ${f.servicesCount}, всего записей в базе ${f.appointmentsCount}`,
  ].join("\n");
}

function isUnavailableMessage(s: string): boolean {
  return s.startsWith(AI_UNAVAILABLE_PREFIX);
}

/**
 * Вызов `openai.chat.completions.create` (клиент — `@/lib/openai`).
 * В лог идут размеры запроса и ответа, их текст — только при env.debugAiText; ошибки OpenAI — полностью.
 */
async function runOpenAiChatCompletion(params: {
  label: string;
  promptForLog: string;
  messages: ChatCompletionCreateParams["messages"];
  maxTokens?: number;
  responseFormat?: ChatCompletionCreateParams["response_format"];
}): Promise<string | null> {
  const model = OPENAI_CHAT_MODEL;
  const prompt = params.promptForLog;

  if (!hasOpenAI || !openai) {
    // eslint-disable-next-line no-console
    console.log("=== AI DEBUG START ===");
    // eslint-disable-next-line no-console
    console.log("MODEL:", model);
    // eslint-disable-next-line no-console
    console.log("HAS KEY:", !!process.env.OPENAI_API_KEY);
    // eslint-disable-next-line no-console
    console.log("PROMPT:", JSON.stringify(textForLog(prompt)));
    // eslint-disable-next-line no-console
    console.log("(пропуск: клиент OpenAI не создан — your_key_here или пустой ключ)");
    // eslint-disable-next-line no-console
    console.log("=== AI DEBUG END ===");
    return null;
  }

  // eslint-disable-next-line no-console
  console.log("[aiLlmService]", params.label);

  // eslint-disable-next-line no-console
  console.log("=== AI DEBUG START ===");
  // eslint-disable-next-line no-console
  console.log("MODEL:", model);
  // eslint-disable-next-line no-console
  console.log("HAS KEY:", !!process.env.OPENAI_API_KEY);
  // eslint-disable-next-line no-console
  console.log("PROMPT:", JSON.stringify(textForLog(prompt)));

  let res: Awaited<ReturnType<NonNullable<typeof openai>["chat"]["completions"]["create"]>> | null = null;
  let caught: unknown | undefined = undefined;

  try {
    res = await openai.chat.completions.create({
      model,
      max_tokens: params.maxTokens ?? MAX_OUT_TOKENS,
      messages: params.messages,
      ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    });
    // eslint-disable-next-line no-console
    console.log(
      "AI RESPONSE:",
      JSON.stringify({
        id: res.id,
        model: res.model,
        finishReason: res.choices?.[0]?.finish_reason,
        contentLen: res.choices?.[0]?.message?.content?.length ?? 0,
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        totalTokens: res.usage?.total_tokens,
      })
    );
    if (env.debugAiText) {
      // eslint-disable-next-line no-console
      console.log("AI RAW RESPONSE:", res);
    }
  } catch (e) {
    caught = e;
    // eslint-disable-next-line no-console
    console.error("AI ERROR:", e);
  }

  // eslint-disable-next-line no-console
  console.log("=== AI DEBUG END ===");

  /** Fallback «недоступен» — только здесь (исключение от SDK / сети). */
  if (caught !== undefined) {
    const anyErr = caught as {
      message?: string;
      status?: number;
      response?: { status?: number; data?: unknown };
      error?: { message?: string };
    };
    const errMsg = anyErr?.message ?? anyErr?.error?.message ?? String(caught);
    // eslint-disable-next-line no-console
    console.error("[AI ERROR FULL]", caught);
    const httpStatus = anyErr?.status ?? anyErr?.response?.status;
    // eslint-disable-next-line no-console
    console.error("error.message:", errMsg);
    // eslint-disable-next-line no-console
    console.error("response.status:", httpStatus === undefined ? "(нет в объекте ошибки)" : httpStatus);
    if (anyErr?.response?.data !== undefined) {
      // eslint-disable-next-line no-console
      console.error("response.data:", JSON.stringify(anyErr.response.data, null, 2));
    }
    return `${AI_UNAVAILABLE_PREFIX} ${errMsg}`;
  }

  if (!res) {
    // eslint-disable-next-line no-console
    console.error("[AI ERROR FULL] ответ create без исключения, но res пуст — неконсистентное состояние");
    return null;
  }

  const msg0 = res.choices?.[0]?.message;
  const content = msg0?.content;
  if (content != null) {
    return content;
  }

  const refusal =
    msg0 && typeof msg0 === "object" && "refusal" in msg0
      ? String((msg0 as { refusal?: string }).refusal ?? "")
      : "";
  if (refusal) {
    return refusal;
  }

  // eslint-disable-next-line no-console
  console.warn("[aiLlmService] choices[0].message без content/refusal — возвращаем пустую строку (ответ API успешный)");
  return "";
}

const MORNING_BRIEFING_SYSTEM = `Ты — AI ассистент клиники уровня бизнес-консультанта.

Правила:
- Пиши очень кратко: цель не больше 6 строк на весь ответ; при необходимости объединяй пункты через «; ».
- Показывай изменения к позавчера через revenueChange и patientsChange (целые проценты из JSON). Если null — деления не было (база 0); % не придумывай.
- Не просто анализируй — давай действия.
- Конкретика только из JSON; метрик и фактов не дополняй.
- Без воды.

Формат:

Приветствие (userName, одна строка)

📊 Вчера:
{выручка} ({+/- revenueChange}%) — только если revenueYesterday не null; если revenueChange null — без процента
{пациенты patientsYesterday} ({+/- patientsChange}%) — если patientsChange null — без процента
Если freeSlotsToday не null — коротко упомяни число слотов на сегодня.

⚠️ Проблемы:
До 2 пунктов. Если по данным всё ровно — напиши ровно: «Стабильный день».

💡 Действия:
До 2 пунктов, конкретные шаги на сегодня.

Если revenueYesterday и unpaidInvoicesCount в JSON null — нет доступа к финансам: не обсуждай выручку и неоплаты.

Если freeSlotsToday === null — не упоминай слоты.

Если scope === "doctor" — метрики только этого врача; иначе клиника целиком.`;

/**
 * Утренний брифинг: один user-message с JSON контекста.
 */
export async function completeMorningBriefing(metricsPayload: Record<string, unknown>): Promise<string | null> {
  const userContent = `Вот данные: ${JSON.stringify(metricsPayload)}. Сделай вау-брифинг.`;
  return runOpenAiChatCompletion({
    label: "completeMorningBriefing",
    promptForLog: `morning-briefing role=${String(metricsPayload.role)} scope=${String(metricsPayload.scope)}`,
    maxTokens: 320,
    messages: [
      { role: "system", content: MORNING_BRIEFING_SYSTEM },
      { role: "user", content: userContent },
    ],
  });
}

export type AssistantChatHistoryItem = { role: "user" | "assistant"; content: string };

/**
 * Диалог с памятью: system + CRM-контекст + история + последнее сообщение пользователя.
 * Модель: gpt-4o-mini (OPENAI_CHAT_MODEL).
 */
export async function completeAssistantChat(
  facts: AiLlmSummaryFacts,
  domainIntent: AiDomainIntent,
  context: AiAssistantStructuredContext,
  history: AssistantChatHistoryItem[],
  userMessage: string,
  role: UserRole
): Promise<string | null> {
  const factsForPrompt = redactSummaryFactsForRole(facts, role);
  const contextForPrompt = redactStructuredContextForRole(context, role);
  const snapshotBlock = [
    "Текущий снимок CRM (актуален для этого ответа):",
    formatFactsForPrompt(factsForPrompt),
    "",
    buildStructuredContextBlock(contextForPrompt),
    "",
    `Intent: ${domainIntent}`,
    "",
    CRM_SNAPSHOT_RULES,
  ].join("\n");

  const safeHistory = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, 8000),
    }));

  const um = userMessage.trim().slice(0, 8000);
  const promptForLog = `${um.slice(0, 200)} | history:${safeHistory.length}`;

  const raw = await runOpenAiChatCompletion({
    label: "completeAssistantChat",
    promptForLog,
    maxTokens: 500,
    messages: [
      { role: "system", content: getSystemPrompt(role) },
      { role: "system", content: snapshotBlock },
      ...safeHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: um },
    ],
  });

  if (raw === null) return null;
  if (isUnavailableMessage(raw)) return raw;
  return shapeAssistantAnswer(raw);
}

export async function completeGeneralCrmAdvice(facts: AiLlmSummaryFacts): Promise<string | null> {
  const summary = formatFactsForPrompt(facts);
  const promptForLog = `Факты: ${summary}\n\nДай один короткий совет владельцу клиники (что сделать сегодня).`;

  const raw = await runOpenAiChatCompletion({
    label: "completeGeneralCrmAdvice",
    promptForLog,
    messages: [
      {
        role: "system",
        content:
          "Ты бизнес-консультант клиники. Ответь на русском максимум 3 коротких предложения: цифры, вывод, что сделать. Без воды и без выдуманных данных — только из переданных фактов.",
      },
      {
        role: "user",
        content: promptForLog,
      },
    ],
  });

  if (raw === null) return null;
  if (isUnavailableMessage(raw)) return raw;
  return shapeAssistantAnswer(raw);
}

export async function completeOwnerRecommendations(facts: AiLlmSummaryFacts): Promise<string | null> {
  const summary = formatFactsForPrompt(facts);
  const promptForLog = `Факты: ${summary}\n\nДве рекомендации через перенос строки.`;

  const raw = await runOpenAiChatCompletion({
    label: "completeOwnerRecommendations",
    promptForLog,
    messages: [
      {
        role: "system",
        content:
          "Ты бизнес-консультант клиники. На русском: ровно 2 короткие строки — рекомендации владельцу с опорой на факты, без таблиц и без выдуманных цифр.",
      },
      {
        role: "user",
        content: promptForLog,
      },
    ],
  });

  if (raw === null) return null;
  if (isUnavailableMessage(raw)) return raw;
  return shapeAssistantAnswer(raw);
}

// --- Dashboard recommendations (тот же runner; отдельный промпт и парсинг JSON) ---

const parseRecommendationsJson = (content: string): string[] | null => {
  const trimmed = content.trim();
  const tryParse = (raw: string): string[] | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && "recommendations" in parsed) {
        const rec = (parsed as { recommendations: unknown }).recommendations;
        if (Array.isArray(rec) && rec.every((x) => typeof x === "string")) {
          return rec.map((s) => s.trim()).filter(Boolean);
        }
      }
    } catch {
      return null;
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct && direct.length) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const inner = tryParse(fence[1].trim());
    if (inner && inner.length) return inner;
  }
  return null;
};

/**
 * Рекомендации для экрана отчётов — тот же OpenAI runner, что и у ассистента.
 * При ошибке API возвращает массив из одной строки `AI временно недоступен: ...`.
 */
export async function completeDashboardRecommendationsFromSummaryJson(summaryJson: string): Promise<string[] | null> {
  const promptForLog = `Ты бизнес-аналитик клиники. Дай краткие рекомендации по увеличению прибыли, загрузке врачей и оптимизации услуг на основе данных: ${summaryJson}

Верни ТОЛЬКО JSON объекта вида: {"recommendations":["пункт1","пункт2","пункт3"]} — 3–6 коротких строк на русском, без markdown и без пояснений вне JSON.`;

  const raw = await runOpenAiChatCompletion({
    label: "completeDashboardRecommendationsFromSummaryJson",
    promptForLog,
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content: "Ты бизнес-аналитик медицинской клиники. Отвечай только валидным JSON с полем recommendations.",
      },
      { role: "user", content: promptForLog },
    ],
    responseFormat: { type: "json_object" },
  });

  if (raw === null) return null;
  if (isUnavailableMessage(raw)) return [raw];
  const parsed = parseRecommendationsJson(raw);
  if (parsed?.length) return parsed;
  /** Успешный ответ модели, но не JSON — всё равно отдаём сырой текст, без fallback-сообщения. */
  return [raw];
}
