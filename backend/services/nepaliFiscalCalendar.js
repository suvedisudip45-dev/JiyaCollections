import nepaliDateModule from "nepali-date-converter";

const NepaliDate = nepaliDateModule.default || nepaliDateModule;

const TIME_ZONE = "Asia/Kathmandu";
const KATHMANDU_OFFSET_MINUTES = 345;
const FISCAL_YEAR_START_MONTH = 3;

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