/**
 * Разбор CSV по RFC 4180 за один проход: ячейка в кавычках может содержать запятую, перенос строки
 * и удвоенную кавычку. Концы строк — LF, CRLF или CR. Ведущий BOM убирается. Ячейки не обрезаются.
 * Пустая строка внутри текста — строка с одной пустой ячейкой; перенос в конце текста строку не добавляет.
 * Не бросает: кавычка в середине ячейки без кавычек — обычный символ, незакрытая кавычка читается до конца.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  // Ячейка начата: в ней есть символ или открыта кавычка. Нужно, чтобы отличить `""` от конца текста.
  let cellStarted = false;
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') {
        cell += ch;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = false;
      }
    } else if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cellStarted || row.length > 0) endRow();
  return rows;
}
