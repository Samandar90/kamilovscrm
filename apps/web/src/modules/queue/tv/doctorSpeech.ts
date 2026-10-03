import { getFirstnameGender, getLastnameGender, getMiddlenameGender, inclineFirstname, inclineLastname, inclineMiddlename } from "lvovich";

/** Cyrillic words only (Uzbek Cyrillic letters, hyphen and apostrophes included): the only text a declension is trusted for. */
const WORD = /^[А-Яа-яЁёЎўҚқҒғҲҳ'’ʼ-]+$/;

type Gender = "male" | "female";

/** Uzbek patronymics written as two words: «Рустам угли» (son of Rustam), «Рустам кизи» (daughter of Rustam). */
const PARTICLE_GENDER: Record<string, Gender> = { угли: "male", оглы: "male", улы: "male", кизи: "female", қизи: "female", кызы: "female", киз: "female" };

function hasParticle(middle: string): boolean {
  return middle.split(" ").pop()!.toLowerCase() in PARTICLE_GENDER;
}

function spoken(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Gender: the patronymic decides when it is clear (-ович, -овна, «угли», «кизи»). Otherwise the surname and the name
 * must agree; a word the dictionary does not know (many Uzbek names) says nothing, and a disagreement gives null:
 * a wrong ending sounds worse than none. (lvovich's own getGender gives up as soon as one word is unknown.)
 */
function detectGender(last: string, first: string, middle: string | undefined): Gender | null {
  if (middle !== undefined) {
    const fromMiddle = hasParticle(middle) ? PARTICLE_GENDER[middle.split(" ").pop()!.toLowerCase()] : getMiddlenameGender(middle);
    if (fromMiddle === "male" || fromMiddle === "female") return fromMiddle;
  }
  const votes = [getLastnameGender(last), getFirstnameGender(first)].filter((vote): vote is Gender => vote === "male" || vote === "female");
  const [firstVote] = votes;
  return firstVote && votes.every((vote) => vote === firstVote) ? firstVote : null;
}

/**
 * The sentence that names the doctor, spoken after "Номер N." (the browser voice reads it):
 *   «Пройдите к врачу Каримову Дилшоду Рустамовичу.»  — "Фамилия Имя Отчество" in the dative case;
 *   «Врач Ахмедова Шохсанам.»  — the name as written, when the gender cannot be told or the name is not plain
 *   Cyrillic words (initials, Latin letters): a wrong ending would sound worse than the nominative.
 * null for an empty name. Endings come from lvovich (petrovich rules), checked on Uzbek and Russian names.
 */
export function doctorSentence(fullName: string): string | null {
  const name = spoken(fullName);
  if (name === "") return null;
  const nominative = name.endsWith(".") ? `Врач ${name}` : `Врач ${name}.`;
  const words = name.split(" ");
  if (words.length < 2 || !words.every((word) => WORD.test(word))) return nominative;
  const [last, first, ...rest] = words;
  const middle = rest.length > 0 ? rest.join(" ") : undefined;
  const gender = detectGender(last, first, middle);
  if (!gender) return nominative;
  // Word by word with the gender given: incline() on a whole person detects the gender again and leaves unknown names as they are.
  const parts = [
    inclineLastname(last, "dative", gender),
    inclineFirstname(first, "dative", gender),
    ...(middle === undefined ? [] : [hasParticle(middle) ? middle : inclineMiddlename(middle, "dative", gender)]),
  ];
  return `Пройдите к врачу ${parts.join(" ")}.`;
}
