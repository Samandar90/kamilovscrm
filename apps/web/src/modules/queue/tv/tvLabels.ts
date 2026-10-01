import type { QueueDisplayLanguage } from "../api/queueTypes";

/**
 * TV strings are constants, not i18n keys: the screen shows Uzbek and Russian together whatever the staff UI
 * language is. Uzbek oʻ/gʻ are written with U+2018 (‘) here because every TV font has that glyph.
 */
export const TV_LABELS = {
  queueTitle: { uz: "Navbat", ru: "Очередь" },
  cabinet: { uz: "Xona", ru: "Кабинет" },
  doctor: { uz: "Shifokor", ru: "Врач" },
  serving: { uz: "Qabulda", ru: "На приёме" },
  called: { uz: "Chaqirildi", ru: "Вызван" },
  next: { uz: "Keyingi", ru: "Далее" },
  free: { uz: "Bo‘sh", ru: "Свободно" },
  noQueue: { uz: "Navbat yo‘q", ru: "Очереди нет" },
  noQueueYet: { uz: "Hozircha navbat yo‘q", ru: "Очереди пока нет" },
  recentCalls: { uz: "So‘nggi chaqiruvlar", ru: "Последние вызовы" },
  invitation: { uz: "Navbatdagi raqam", ru: "Приглашается" },
  startButton: { uz: "Ekranni ishga tushirish", ru: "Запустить экран" },
  startHint: {
    uz: "Ovoz va to‘liq ekran uchun pultdagi OK tugmasini bosing",
    ru: "Нажмите OK на пульте, чтобы включить звук и полный экран",
  },
  offline: { uz: "Aloqa yo‘q", ru: "Нет связи" },
  notFound: {
    uz: "Ekran o‘chirilgan. Administratordan yangi kod so‘rang.",
    ru: "Экран отключён. Попросите администратора выдать новый код.",
  },
  inactive: { uz: "Klinika obunasi faol emas.", ru: "Подписка клиники неактивна." },
  enterCode: { uz: "Ekran kodini kiriting", ru: "Введите код экрана" },
  openScreen: { uz: "Ekranni ochish", ru: "Открыть экран" },
  codePlaceholder: { uz: "XXXXX-XXXXX", ru: "XXXXX-XXXXX" },
} as const;

export type TvLabelKey = keyof typeof TV_LABELS;

/** "uz" → Uzbek, "ru" → Russian, "uz_ru" → "Uzbek / Russian" (a label that is identical in both is shown once). */
export function tvLabel(key: TvLabelKey, language: QueueDisplayLanguage): string {
  const label: { uz: string; ru: string } = TV_LABELS[key];
  if (language === "uz") return label.uz;
  if (language === "ru") return label.ru;
  return label.uz === label.ru ? label.ru : `${label.uz} / ${label.ru}`;
}
