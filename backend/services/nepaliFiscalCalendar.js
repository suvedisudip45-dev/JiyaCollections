import nepaliDateModule from "nepali-date-converter";
import { prisma } from "../config/db.js";

const NepaliDate = nepaliDateModule.default || nepaliDateModule;

const TIME_ZONE = "Asia/Kathmandu";
const KATHMANDU_OFFSET_MINUTES = 345;
const FISCAL_YEAR_START_MONTH = 3;
export const NEPALI_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
];
const DAY_MS = 24 * 60 * 60 * 1000;

const getCalendarDateInKathmandu = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid accounting date is required.");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(part("year"), part("month") - 1, part("day"));
};

const toKathmanduMidnight = (nepaliDate) => {
  const gregorian = nepaliDate.getAD();
  return new Date(Date.UTC(gregorian.year, gregorian.month, gregorian.date) - KATHMANDU_OFFSET_MINUTES * 60_000);
};

export const getNepaliDateRange = (startDate, endDate) => {
  const parseDate = (value, label) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) {
      const error = new Error(`${label} must be a valid BS date in YYYY-MM-DD format.`);
      error.statusCode = 400;
      error.code = "INVALID_NEPALI_DATE";
      throw error;
    }

    const [, yearValue, monthValue, dayValue] = match;
    const year = Number(yearValue);
    const month = Number(monthValue) - 1;
    const day = Number(dayValue);
    if (year < 1000 || year > 9999) {
      const error = new Error(`${label} must use a Gregorian year between 1000 and 9999.`);
      error.statusCode = 400;
      error.code = "INVALID_AD_DATE";
      throw error;
    }
    let nepaliDate;
    try {
      nepaliDate = new NepaliDate(year, month, day);
    } catch {
      const error = new Error(`${label} is outside the supported BS calendar range.`);
      error.statusCode = 400;
      error.code = "INVALID_NEPALI_DATE";
      throw error;
    }
    if (nepaliDate.getYear() !== year || nepaliDate.getMonth() !== month || nepaliDate.getDate() !== day) {
      const error = new Error(`${label} is not a valid date in the Nepali calendar.`);
      error.statusCode = 400;
      error.code = "INVALID_NEPALI_DATE";
      throw error;
    }

    return toKathmanduMidnight(nepaliDate);
  };

  if (!startDate || !endDate) {
    const error = new Error("Both BS startDate and endDate are required.");
    error.statusCode = 400;
    error.code = "NEPALI_DATE_RANGE_REQUIRED";
    throw error;
  }

  const start = parseDate(startDate, "startDate");
  const end = new Date(parseDate(endDate, "endDate").getTime() + 24 * 60 * 60 * 1000 - 1);
  if (start > end) {
    const error = new Error("startDate must be on or before endDate.");
    error.statusCode = 400;
    error.code = "INVALID_NEPALI_DATE_RANGE";
    throw error;
  }

  return { startDate: start, endDate: end };
};

const parseGregorianDate = (value, label = "adStartDate") => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) {
    const error = new Error(`${label} must be a valid AD date in YYYY-MM-DD format.`);
    error.statusCode = 400;
    error.code = "INVALID_AD_DATE";
    throw error;
  }
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue) - 1;
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    const error = new Error(`${label} is not a valid Gregorian calendar date.`);
    error.statusCode = 400;
    error.code = "INVALID_AD_DATE";
    throw error;
  }
  return date;
};

const asDateOnly = (value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
};

const getCalendarYearDays = (calendar) =>
  Array.isArray(calendar.monthDays) ? calendar.monthDays.reduce((sum, days) => sum + Number(days), 0) : 0;

const getAdDateForCalendarYearDay = (calendar, dayOffset) => {
  const date = parseGregorianDate(asDateOnly(calendar.adStartDate));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
};

const toCalendarConfig = (calendar) => ({
  year: Number(calendar.year),
  adStartDate: asDateOnly(calendar.adStartDate),
  monthDays: Array.isArray(calendar.monthDays) ? calendar.monthDays.map(Number) : [],
  totalDays: getCalendarYearDays(calendar),
});

