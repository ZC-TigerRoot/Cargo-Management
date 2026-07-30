export const CHINA_TIME_ZONE = "Asia/Shanghai";
export const defaultWarehouseTimezone = () => CHINA_TIME_ZONE;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarParts(value: string) {
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new Error("日期格式必须为 YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("日期无效");
  }
  return { year, month, day };
}

function padded(value: number) {
  return String(value).padStart(2, "0");
}

export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function isCalendarDate(value: string) {
  try {
    calendarParts(value);
    return true;
  } catch {
    return false;
  }
}

export function chinaToday(now = new Date()) {
  const parts = partsAt(now, CHINA_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Prisma represents PostgreSQL DATE values as UTC-midnight Date objects. */
export function toPrismaDate(value: string) {
  const { year, month, day } = calendarParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function fromPrismaDate(value: Date) {
  if (Number.isNaN(value.getTime())) throw new Error("日期无效");
  return `${value.getUTCFullYear()}-${padded(value.getUTCMonth() + 1)}-${padded(value.getUTCDate())}`;
}

export function normalizeCalendarDate(value: string) {
  if (isCalendarDate(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("日期无效");
  return chinaToday(instant);
}

export function addCalendarDays(value: string, days: number) {
  const date = toPrismaDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return fromPrismaDate(date);
}

export function calendarDayDifference(start: string, end: string) {
  return Math.round((toPrismaDate(end).getTime() - toPrismaDate(start).getTime()) / 86_400_000);
}

export function formatCalendarDate(value: string | undefined) {
  if (!value) return "";
  const normalized = normalizeCalendarDate(value);
  const { year, month, day } = calendarParts(normalized);
  return `${year}年${padded(month)}月${padded(day)}日`;
}

export function localInputValue(value: string | undefined, timeZone: string) {
  if (!value) return "";
  const parts = partsAt(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function zonedLocalToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !isTimeZone(timeZone)) throw new Error("日期或仓库时区无效");
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsAt(new Date(instant), timeZone);
    const represented = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute));
    instant += desired - represented;
  }
  return new Date(instant).toISOString();
}

export function businessDate(value: string | undefined, timeZone = CHINA_TIME_ZONE) {
  void timeZone;
  return formatCalendarDate(value);
}

export function chinaDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(typeof value === "string" ? new Date(value) : value);
}
