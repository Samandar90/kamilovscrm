/** Appointment dates in this CRM encode clinic wall time as UTC. */
export function formatVisit(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]} · ${match[4]}` : "—";
}

export function clinicInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:00`);
  if (!Number.isFinite(date.getTime())) return null;
  // Validate the actual calendar date instead of accepting Date's overflow normalization.
  if (new Date(date.getTime() + 5 * 3600_000).toISOString().slice(0, 16) !== value) return null;
  return date.toISOString();
}

export function formatContact(value: string | null, _locale = "ru"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent", year: "numeric", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} · ${parts.hour}:${parts.minute}`;
}

export function renderCallScript(template: string, values: Record<"patient" | "doctor" | "lastVisit" | "nextVisit", string>): string {
  return template.replace(/\{(patient|doctor|lastVisit|nextVisit)\}/g, (_match, key: keyof typeof values) => values[key]);
}

export function safePhoneHref(phone: string | null): string | null {
  if (!phone || !/^\+?[\d\s().-]+$/.test(phone.trim())) return null;
  const normalized = phone.replace(/[^+\d]/g, "");
  return /^\+?\d{7,15}$/.test(normalized) ? `tel:${normalized}` : null;
}

export const patientKey = (patient: { patientId: number; campaign: string; episodeKey: string }): string =>
  `${patient.patientId}:${patient.campaign}:${patient.episodeKey}`;