export const validateNepaliCalendarYear = (input, existingYears = []) => {
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 1 || year > 9998) {
    const error = new Error("BS year must be a whole number between 1 and 9998.");
    error.statusCode = 400;
    error.code = "INVALID_BS_YEAR";
    throw error;
  }
  if (!Array.isArray(input.monthDays) || input.monthDays.length !== 12) {
    const error = new Error("Enter the number of days for all 12 BS months.");
    error.statusCode = 400;
    error.code = "INVALID_MONTH_DAYS";
    throw error;
  }
  const monthDays = input.monthDays.map(Number);
  if (monthDays.some((days) => !Number.isInteger(days) || days < 29 || days > 32)) {
    const error = new Error("Each BS month must have between 29 and 32 days.");
    error.statusCode = 400;
    error.code = "INVALID_MONTH_DAYS";
    throw error;
  }
  const totalDays = monthDays.reduce((sum, days) => sum + days, 0);
  if (![365, 366].includes(totalDays)) {
    const error = new Error("The 12 month lengths must add up to 365 or 366 days.");
    error.statusCode = 400;
    error.code = "INVALID_BS_YEAR_LENGTH";
    throw error;
  }
  const start = parseGregorianDate(input.adStartDate);
  const startDay = start.getTime();
  const endDay = startDay + totalDays * DAY_MS;

  for (const other of existingYears) {
    if (Number(other.year) === year) continue;
    const otherStart = parseGregorianDate(asDateOnly(other.adStartDate)).getTime();
    const otherEnd = otherStart + getCalendarYearDays(other) * DAY_MS;
    if (startDay < otherEnd && otherStart < endDay) {
      const error = new Error(`The AD dates for BS ${year} overlap with configured BS ${other.year}.`);
      error.statusCode = 409;
      error.code = "NEPALI_CALENDAR_OVERLAP";
      throw error;
    }

    if (Number(other.year) === year - 1 && startDay !== otherEnd) {
      const error = new Error(`BS ${year} must start the day after configured BS ${year - 1} ends.`);
      error.statusCode = 409;
      error.code = "NEPALI_CALENDAR_GAP";
      throw error;
    }
    if (Number(other.year) === year + 1 && endDay !== otherStart) {
      const error = new Error(`Configured BS ${year + 1} must start the day after BS ${year} ends.`);
      error.statusCode = 409;
      error.code = "NEPALI_CALENDAR_GAP";
      throw error;
    }
  }

  return { year, adStartDate: start, monthDays, totalDays };
};

export const getNepaliCalendarYears = async (client = prisma) => {
  const calendars = await client.nepaliCalendarYear.findMany({ orderBy: { year: "desc" } });
  return calendars.map(toCalendarConfig);
};

export const saveNepaliCalendarYear = async (input, client = prisma, afterCreate = null) =>
  client.$transaction(async (tx) => {
    const existingYears = await tx.nepaliCalendarYear.findMany({
      select: { year: true, adStartDate: true, monthDays: true },
    });
    const normalized = validateNepaliCalendarYear(input, existingYears);
    const existing = existingYears.find((calendar) => Number(calendar.year) === normalized.year);
    const data = {
      adStartDate: normalized.adStartDate,
      monthDays: normalized.monthDays,
    };

    if (existing) {
      const unchanged = asDateOnly(existing.adStartDate) === asDateOnly(data.adStartDate) &&
        Array.isArray(existing.monthDays) &&
        existing.monthDays.map(Number).every((days, index) => days === data.monthDays[index]) &&
        existing.monthDays.length === data.monthDays.length;
      if (!unchanged) {
        const error = new Error(
          `BS ${normalized.year} is already saved and cannot be changed. Saved calendar mappings are immutable.`,
        );
        error.statusCode = 409;
        error.code = "NEPALI_CALENDAR_YEAR_IMMUTABLE";
        throw error;
      }
      return toCalendarConfig(existing);
    }

    const saved = await tx.nepaliCalendarYear.create({
      data: { year: normalized.year, ...data },
    });
    if (afterCreate) await afterCreate(saved, tx);
    return toCalendarConfig(saved);
  }, { isolationLevel: "Serializable" });

const getCustomNepaliDateParts = (value, calendars) => {
  const date = getCalendarDateInKathmandu(value);
  const adDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = Math.floor(adDate.getTime() / DAY_MS);

  for (const calendar of calendars) {
    const start = parseGregorianDate(calendar.adStartDate).getTime();
    const offset = dayNumber - start / DAY_MS;
    if (offset < 0 || offset >= calendar.totalDays) continue;
    let remainingDays = offset;
    for (let month = 0; month < 12; month += 1) {
      if (remainingDays < calendar.monthDays[month]) {
        return { year: calendar.year, month: month + 1, day: remainingDays + 1, custom: true };
      }
      remainingDays -= calendar.monthDays[month];
    }
  }
  return null;
};

