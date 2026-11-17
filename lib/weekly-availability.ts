export const AVAILABILITY_DAYS = [
  { key: "sun", label: "Sunday", weekday: "Sun" },
  { key: "mon", label: "Monday", weekday: "Mon" },
  { key: "tue", label: "Tuesday", weekday: "Tue" },
  { key: "wed", label: "Wednesday", weekday: "Wed" },
  { key: "thu", label: "Thursday", weekday: "Thu" },
  { key: "fri", label: "Friday", weekday: "Fri" },
  { key: "sat", label: "Saturday", weekday: "Sat" },
] as const;

export type AvailabilityDay = typeof AVAILABILITY_DAYS[number]["key"];

export interface AvailabilityWindow {
  startMinute: number;
  endMinute: number;
}

export type WeeklyAvailability = Partial<Record<AvailabilityDay, AvailabilityWindow>>;

export function timeToMinute(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function minuteToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function parseWeeklyAvailability(value: unknown): WeeklyAvailability | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const validDays = new Set<string>(AVAILABILITY_DAYS.map((day) => day.key));
  const parsed: WeeklyAvailability = {};
  for (const [day, window] of Object.entries(value)) {
    if (!validDays.has(day) || typeof window !== "object" || window === null || Array.isArray(window)) {
      return null;
    }
    if (Object.keys(window).some((key) => key !== "startMinute" && key !== "endMinute")
      || !("startMinute" in window) || !("endMinute" in window)
      || typeof window.startMinute !== "number" || !Number.isInteger(window.startMinute)
      || typeof window.endMinute !== "number" || !Number.isInteger(window.endMinute)
      || window.startMinute < 0 || window.startMinute >= 1440
      || window.endMinute <= window.startMinute || window.endMinute >= 1440
      || window.startMinute % 15 !== 0 || window.endMinute % 15 !== 0) {
      return null;
    }
    parsed[day as AvailabilityDay] = {
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    };
  }
  return parsed;
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function localDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDayAndMinute(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const day = AVAILABILITY_DAYS.find((item) => item.weekday === weekday)?.key;
  if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { day, minute: hour * 60 + minute };
}

function fitsAvailability(
  start: Date,
  durationMinutes: number,
  availability: WeeklyAvailability,
  formatter: Intl.DateTimeFormat,
) {
  const startLocal = localDayAndMinute(start, formatter);
  const endLocal = localDayAndMinute(
    new Date(start.getTime() + durationMinutes * 60_000 - 1),
    formatter,
  );
  if (!startLocal || !endLocal || startLocal.day !== endLocal.day) return false;
  const window = availability[startLocal.day];
  if (!window) return false;
  const endMinute = endLocal.minute + 1;
  return startLocal.minute >= window.startMinute && endMinute <= window.endMinute;
}

export function getAvailableTimesForDate(
  dateValue: string,
  durationMinutes: number,
  firstAvailability: WeeklyAvailability,
  firstTimeZone: string,
  secondAvailability: WeeklyAvailability,
  secondTimeZone: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    || !isValidTimeZone(firstTimeZone) || !isValidTimeZone(secondTimeZone)
    || !Number.isInteger(durationMinutes) || durationMinutes <= 0) return [];
  const [year, month, day] = dateValue.split("-").map(Number);
  const firstDay = new Date(year, month - 1, day);
  if (localDateInput(firstDay) !== dateValue) return [];
  const startOfDay = firstDay.getTime();
  const startOfNextDay = new Date(year, month - 1, day + 1).getTime();
  const firstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: firstTimeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const secondFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: secondTimeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const times: Date[] = [];
  for (let milliseconds = startOfDay;
    milliseconds + durationMinutes * 60_000 <= startOfNextDay;
    milliseconds += 15 * 60_000) {
    const start = new Date(milliseconds);
    if (fitsAvailability(start, durationMinutes, firstAvailability, firstFormatter)
      && fitsAvailability(start, durationMinutes, secondAvailability, secondFormatter)) {
      times.push(start);
    }
  }
  return times;
}
