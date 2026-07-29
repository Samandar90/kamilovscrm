/**
 * Фирменный бланк протокола УЗИ — одна таблица стилей на экранный редактор и на печать.
 * Держим строкой, потому что печать открывается в отдельном окне (`window.open`),
 * куда стили приложения не попадают.
 */
export const buildUziProtocolCss = (primaryColor: string): string => `
  .uzi-sheet {
    --brand: ${primaryColor};
    --brand-soft: color-mix(in srgb, ${primaryColor} 8%, white);
    --brand-line: color-mix(in srgb, ${primaryColor} 22%, white);
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    font-family: "Times New Roman", Times, Georgia, serif;
    color: var(--ink);
    font-size: 11.5pt;
    line-height: 1.4;
    background: #fff;
  }

  .uzi-sheet * { box-sizing: border-box; }

  /* --- шапка клиники --- */
  .uzi-sheet .uzi-head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 10px;
    margin-bottom: 14px;
    border-bottom: 2px solid var(--brand);
  }
  .uzi-sheet .uzi-head img {
    width: 54px;
    height: 54px;
    object-fit: contain;
    flex: none;
  }
  .uzi-sheet .uzi-head-text { min-width: 0; flex: 1; }
  .uzi-sheet .uzi-clinic {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 15pt;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.15;
  }
  .uzi-sheet .uzi-clinic-sub {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 8.5pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--brand);
    margin-top: 3px;
  }

  /* --- заголовки протокола --- */
  .uzi-sheet h1 {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 14pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    text-align: center;
    margin: 0 0 4px;
  }
  .uzi-sheet .sub {
    text-align: center;
    color: var(--muted);
    font-size: 11pt;
    margin: 0 0 14px;
  }
  .uzi-sheet .sub-inline {
    text-align: center;
    color: var(--muted);
    font-size: 10pt;
    margin: -6px 0 8px;
  }
  .uzi-sheet h2 {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 10.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand);
    border-left: 3px solid var(--brand);
    padding-left: 8px;
    margin: 16px 0 8px;
  }
  .uzi-sheet h3 {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin: 12px 0 6px;
  }
  .uzi-sheet section { margin-bottom: 10px; break-inside: avoid; }
  .uzi-sheet section.fetus {
    border: 1px solid var(--brand-line);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 12px;
    break-inside: auto;
  }
  .uzi-sheet p { margin: 0 0 5px; text-align: justify; }
  .uzi-sheet .lbl { font-weight: 700; margin-top: 8px; }
  .uzi-sheet .total { font-weight: 700; margin-top: 8px; }

  /* --- таблицы --- */
  .uzi-sheet table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 10px;
    font-size: 10.5pt;
    break-inside: avoid;
  }
  .uzi-sheet table th,
  .uzi-sheet table td {
    border: 1px solid var(--line);
    padding: 4px 7px;
    vertical-align: top;
    text-align: left;
  }
  .uzi-sheet table th {
    background: var(--brand-soft);
    font-weight: 600;
  }
  .uzi-sheet .meta { margin-bottom: 14px; }
  .uzi-sheet .meta th { width: 68px; white-space: nowrap; }
  .uzi-sheet .meta td { font-weight: 600; }
  .uzi-sheet .grid.narrow { width: auto; min-width: 60%; }
  .uzi-sheet .grid .unit { width: 42px; color: var(--muted); }
  .uzi-sheet .grid .side { white-space: nowrap; }
  .uzi-sheet .doppler .art { font-style: italic; white-space: nowrap; }
  /* ИР/СДО — узкие колонки, значение должно оставаться на одной строке с «0,» */
  .uzi-sheet .doppler td:nth-child(2),
  .uzi-sheet .doppler td:nth-child(3) { white-space: nowrap; width: 74px; }
  .uzi-sheet .doppler td:nth-child(2) .fill,
  .uzi-sheet .doppler td:nth-child(3) .fill { min-width: 34px; }
  .uzi-sheet .placenta td { font-size: 9.5pt; }
  .uzi-sheet .movements th { font-weight: 400; background: transparent; }
  .uzi-sheet .pair { table-layout: fixed; }
  .uzi-sheet .pair > tbody > tr > th {
    text-align: center;
    letter-spacing: 0.08em;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 9.5pt;
  }
  .uzi-sheet .pair > tbody > tr > td { width: 50%; font-size: 10pt; }
  .uzi-sheet .pair table { margin: 4px 0; font-size: 9.5pt; }

  /* --- вспомогательное --- */
  .uzi-sheet .norm {
    color: var(--muted);
    font-size: 9.5pt;
    font-style: italic;
    font-weight: 400;
  }
  .uzi-sheet .fill {
    display: inline-block;
    min-width: 46px;
    border-bottom: 1px dotted color-mix(in srgb, ${primaryColor} 55%, #94a3b8);
  }

  /* --- заключение / рекомендации --- */
  .uzi-sheet .concl {
    border: 1px solid var(--brand-line);
    border-radius: 8px;
    padding: 8px 12px 4px;
    background: var(--brand-soft);
    margin-top: 14px;
  }
  .uzi-sheet .concl h2 { margin-top: 2px; border-left: none; padding-left: 0; }
  .uzi-sheet .opts { margin: 0 0 6px; padding-left: 20px; }
  .uzi-sheet .opts li { margin-bottom: 2px; }
  .uzi-sheet .rec h2 { margin-bottom: 4px; }
  .uzi-sheet .rec p { margin-bottom: 3px; }

  /* --- подпись --- */
  .uzi-sheet .sign {
    margin-top: 22px;
    text-align: right;
    font-size: 11pt;
  }
  .uzi-sheet .sign-name {
    display: inline-block;
    min-width: 190px;
    border-bottom: 1px solid var(--ink);
    text-align: center;
    font-weight: 700;
  }
`;

/** Дополнительные правила только для окна печати. */
export const UZI_PRINT_CSS = `
  @page { size: A4; margin: 12mm 12mm 14mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .uzi-sheet { padding: 0; }
  .uzi-sheet [contenteditable] { outline: none; }
`;

/** Дополнительные правила только для экранного редактора. */
export const UZI_EDITOR_CSS = `
  .uzi-editor-scroll {
    overflow: auto;
    background: #eef2f7;
    padding: 16px;
    border-radius: 12px;
    max-height: 70vh;
  }
  .uzi-editor-page {
    width: 190mm;
    max-width: 100%;
    margin: 0 auto;
    background: #fff;
    padding: 14mm 12mm;
    border-radius: 4px;
    box-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  }
  .uzi-editor-page:focus { outline: 2px solid rgba(109, 40, 217, 0.35); }
  .uzi-editor-page [contenteditable]:focus { outline: none; }
`;