export const getNepaliCalendarDateFromAD = async (value, calendars) => {
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const customDate = getCustomNepaliDateParts(value, configuredYears);
  if (customDate) return `${customDate.year}-${String(customDate.month).padStart(2, "0")}-${String(customDate.day).padStart(2, "0")}`;
  const nepaliDate = NepaliDate.fromAD(getCalendarDateInKathmandu(value));
  return `${nepaliDate.getYear()}-${String(nepaliDate.getMonth() + 1).padStart(2, "0")}-${String(nepaliDate.getDate()).padStart(2, "0")}`;
};

export const getConfiguredAdDateForNepaliDate = async (year, month, day, calendars) => {
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const calendar = configuredYears.find((entry) => entry.year === Number(year));
  if (calendar) {
    if (!Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(day) || day < 1 || day > calendar.monthDays[month - 1]) {
      const error = new Error("The BS date is not valid for the configured month lengths.");
      error.statusCode = 400;
      error.code = "INVALID_NEPALI_DATE";
      throw error;
    }
    let dayOffset = day - 1;
    for (let index = 0; index < month - 1; index += 1) dayOffset += calendar.monthDays[index];
    const adDate = getAdDateForCalendarYearDay(calendar, dayOffset);
    return new Date(adDate.getTime() - KATHMANDU_OFFSET_MINUTES * 60_000);
  }

  let nepaliDate;
  try {
    nepaliDate = new NepaliDate(Number(year), Number(month) - 1, Number(day));
  } catch {
    const error = new Error("The BS date is not covered by a configured calendar year.");
    error.statusCode = 400;
    error.code = "NEPALI_CALENDAR_YEAR_REQUIRED";
    throw error;
  }
  if (nepaliDate.getYear() !== Number(year) ||
      nepaliDate.getMonth() !== Number(month) - 1 ||
      nepaliDate.getDate() !== Number(day)) {
    const error = new Error("The BS date is not valid in the Nepali calendar.");
    error.statusCode = 400;
    error.code = "INVALID_NEPALI_DATE";
    throw error;
  }
  return toKathmanduMidnight(nepaliDate);
};

export const resolveCalendarDateInput = async (value, calendar, calendars) => {
  if (calendar == null || calendar === "") return value;
  const normalizedCalendar = String(calendar).trim().toUpperCase();
  if (normalizedCalendar === "AD") return value;
  if (normalizedCalendar !== "BS") {
    const error = new Error("calendar must be either BS or AD.");
    error.statusCode = 400;
    error.code = "INVALID_CALENDAR";
    throw error;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) {
    const error = new Error("BS dates must use YYYY-MM-DD format.");
    error.statusCode = 400;
    error.code = "INVALID_NEPALI_DATE";
    throw error;
  }
  return getConfiguredAdDateForNepaliDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    calendars,
  );
};

export const getConfiguredNepaliDateRange = async (startDate, endDate, calendars) => {
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate || "");
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate || "");
  const parseDate = async (value, label) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) {
      const error = new Error(`${label} must be a valid BS date in YYYY-MM-DD format.`);
      error.statusCode = 400;
      error.code = "INVALID_NEPALI_DATE";
      throw error;
    }
    return getConfiguredAdDateForNepaliDate(Number(match[1]), Number(match[2]), Number(match[3]), configuredYears);
  };

  if (!startDate || !endDate) {
    const error = new Error("Both BS startDate and endDate are required.");
    error.statusCode = 400;
    error.code = "NEPALI_DATE_RANGE_REQUIRED";
    throw error;
  }
  if (!startMatch || !endMatch) {
    const error = new Error("Both dates must use BS YYYY-MM-DD format.");
    error.statusCode = 400;
    error.code = "INVALID_NEPALI_DATE";
    throw error;
  }
  const startYear = Number(startMatch[1]);
  const endYear = Number(endMatch[1]);
  const rangeYears = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  const hasConfiguredYear = rangeYears.some((year) =>
    configuredYears.some((calendar) => calendar.year === year),
  );
  if (hasConfiguredYear && rangeYears.some((year) =>
    !configuredYears.some((calendar) => calendar.year === year),
  )) {
    const error = new Error("Date ranges crossing custom calendar years require a configured mapping for every BS year in the range.");
    error.statusCode = 409;
    error.code = "NEPALI_CALENDAR_YEAR_REQUIRED";
    throw error;
  }
  const start = await parseDate(startDate, "startDate");
  const end = new Date((await parseDate(endDate, "endDate")).getTime() + DAY_MS - 1);
  if (start > end) {
    const error = new Error("startDate must be on or before endDate.");
    error.statusCode = 400;
    error.code = "INVALID_NEPALI_DATE_RANGE";
    throw error;
  }
  return { startDate: start, endDate: end };
};

