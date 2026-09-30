import { describe, expect, it } from "vitest";
import voiceClips from "./voiceClips.json";
import { announcementClipIds, gapBeforeClipMs, numberClipIds, voiceLangs, type VoiceLang } from "./voicePhrases";

const clips = voiceClips as Record<VoiceLang, Record<string, string>>;
const NUMBER_ID = /^[0-9]+$/;

describe("voice clip catalogue", () => {
  it("has 36 Russian and 27 Uzbek number clips plus 3 phrases each", () => {
    expect(Object.keys(clips.ru).filter((id) => NUMBER_ID.test(id))).toHaveLength(36);
    expect(Object.keys(clips.uz).filter((id) => NUMBER_ID.test(id))).toHaveLength(27);
    expect(Object.keys(clips.ru).filter((id) => !NUMBER_ID.test(id)).sort()).toEqual(["nomer", "proydite_na_priyom", "proydite_v_kabinet_nomer"]);
    expect(Object.keys(clips.uz).filter((id) => !NUMBER_ID.test(id)).sort()).toEqual(["navbat_raqami", "qabulga_marhamat", "xona_raqami"]);
  });

  it("writes the Uzbek oʻ with U+02BB and never with an ASCII or typographic quote", () => {
    for (const id of ["4", "9", "10", "30", "90", "400", "900"]) expect(clips.uz[id]).toContain("ʻ");
    expect(clips.uz["4"]).toBe("toʻrt");
    for (const text of Object.values(clips.uz)) expect(text).not.toMatch(/['‘’]/);
  });

  it("has a clip for every id produced for 1..999 in both languages", () => {
    const missing: string[] = [];
    for (const lang of ["uz", "ru"] as const) {
      for (let n = 1; n <= 999; n += 1) {
        const ids = [
          ...(numberClipIds(lang, n) ?? ["<null>"]),
          ...announcementClipIds(lang, n, String(n)),
          ...announcementClipIds(lang, n, null),
        ];
        for (const id of ids) if (typeof clips[lang][id] !== "string") missing.push(`${lang}:${n}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("numberClipIds", () => {
  it.each([
    [1, ["1"], ["1"]],
    [5, ["5"], ["5"]],
    [11, ["11"], ["10", "1"]],
    [19, ["19"], ["10", "9"]],
    [20, ["20"], ["20"]],
    [27, ["20", "7"], ["20", "7"]],
    [100, ["100"], ["100"]],
    [115, ["100", "15"], ["100", "10", "5"]],
    [999, ["900", "90", "9"], ["900", "90", "9"]],
  ])("%i → ru %j, uz %j", (n, ru, uz) => {
    expect(numberClipIds("ru", n)).toEqual(ru);
    expect(numberClipIds("uz", n)).toEqual(uz);
  });

  it("returns null outside 1..999 and for non-integers", () => {
    for (const n of [0, -3, 1000, 1234, 2.5, Number.NaN]) {
      expect(numberClipIds("ru", n)).toBeNull();
      expect(numberClipIds("uz", n)).toBeNull();
    }
  });
});

describe("announcementClipIds", () => {
  it("builds «Номер двадцать семь. Пройдите в кабинет номер пять.» and the Uzbek counterpart", () => {
    expect(announcementClipIds("ru", 27, "5")).toEqual(["nomer", "20", "7", "proydite_v_kabinet_nomer", "5"]);
    expect(announcementClipIds("uz", 27, "5")).toEqual(["navbat_raqami", "20", "7", "xona_raqami", "5"]);
    expect(announcementClipIds("ru", 115, " 12 ")).toEqual(["nomer", "100", "15", "proydite_v_kabinet_nomer", "12"]);
  });

  it.each(["УЗИ", null, "0", "1000", "05", "3а", ""])("uses the fallback phrase for room %j", (room) => {
    expect(announcementClipIds("ru", 7, room)).toEqual(["nomer", "7", "proydite_na_priyom"]);
    expect(announcementClipIds("uz", 7, room)).toEqual(["navbat_raqami", "7", "qabulga_marhamat"]);
  });

  it("says nothing for queue numbers above 999", () => {
    expect(announcementClipIds("ru", 1000, "5")).toEqual([]);
    expect(announcementClipIds("uz", 1500, null)).toEqual([]);
  });
});

describe("voiceLangs and pauses", () => {
  it("speaks Uzbek first for bilingual displays", () => {
    expect(voiceLangs("uz_ru")).toEqual(["uz", "ru"]);
    expect(voiceLangs("uz")).toEqual(["uz"]);
    expect(voiceLangs("ru")).toEqual(["ru"]);
  });

  it("pauses longer before a new sentence than between number words", () => {
    expect(gapBeforeClipMs("7")).toBe(60);
    expect(gapBeforeClipMs("proydite_v_kabinet_nomer")).toBe(300);
    expect(gapBeforeClipMs("xona_raqami")).toBe(300);
    expect(gapBeforeClipMs("proydite_na_priyom")).toBe(300);
    expect(gapBeforeClipMs("qabulga_marhamat")).toBe(300);
  });
});
