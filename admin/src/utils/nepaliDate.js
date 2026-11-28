import nepaliDateModule from "nepali-date-converter";

const NepaliDate = nepaliDateModule.default || nepaliDateModule;

export const formatNepaliDate = (date, calendars = []) => getNepaliDateForAdDate(date, calendars);

const getDateOnly = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const padDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export const getAdDateForNepaliDate = (value, calendars = []) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return "";
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1) return "";
  const configuredYear = calendars.find((calendar) => Number(calendar.year) === year);
  if (configuredYear) {
    const monthLength = Number(configuredYear.monthDays[month - 1]);
    if (day > monthLength) return "";
    let offset = day - 1;
    for (let index = 0; index < month - 1; index += 1) {
      offset += Number(configuredYear.monthDays[index]);
    }
    const adDate = new Date(`${configuredYear.adStartDate}T00:00:00.000Z`);
    adDate.setUTCDate(adDate.getUTCDate() + offset);
    return adDate.toISOString().slice(0, 10);
  }
  try {
    const date = new NepaliDate(year, month - 1, day);
    if (date.getYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
    const ad = date.getAD();
    return padDate(ad.year, ad.month + 1, ad.date);
  } catch {
    return "";
  }
};

export const getNepaliDateForAdDate = (value, calendars = []) => {
  const adDateText = getDateOnly(value);
  if (!adDateText) return "";
  const [adYear, adMonth, adDay] = adDateText.split("-").map(Number);
  const adDate = new Date(Date.UTC(adYear, adMonth - 1, adDay));
  const dayNumber = Math.floor(adDate.getTime() / 86_400_000);
  for (const calendar of calendars) {
    const start = new Date(`${calendar.adStartDate}T00:00:00.000Z`);
    const offset = dayNumber - Math.floor(start.getTime() / 86_400_000);
    const totalDays = calendar.monthDays.reduce((sum, days) => sum + Number(days), 0);
    if (offset < 0 || offset >= totalDays) continue;
    let remaining = offset;
    for (let month = 0; month < 12; month += 1) {
      const monthLength = Number(calendar.monthDays[month]);
      if (remaining < monthLength) return padDate(calendar.year, month + 1, remaining + 1);
      remaining -= monthLength;
    }
  }
  const nepaliDate = NepaliDate.fromAD(new Date(adYear, adMonth - 1, adDay));
  return padDate(nepaliDate.getYear(), nepaliDate.getMonth() + 1, nepaliDate.getDate());
};

export const getNepaliMonthLength = (year, month, calendars = []) => {
  const configuredYear = calendars.find((calendar) => Number(calendar.year) === Number(year));
  if (configuredYear) return Number(configuredYear.monthDays[Number(month) - 1]) || 0;
  for (let day = 32; day >= 29; day -= 1) {
    if (isValidNepaliDate(padDate(Number(year), Number(month), day), calendars)) return day;
  }
  return 0;
};

export const isValidNepaliDate = (value, calendars = []) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const [, , monthValue, dayValue] = match;
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (month < 1 || month > 12 || day < 1) return false;
  return Boolean(getAdDateForNepaliDate(value, calendars));
};

export const getCurrentNepaliDateRange = ({ fiscalYear = false } = {}) => {
  const today = formatNepaliDate(new Date());
  return getNepaliDateRangeForDate(today, { fiscalYear });
};

export const getNepaliDateRangeForDate = (today, { fiscalYear = false } = {}) => {
  const [year, month] = today.split("-").map(Number);
  const start = fiscalYear
    ? `${month >= 4 ? year : year - 1}-04-01`
    : `${year}-${String(month).padStart(2, "0")}-01`;
  return { startDate: start, endDate: today };
};