export const resolveCalendarDateRangeInput = async (startDate, endDate, calendar, calendars) => {
  if (calendar == null || calendar === "") return { startDate, endDate };
  const normalizedCalendar = String(calendar).trim().toUpperCase();
  if (normalizedCalendar === "AD") return { startDate, endDate };
  if (normalizedCalendar === "BS") {
    return getConfiguredNepaliDateRange(startDate, endDate, calendars);
  }
  const error = new Error("calendar must be either BS or AD.");
  error.statusCode = 400;
  error.code = "INVALID_CALENDAR";
  throw error;
};

export const resolveCalendarDateFilterInput = async (startDate, endDate, calendar, calendars) => {
  if (!calendar || String(calendar).trim().toUpperCase() === "AD") {
    return {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    };
  }
  if (String(calendar).trim().toUpperCase() !== "BS") {
    const error = new Error("calendar must be either BS or AD.");
    error.statusCode = 400;
    error.code = "INVALID_CALENDAR";
    throw error;
  }
  if (startDate && endDate) {
    return resolveCalendarDateRangeInput(startDate, endDate, "BS", calendars);
  }
  const date = startDate || endDate;
  if (!date) return { startDate: null, endDate: null };
  const boundary = await resolveCalendarDateInput(date, "BS", calendars);
  return startDate
    ? { startDate: boundary, endDate: null }
    : { startDate: null, endDate: new Date(boundary.getTime() + DAY_MS - 1) };
};

