import { describe, expect, it } from "vitest";
import { TV_LABELS, TV_TEXT_LANGUAGE, tvLabel } from "./tvLabels";

describe("tvLabel", () => {
  it("shows one language or both, Uzbek first", () => {
    expect(tvLabel("invitation", "uz_ru")).toBe("Navbatdagi raqam / Приглашается");
    expect(tvLabel("startButton", "uz_ru")).toBe("Ekranni ishga tushirish / Запустить экран");
    expect(tvLabel("next", "ru")).toBe("Далее");
    expect(tvLabel("next", "uz")).toBe("Keyingi");
  });

  it("shows the TV in Russian only", () => {
    expect(TV_TEXT_LANGUAGE).toBe("ru");
    expect(tvLabel("invitation", TV_TEXT_LANGUAGE)).toBe("Приглашается");
  });

  it("does not repeat a label that is the same in both languages", () => {
    expect(tvLabel("codePlaceholder", "uz_ru")).toBe("XXXXX-XXXXX");
  });

  it("has a non-empty Uzbek and Russian text for every key", () => {
    expect(Object.keys(TV_LABELS).sort()).toEqual([
      "cabinet", "called", "codePlaceholder", "doctor", "enterCode", "free", "inactive", "invitation", "next",
      "noQueue", "noQueueYet", "notFound", "offline", "openScreen", "queueTitle", "recentCalls", "serving",
      "startButton", "startHint", "voiceNote",
    ]);
    for (const [key, label] of Object.entries(TV_LABELS)) {
      expect(label.uz.trim(), key).not.toBe("");
      expect(label.ru.trim(), key).not.toBe("");
    }
  });
});
