export const CHINA_TIME_ZONE = "Asia/Shanghai";
export const defaultWarehouseTimezone = () => CHINA_TIME_ZONE;

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
  const local = localInputValue(value, CHINA_TIME_ZONE);
  return local ? `${local.replace("T", " ")}（中国标准时间）` : "";
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
