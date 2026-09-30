type WallClock = { year: string; month: string; day: string; hour: number; minute: number; second: number };

/** Wall clock of the instant `ms` in `timeZone` (falls back to the device zone if the name is unknown). */
function wallClock(ms: number, timeZone: string): WallClock {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).formatToParts(new Date(ms));
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(new Date(ms));
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "0";
  return {
    year: part("year"), month: part("month"), day: part("day"),
    // Some engines print midnight as "24" even with h23.
    hour: Number(part("hour")) % 24, minute: Number(part("minute")), second: Number(part("second")),
  };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** "HH:MM" of the instant in the clinic time zone. */
export function formatClock(ms: number, timeZone: string): string {
  const clock = wallClock(ms, timeZone);
  return `${pad2(clock.hour)}:${pad2(clock.minute)}`;
}

/** "DD.MM.YYYY" of the instant in the clinic time zone. */
export function formatDay(ms: number, timeZone: string): string {
  const clock = wallClock(ms, timeZone);
  return `${clock.day}.${clock.month}.${clock.year}`;
}

/**
 * Milliseconds from `ms` until the next `hour`:00 wall-clock time in `timeZone` (the nightly reload that picks up a
 * new app version and frees memory). Never less than one minute, so a reload right at 04:00 cannot loop.
 */
export function msUntilDailyReload(ms: number, timeZone: string, hour = 4): number {
  const clock = wallClock(ms, timeZone);
  const sinceMidnight = clock.hour * 3600 + clock.minute * 60 + clock.second;
  let seconds = hour * 3600 - sinceMidnight;
  if (seconds <= 0) seconds += 24 * 3600;
  return Math.max(60_000, seconds * 1000 - (ms % 1000));
}
