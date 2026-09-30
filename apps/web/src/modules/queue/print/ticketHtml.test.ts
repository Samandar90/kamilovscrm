import { describe, expect, it } from "vitest";
import type { QueueTicket } from "../api/queueTypes";
import { buildTicketHtml, formatTicketDateTime } from "./ticketHtml";

const ticket = (patch: Partial<QueueTicket> = {}): QueueTicket => ({
  appointmentId: 42,
  clinicName: "Kamilovs Clinic",
  code: "К-05",
  number: 5,
  doctorName: "Каримов Азиз",
  specialty: "Терапевт",
  room: "12",
  issuedAt: "2026-09-30T06:05:00.000Z",
  aheadCount: 3,
  timeZone: "Asia/Tashkent",
  ...patch,
});

describe("formatTicketDateTime", () => {
  it("formats the issue instant in the clinic time zone", () => {
    expect(formatTicketDateTime("2026-09-30T06:05:00.000Z", "Asia/Tashkent")).toBe("30.09.2026 11:05");
    expect(formatTicketDateTime("2026-09-30T19:00:00.000Z", "Asia/Tashkent")).toBe("01.10.2026 00:00");
  });

  it("falls back to Asia/Tashkent for an unknown zone and to a dash for a broken instant", () => {
    expect(formatTicketDateTime("2026-09-30T06:05:00.000Z", "Not/AZone")).toBe("30.09.2026 11:05");
    expect(formatTicketDateTime("not-a-date", "Asia/Tashkent")).toBe("—");
  });
});

describe("buildTicketHtml", () => {
  it("prints a 58 mm bilingual ticket with the big code, doctor, room, time and people ahead", () => {
    const html = buildTicketHtml(ticket());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: 58mm auto; margin: 0; }");
    expect(html).toContain("width: 58mm;");
    expect(html).toContain('<div class="clinic">Kamilovs Clinic</div>');
    expect(html).toContain('<div class="label">Navbat raqami / Номер очереди</div>');
    expect(html).toContain('<div class="code">К-05</div>');
    expect(html).toContain('<div class="label">Shifokor / Врач</div>');
    expect(html).toContain('<div class="value">Каримов Азиз</div>');
    expect(html).toContain('<div class="specialty">Терапевт</div>');
    expect(html).toContain('<div class="label">Xona / Кабинет</div>');
    expect(html).toContain('<div class="value">12</div>');
    expect(html).toContain('<div class="label">Oldingizda / Перед вами</div>');
    expect(html).toContain('<div class="value">3</div>');
    expect(html).toContain('<div class="when">30.09.2026 11:05</div>');
  });

  it("shows a dash for a doctor without a room and skips an empty specialty", () => {
    const html = buildTicketHtml(ticket({ room: null, specialty: "  ", aheadCount: 0 }));
    expect(html).toContain('<div class="value">—</div>');
    expect(html).not.toContain('class="specialty"');
    expect(html).toContain('<div class="value">0</div>');
  });

  it("escapes every value written into the print document", () => {
    const html = buildTicketHtml(
      ticket({
        clinicName: '<img src=x onerror="alert(1)">',
        doctorName: `"Tom" & 'Jerry'`,
        specialty: "<b>ЛОР</b>",
        room: "<script>",
        code: "<i>К-05</i>",
      })
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>ЛОР</b>");
    expect(html).not.toContain("<i>К-05</i>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&quot;Tom&quot; &amp; &#39;Jerry&#39;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;i&gt;К-05&lt;/i&gt;");
  });
});
