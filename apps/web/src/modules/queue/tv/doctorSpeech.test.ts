import { describe, expect, it } from "vitest";
import { doctorSentence } from "./doctorSpeech";

describe("doctorSentence: dative case when the gender is clear", () => {
  it.each([
    ["Каримов Дилшод Рустамович", "Пройдите к врачу Каримову Дилшоду Рустамовичу."],
    ["Усманова Малика Бахтиёровна", "Пройдите к врачу Усмановой Малике Бахтиёровне."],
    ["Назарова Дилноза Анваровна", "Пройдите к врачу Назаровой Дилнозе Анваровне."],
    ["Юлдашев Бекзод Олимович", "Пройдите к врачу Юлдашеву Бекзоду Олимовичу."],
    ["Абдуллаев Жасур Шухратович", "Пройдите к врачу Абдуллаеву Жасуру Шухратовичу."],
    ["Рахимов Азизбек Улугбекович", "Пройдите к врачу Рахимову Азизбеку Улугбековичу."],
    ["Бекмуратова Нодира Равшановна", "Пройдите к врачу Бекмуратовой Нодире Равшановне."],
    ["Иванов Иван Иванович", "Пройдите к врачу Иванову Ивану Ивановичу."],
    ["Петрова Мария Сергеевна", "Пройдите к врачу Петровой Марии Сергеевне."],
  ])("%s", (name, sentence) => {
    expect(doctorSentence(name)).toBe(sentence);
  });

  it("leaves indeclinable names alone and declines the rest", () => {
    expect(doctorSentence("Ким Ольга Викторовна")).toBe("Пройдите к врачу Ким Ольге Викторовне.");
    expect(doctorSentence("Ким Сергей Петрович")).toBe("Пройдите к врачу Киму Сергею Петровичу.");
    expect(doctorSentence("Мирзаева Зебо Акмаловна")).toBe("Пройдите к врачу Мирзаевой Зебо Акмаловне.");
    expect(doctorSentence("Пак Елена Ивановна")).toBe("Пройдите к врачу Пак Елене Ивановне.");
  });

  it("takes the gender from the Uzbek patronymic particle and keeps the particle as it is", () => {
    expect(doctorSentence("Каримов Дилшод Рустам угли")).toBe("Пройдите к врачу Каримову Дилшоду Рустам угли.");
    expect(doctorSentence("Нурматова Дилдора Рустам кизи")).toBe("Пройдите к врачу Нурматовой Дилдоре Рустам кизи.");
  });

  it("declines Uzbek names the dictionary does not know when the other words agree", () => {
    expect(doctorSentence("Хасанов Бахтиёр Рустам угли")).toBe("Пройдите к врачу Хасанову Бахтиёру Рустам угли.");
    expect(doctorSentence("Эшонова Шохсанам Рустам кизи")).toBe("Пройдите к врачу Эшоновой Шохсанам Рустам кизи.");
  });

  it("trusts the patronymic over the surname form (a woman may keep «Каримов»)", () => {
    expect(doctorSentence("Каримов Малика Рустамовна")).toBe("Пройдите к врачу Каримов Малике Рустамовне.");
  });

  it("works without a patronymic when surname and name agree", () => {
    expect(doctorSentence("Каримов Бахтиёр")).toBe("Пройдите к врачу Каримову Бахтиёру.");
    expect(doctorSentence("Усманова Малика")).toBe("Пройдите к врачу Усмановой Малике.");
  });

  it("ignores extra spaces", () => {
    expect(doctorSentence("  Каримов   Дилшод  Рустамович ")).toBe("Пройдите к врачу Каримову Дилшоду Рустамовичу.");
  });
});

describe("doctorSentence: nominative «Врач …» when a declension would be a guess", () => {
  it("falls back when the gender cannot be told", () => {
    expect(doctorSentence("Ахмедова Шохсанам")).toBe("Врач Ахмедова Шохсанам.");
  });

  it("falls back when surname and name disagree", () => {
    expect(doctorSentence("Абуова Андрей")).toBe("Врач Абуова Андрей.");
  });

  it("falls back for a single word", () => {
    expect(doctorSentence("Каримов")).toBe("Врач Каримов.");
  });

  it("falls back for initials, Latin letters and other non-Cyrillic text", () => {
    expect(doctorSentence("Каримов Д. Р.")).toBe("Врач Каримов Д. Р.");
    expect(doctorSentence("Karimov Dilshod")).toBe("Врач Karimov Dilshod.");
  });

  it("returns null for an empty name", () => {
    expect(doctorSentence("")).toBeNull();
    expect(doctorSentence("   ")).toBeNull();
  });
});
