import { describe, expect, it } from "vitest";
import ru from "../../../locales/ru.json";
import uz from "../../../locales/uz.json";
import type { LeadStage } from "../api/leadsTypes";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABEL_KEYS,
  LEAD_STATUS_OPTIONS,
  formatLeadPhone,
  leadStageBadgeClass,
} from "./leadFormat";

const ALL_STAGES: LeadStage[] = ["new", "in_progress", "no_answer", "booked", "visited", "declined", "invalid"];

describe("lead phone", () => {
  it("groups an Uzbek number", () => {
    expect(formatLeadPhone("998901234567")).toBe("+998 90 123 45 67");
  });

  it("shows any other digit string with a plus only", () => {
    expect(formatLeadPhone("79161234567")).toBe("+79161234567");
    expect(formatLeadPhone("9989012345678")).toBe("+9989012345678");
    expect(formatLeadPhone("99890123456")).toBe("+99890123456");
    expect(formatLeadPhone("1234567890")).toBe("+1234567890");
  });
});

describe("lead stages", () => {
  const textAt = (locale: unknown, key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);

  it("lists every stage once, «Пришёл» included", () => {
    expect([...LEAD_STAGES].sort()).toEqual([...ALL_STAGES].sort());
  });

  it.each(ALL_STAGES)("names %s in Russian and Uzbek", (stage) => {
    const key = LEAD_STAGE_LABEL_KEYS[stage];
    expect(key).toMatch(/^leads\.stage\.\w+$/);
    for (const locale of [ru, uz]) {
      const text = textAt(locale, key);
      expect(typeof text).toBe("string");
      expect((text as string).trim()).not.toBe("");
    }
  });

  it("uses the agreed Russian names", () => {
    expect(ALL_STAGES.map((stage) => textAt(ru, LEAD_STAGE_LABEL_KEYS[stage]))).toEqual([
      "Новый", "В работе", "Не дозвонились", "Записан", "Пришёл", "Отказ", "Некачественный",
    ]);
  });

  it.each(ALL_STAGES)("gives %s a badge class of its own", (stage) => {
    expect(leadStageBadgeClass(stage).trim()).not.toBe("");
    expect(new Set(ALL_STAGES.map(leadStageBadgeClass)).size).toBe(ALL_STAGES.length);
  });

  it("lets staff set every stored status except «Новый»", () => {
    expect(LEAD_STATUS_OPTIONS).toEqual(["in_progress", "no_answer", "booked", "declined", "invalid"]);
  });
});