export const getConfiguredNepaliMonthRange = async (year, month, calendars) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    const error = new Error("month must be a valid BS month in YYYY-MM format.");
    error.statusCode = 400;
    error.code = "INVALID_MONTH";
    throw error;
  }
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const configuredYear = configuredYears.find((entry) => entry.year === numericYear);
  let lastDay = configuredYear?.monthDays[numericMonth - 1];
  if (!lastDay) {
    for (let day = 32; day >= 29; day -= 1) {
      try {
        await getConfiguredAdDateForNepaliDate(numericYear, numericMonth, day, configuredYears);
        lastDay = day;
        break;
      } catch (error) {
        if (error.code !== "INVALID_NEPALI_DATE") throw error;
      }
    }
  }
  if (!lastDay) {
    const error = new Error("The requested BS month is outside the supported calendar range.");
    error.statusCode = 400;
    error.code = "INVALID_MONTH";
    throw error;
  }
  return getConfiguredNepaliDateRange(
    `${numericYear}-${String(numericMonth).padStart(2, "0")}-01`,
    `${numericYear}-${String(numericMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    configuredYears,
  );
};

export const getConfiguredNepaliFiscalPeriod = async (value, calendars) => {
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const bsDate = await getNepaliCalendarDateFromAD(value, configuredYears);
  const [year, month] = bsDate.split("-").map(Number);
  const fiscalYearNumber = month >= FISCAL_YEAR_START_MONTH + 1 ? year : year - 1;
  const fiscalStartYearConfigured = configuredYears.some((entry) => entry.year === fiscalYearNumber);
  const fiscalEndYearConfigured = configuredYears.some((entry) => entry.year === fiscalYearNumber + 1);
  if (fiscalStartYearConfigured !== fiscalEndYearConfigured) {
    const error = new Error(`Configure both BS ${fiscalYearNumber} and BS ${fiscalYearNumber + 1} before using this custom fiscal year.`);
    error.statusCode = 409;
    error.code = "NEPALI_CALENDAR_YEAR_REQUIRED";
    throw error;
  }
  const inputYearConfigured = configuredYears.some((entry) => entry.year === year);
  if ((fiscalStartYearConfigured || fiscalEndYearConfigured) && !inputYearConfigured) {
    const error = new Error(`Configure BS ${year} before using its custom fiscal period.`);
    error.statusCode = 409;
    error.code = "NEPALI_CALENDAR_YEAR_REQUIRED";
    throw error;
  }
  const periodStart = await getConfiguredAdDateForNepaliDate(year, month, 1, configuredYears);
  const configuredYear = configuredYears.find((entry) => entry.year === year);
  const periodEnd = configuredYear
    ? new Date(periodStart.getTime() + configuredYear.monthDays[month - 1] * DAY_MS - 1)
    : getNepaliFiscalPeriod(value).periodEnd;
  const fiscalYearStart = await getConfiguredAdDateForNepaliDate(fiscalYearNumber, 4, 1, configuredYears);
  const fiscalYearEnd = new Date(
    (await getConfiguredAdDateForNepaliDate(fiscalYearNumber + 1, 4, 1, configuredYears)).getTime() - 1,
  );

  return {
    fiscalYearNumber,
    fiscalYearName: `${fiscalYearNumber}/${fiscalYearNumber + 1}`,
    fiscalYearStart,
    fiscalYearEnd,
    periodName: `${year}-${String(month).padStart(2, "0")}`,
    periodStart,
    periodEnd,
    nepaliYear: year,
    nepaliMonth: month,
    timeZone: TIME_ZONE,
  };
};

export const getConfiguredNepaliFiscalYear = async (startDate, endDate, calendars) => {
  const configuredYears = Array.isArray(calendars) ? calendars : await getNepaliCalendarYears();
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate || "");
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate || "");
  if (!startMatch || !endMatch) {
    const error = new Error("Fiscal year dates must use BS YYYY-MM-DD format.");
    error.statusCode = 400;
    error.code = "INVALID_FISCAL_YEAR_RANGE";
    throw error;
  }

  const startRange = await getConfiguredNepaliDateRange(startDate, startDate, configuredYears);
  const endRange = await getConfiguredNepaliDateRange(endDate, endDate, configuredYears);
  const fiscalPeriod = await getConfiguredNepaliFiscalPeriod(startRange.startDate, configuredYears);
  if (startRange.startDate.getTime() !== fiscalPeriod.fiscalYearStart.getTime() ||
      endRange.endDate.getTime() !== fiscalPeriod.fiscalYearEnd.getTime()) {
    const error = new Error("Fiscal year must start on Shrawan 1 and end on the final day of Ashadh.");
    error.statusCode = 400;
    error.code = "INVALID_FISCAL_YEAR_RANGE";
    throw error;
  }

  const periods = [];
  let year = Number(startMatch[1]);
  let month = 4;
  for (let index = 0; index < 12; index += 1) {
    const range = await getConfiguredNepaliMonthRange(year, month, configuredYears);
    periods.push({
      periodName: `${year}-${String(month).padStart(2, "0")}`,
      startDate: range.startDate,
      endDate: range.endDate,
      status: "OPEN",
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return {
    fiscalYearStart: startRange.startDate,
    fiscalYearEnd: endRange.endDate,
    periods,
  };
};

export const getNepaliFiscalPeriod = (value) => {
  const nepaliDate = NepaliDate.fromAD(getCalendarDateInKathmandu(value));
  const nepaliYear = nepaliDate.getYear();
  const nepaliMonthIndex = nepaliDate.getMonth();
  const fiscalYearStart = nepaliMonthIndex >= FISCAL_YEAR_START_MONTH ? nepaliYear : nepaliYear - 1;

  const fiscalStart = toKathmanduMidnight(new NepaliDate(fiscalYearStart, FISCAL_YEAR_START_MONTH, 1));
  const nextFiscalStart = toKathmanduMidnight(new NepaliDate(fiscalYearStart + 1, FISCAL_YEAR_START_MONTH, 1));
  const periodStartDate = new NepaliDate(nepaliYear, nepaliMonthIndex, 1);
  const nextPeriodDate = new NepaliDate(nepaliYear, nepaliMonthIndex, 1);
  nextPeriodDate.setMonth(nepaliMonthIndex + 1);
  const periodStart = toKathmanduMidnight(periodStartDate);
  const nextPeriodStart = toKathmanduMidnight(nextPeriodDate);

  return {
    fiscalYearNumber: fiscalYearStart,
    fiscalYearName: `${fiscalYearStart}/${fiscalYearStart + 1}`,
    fiscalYearStart: fiscalStart,
    fiscalYearEnd: new Date(nextFiscalStart.getTime() - 1),
    periodName: `${nepaliYear}-${String(nepaliMonthIndex + 1).padStart(2, "0")}`,
    periodStart,
    periodEnd: new Date(nextPeriodStart.getTime() - 1),
    nepaliYear,
    nepaliMonth: nepaliMonthIndex + 1,
    timeZone: TIME_ZONE,
  };
};