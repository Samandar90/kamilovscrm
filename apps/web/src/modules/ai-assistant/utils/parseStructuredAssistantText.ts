/**
 * Парсит ответы AI с блоками 📊 / 📈 / 📉 / 💡 / 👉 (и вариант «📊 Анализ»).
 * Headings are normalized; actual localization happens at render time via useTranslation.
 */
export type AssistantParsedBlock = {
  key: string;
  heading: string;
  body: string;
};

const BLOCK_SPLIT = /\n(?=📊|📈|📉|💡|👉)/;

/**
 * Normalize headings by detecting patterns and marking them for i18n translation.
 * Returns emoji + i18n key like "📊 aiAssistant.whatISee" for later component translation.
 */
function normalizeHeading(h: string): string {
  const t = h.trim();
  if (/^📊\s*Анализ/i.test(t)) return "📊 aiAssistant.whatISee";
  if (/^💡\s*Что делать/i.test(t)) return "💡 aiAssistant.whatToDo";
  return t.replace(/\s*:\s*$/, "");
}

export function parseStructuredAssistantText(raw: string): {
  structured: boolean;
  blocks: AssistantParsedBlock[];
  plain: string;
} {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { structured: false, blocks: [], plain: "" };

  const parts = text.split(BLOCK_SPLIT);
  let preamble = "";
  const rest: string[] = [];

  for (const p of parts) {
    const headLine = p.split("\n")[0]?.trim() ?? "";
    if (/^(📊|📈|📉|💡|👉)/.test(headLine)) {
      rest.push(p);
    } else if (rest.length === 0) {
      preamble = p.trim();
    } else {
      rest[rest.length - 1] = `${rest[rest.length - 1]}\n${p}`;
    }
  }

  const blocks: AssistantParsedBlock[] = [];
  for (const part of rest) {
    const lines = part.split("\n");
    const heading = lines[0]?.trim() ?? "";
    let body = lines.slice(1).join("\n").trim();
    if (blocks.length === 0 && preamble) {
      body = body ? `${preamble}\n\n${body}` : preamble;
    }
    blocks.push({
      key: heading.slice(0, 12),
      heading: normalizeHeading(heading),
      body,
    });
  }

  if (blocks.length < 2) {
    return { structured: false, blocks: [], plain: text };
  }

  return { structured: true, blocks, plain: text };
}
