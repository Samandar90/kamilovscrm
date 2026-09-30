import type { QueueTicket } from "../api/queueTypes";

/**
 * Printed queue ticket (58 mm thermal paper; fits 80 mm too). Labels are bilingual constants, not i18n keys:
 * the patient reads the ticket in either language whatever the receptionist's UI language is.
 */
const LABEL_NUMBER = "Navbat raqami / Номер очереди";
const LABEL_DOCTOR = "Shifokor / Врач";
const LABEL_ROOM = "Xona / Кабинет";
const LABEL_AHEAD = "Oldingizda / Перед вами";
const DOCUMENT_TITLE = "Navbat taloni / Талон очереди";
const DEFAULT_CLINIC_NAME = "Klinika / Клиника";
const FALLBACK_TIME_ZONE = "Asia/Tashkent";
const EMPTY = "—";

/** The ticket is written into a same-origin frame: every value must be escaped. */
const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatInZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
};

/** "30.09.2026 11:05" for an ISO instant in the clinic time zone; unknown zone → Asia/Tashkent; bad instant → "—". */
export function formatTicketDateTime(isoInstant: string, timeZone: string): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return EMPTY;
  try {
    return formatInZone(date, timeZone);
  } catch {
    // RangeError: the server sent a zone this browser's ICU does not know.
    return formatInZone(date, FALLBACK_TIME_ZONE);
  }
}

const field = (label: string, value: string): string =>
  `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;

/** Full HTML document for one ticket, ready for document.write into the print frame. */
export function buildTicketHtml(ticket: QueueTicket): string {
  const clinicName = ticket.clinicName?.trim() || DEFAULT_CLINIC_NAME;
  const specialty = ticket.specialty?.trim() ?? "";
  const room = ticket.room?.trim() || EMPTY;
  const ahead = String(Math.max(0, Math.trunc(Number(ticket.aheadCount) || 0)));
  const when = formatTicketDateTime(ticket.issuedAt, ticket.timeZone);

  // `size: 58mm auto` mirrors printReceipt (`80mm auto`). Chrome drops that declaration as invalid and takes the
  // paper size from the printer driver, which is what a roll printer needs. Never change it to `size: 58mm`:
  // that means a 58x58 mm page and splits a tall ticket across pages.
  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(DOCUMENT_TITLE)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { color: #000; font-family: Arial, "Segoe UI", sans-serif; }
  .ticket { width: 58mm; box-sizing: border-box; padding: 3mm 3mm 6mm; text-align: center; }
  .clinic { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; overflow-wrap: break-word; }
  .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .label { font-size: 10px; letter-spacing: 0.02em; }
  .code { font-size: 42px; font-weight: 800; line-height: 1.1; margin: 1mm 0; white-space: nowrap; }
  .field { margin: 1.5mm 0; }
  .value { font-size: 13px; font-weight: 700; overflow-wrap: break-word; }
  .specialty { font-size: 11px; margin-top: 0.5mm; overflow-wrap: break-word; }
  .when { font-size: 11px; margin-top: 2mm; }
</style>
</head>
<body>
<div class="ticket">
<div class="clinic">${escapeHtml(clinicName)}</div>
<div class="rule"></div>
<div class="label">${escapeHtml(LABEL_NUMBER)}</div>
<div class="code">${escapeHtml(ticket.code)}</div>
<div class="rule"></div>
<div class="field"><div class="label">${escapeHtml(LABEL_DOCTOR)}</div><div class="value">${escapeHtml(ticket.doctorName)}</div>${
    specialty ? `<div class="specialty">${escapeHtml(specialty)}</div>` : ""
  }</div>
${field(LABEL_ROOM, room)}
${field(LABEL_AHEAD, ahead)}
<div class="rule"></div>
<div class="when">${escapeHtml(when)}</div>
</div>
</body>
</html>`;
}
