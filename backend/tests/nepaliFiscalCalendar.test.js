import assert from "node:assert/strict";
import test from "node:test";
import nepaliDateModule from "nepali-date-converter";
import {
  getConfiguredAdDateForNepaliDate,
  getConfiguredNepaliFiscalPeriod,
  getConfiguredNepaliFiscalYear,
  getConfiguredNepaliDateRange,
  getConfiguredNepaliMonthRange,
  getNepaliCalendarDateFromAD,
  getNepaliDateRange,
  getNepaliFiscalPeriod,
  resolveCalendarDateInput,
  resolveCalendarDateFilterInput,
  resolveCalendarDateRangeInput,
  saveNepaliCalendarYear,
  validateNepaliCalendarYear,
} from "../services/nepaliFiscalCalendar.js";

const NepaliDate = nepaliDateModule.default || nepaliDateModule;

const kathmanduMidnightForBsDate = (year, monthIndex, day) => {
  const ad = new NepaliDate(year, monthIndex, day).getAD();
  return new Date(Date.UTC(ad.year, ad.month, ad.date) - 345 * 60_000);
};

test("BS Shrawan 1 begins the configured Nepali fiscal year at Kathmandu midnight", () => {
  const fiscalStart = kathmanduMidnightForBsDate(2083, 3, 1);
  const period = getNepaliFiscalPeriod(fiscalStart);
  assert.equal(period.fiscalYearName, "2083/2084");
  assert.equal(period.fiscalYearNumber, 2083);
  assert.equal(period.periodName, "2083-04");
  assert.equal(period.periodStart.getTime(), fiscalStart.getTime());
  assert.equal(period.timeZone, "Asia/Kathmandu");

  const priorInstant = new Date(fiscalStart.getTime() - 1);
  assert.equal(getNepaliFiscalPeriod(priorInstant).fiscalYearName, "2082/2083");
});

test("BS month periods meet exactly at Kathmandu midnight without gaps", () => {
  const shrawanStart = kathmanduMidnightForBsDate(2083, 3, 1);
  const nextMonthStart = kathmanduMidnightForBsDate(2083, 4, 1);
  const shrawan = getNepaliFiscalPeriod(shrawanStart);
  const bhadra = getNepaliFiscalPeriod(nextMonthStart);

  assert.equal(shrawan.periodName, "2083-04");
  assert.equal(shrawan.periodEnd.getTime() + 1, nextMonthStart.getTime());
  assert.equal(bhadra.periodName, "2083-05");
  assert.equal(bhadra.periodStart.getTime(), nextMonthStart.getTime());
});

test("Gregorian instants use the Asia/Kathmandu calendar date", () => {
  const nepaliDayStartUtc = new Date("2026-09-27T18:15:00.000Z");
  const expected = NepaliDate.fromAD(new Date(2026, 8, 28));
  const period = getNepaliFiscalPeriod(nepaliDayStartUtc);
  assert.equal(period.nepaliYear, expected.getYear());
  assert.equal(period.nepaliMonth, expected.getMonth() + 1);
});

test("BS date ranges map to inclusive Kathmandu calendar-day boundaries", () => {
  const range = getNepaliDateRange("2083-07-01", "2083-07-02");
  assert.equal(range.startDate.toISOString(), "2026-10-17T18:15:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-10-19T18:14:59.999Z");
});

test("BS date ranges reject invalid dates and reversed boundaries", () => {
  assert.throws(
    () => getNepaliDateRange("2083-07-40", "2083-08-01"),
    { code: "INVALID_NEPALI_DATE", statusCode: 400 },
  );
  assert.throws(
    () => getNepaliDateRange("2083-08-01", "2083-07-01"),
    { code: "INVALID_NEPALI_DATE_RANGE", statusCode: 400 },
  );
  assert.throws(
    () => getNepaliDateRange("2083-07-01", ""),
    { code: "NEPALI_DATE_RANGE_REQUIRED", statusCode: 400 },
  );
});

test("configured month lengths map BS days to matching Gregorian weekdays", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const adStart = await getConfiguredAdDateForNepaliDate(2080, 1, 1, [calendar]);
  const bsStart = await getNepaliCalendarDateFromAD(new Date("2023-04-15T12:00:00Z"), [calendar]);
  assert.equal(bsStart, "2080-01-01");
  assert.equal(new Date(adStart.getTime() + 345 * 60_000).toISOString().slice(0, 10), "2023-04-15");
  assert.equal(
    new Date(adStart.getTime() + 345 * 60_000).getUTCDay(),
    new Date("2023-04-15T00:00:00Z").getUTCDay(),
  );

  const jesthaFirst = await getConfiguredAdDateForNepaliDate(2080, 2, 1, [calendar]);
  assert.equal(new Date(jesthaFirst.getTime() + 345 * 60_000).toISOString().slice(0, 10), "2023-05-16");
});

test("custom calendar ranges use entered month lengths and inclusive AD boundaries", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const range = await getConfiguredNepaliDateRange("2080-01-01", "2080-01-31", [calendar]);
  assert.equal(range.startDate.toISOString(), "2023-04-14T18:15:00.000Z");
  assert.equal(range.endDate.toISOString(), "2023-05-15T18:14:59.999Z");
});

test("calendar date inputs preserve date-only BS semantics at Kathmandu boundaries", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const date = await resolveCalendarDateInput("2080-01-01", "BS", [calendar]);
  assert.equal(date.toISOString(), "2023-04-14T18:15:00.000Z");
  assert.equal(await resolveCalendarDateInput("2023-04-15", "AD", [calendar]), "2023-04-15");

  const range = await resolveCalendarDateRangeInput("2080-01-01", "2080-01-31", "BS", [calendar]);
  assert.equal(range.startDate.toISOString(), "2023-04-14T18:15:00.000Z");
  assert.equal(range.endDate.toISOString(), "2023-05-15T18:14:59.999Z");
  const startFilter = await resolveCalendarDateFilterInput("2080-01-01", "", "BS", [calendar]);
  assert.equal(startFilter.startDate.toISOString(), "2023-04-14T18:15:00.000Z");
  assert.equal(startFilter.endDate, null);
  const endFilter = await resolveCalendarDateFilterInput("", "2080-01-01", "BS", [calendar]);
  assert.equal(endFilter.startDate, null);
  assert.equal(endFilter.endDate.toISOString(), "2023-04-15T18:14:59.999Z");
  await assert.rejects(resolveCalendarDateInput("2080-01-32", "BS", [calendar]), {
    code: "INVALID_NEPALI_DATE",
    statusCode: 400,
  });
  await assert.rejects(resolveCalendarDateInput("2080-01-01", "gregorian", [calendar]), {
    code: "INVALID_CALENDAR",
    statusCode: 400,
  });
});

test("custom calendar ranges require mappings for every BS year they cross", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  await assert.rejects(
    getConfiguredNepaliDateRange("2079-12-30", "2080-01-02", [calendar]),
    { code: "NEPALI_CALENDAR_YEAR_REQUIRED", statusCode: 409 },
  );
  await assert.rejects(
    getConfiguredNepaliDateRange("2080-12-30", "2081-01-02", [calendar]),
    { code: "NEPALI_CALENDAR_YEAR_REQUIRED", statusCode: 409 },
  );
});

test("custom calendar month periods follow configured month lengths", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const nextCalendar = {
    year: 2081,
    adStartDate: "2024-04-14",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const period = await getConfiguredNepaliFiscalPeriod(
    new Date("2023-07-18T12:00:00Z"),
    [nextCalendar, calendar],
  );
  assert.equal(period.periodName, "2080-04");
  assert.equal(period.periodStart.toISOString(), "2023-07-17T18:15:00.000Z");
  assert.equal(period.periodEnd.toISOString(), "2023-08-18T18:14:59.999Z");
  assert.equal(period.fiscalYearStart.toISOString(), period.periodStart.toISOString());
});

test("custom fiscal periods require both configured years in the fiscal cycle", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  await assert.rejects(
    getConfiguredNepaliFiscalPeriod(new Date("2023-07-18T12:00:00Z"), [calendar]),
    { code: "NEPALI_CALENDAR_YEAR_REQUIRED", statusCode: 409 },
  );
});

test("configured fiscal years generate twelve continuous Shrawan-to-Ashadh periods", async () => {
  const monthDays = [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30];
  const calendars = [
    { year: 2080, adStartDate: "2023-04-15", monthDays, totalDays: 365 },
    { year: 2081, adStartDate: "2024-04-14", monthDays, totalDays: 365 },
  ];

  const fiscalYear = await getConfiguredNepaliFiscalYear("2080-04-01", "2081-03-31", calendars);

  assert.equal(fiscalYear.periods.length, 12);
  assert.equal(fiscalYear.periods[0].periodName, "2080-04");
  assert.equal(fiscalYear.periods[11].periodName, "2081-03");
  assert.equal(fiscalYear.periods[0].startDate.toISOString(), fiscalYear.fiscalYearStart.toISOString());
  assert.equal(fiscalYear.periods[11].endDate.toISOString(), fiscalYear.fiscalYearEnd.toISOString());
  for (let index = 1; index < fiscalYear.periods.length; index += 1) {
    assert.equal(
      fiscalYear.periods[index].startDate.getTime(),
      fiscalYear.periods[index - 1].endDate.getTime() + 1,
    );
  }
});

test("fiscal-year generation rejects ranges not aligned to BS fiscal boundaries", async () => {
  await assert.rejects(
    getConfiguredNepaliFiscalYear("2080-01-01", "2081-12-30", []),
    { code: "INVALID_FISCAL_YEAR_RANGE", statusCode: 400 },
  );
});

test("configured BS month ranges map the first and last BS day to Kathmandu boundaries", async () => {
  const calendar = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    totalDays: 365,
  };
  const range = await getConfiguredNepaliMonthRange(2080, 2, [calendar]);
  assert.equal(range.startDate.toISOString(), "2023-05-15T18:15:00.000Z");
  assert.equal(range.endDate.toISOString(), "2023-06-16T18:14:59.999Z");
});

test("custom calendar definitions validate month counts, year length, and adjacent-year continuity", () => {
  const monthDays = [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30];
  assert.equal(
    validateNepaliCalendarYear({ year: 2080, adStartDate: "2023-04-15", monthDays }).totalDays,
    365,
  );
  assert.throws(
    () => validateNepaliCalendarYear({ year: 2080, adStartDate: "2023-04-15", monthDays: [31] }),
    { code: "INVALID_MONTH_DAYS", statusCode: 400 },
  );
  assert.throws(
    () => validateNepaliCalendarYear(
      { year: 2081, adStartDate: "2024-04-15", monthDays },
      [{ year: 2080, adStartDate: new Date("2023-04-15T00:00:00.000Z"), monthDays }],
    ),
    { code: "NEPALI_CALENDAR_GAP", statusCode: 409 },
  );
});

test("saved custom calendar years are immutable but identical retries are idempotent", async () => {
  const years = new Map();
  const auditEvents = [];
  const tx = {
    nepaliCalendarYear: {
      findMany: async () => [...years.values()],
      create: async ({ data }) => {
        if (years.has(data.year)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const saved = { ...data, id: `calendar-${data.year}` };
        years.set(data.year, saved);
        return saved;
      },
    },
  };
  const client = {
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      return callback(tx);
    },
  };
  const input = {
    year: 2080,
    adStartDate: "2023-04-15",
    monthDays: [31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 30, 30],
  };

  const saved = await saveNepaliCalendarYear(input, client, async (year) => auditEvents.push(year));
  const retried = await saveNepaliCalendarYear(input, client, async (year) => auditEvents.push(year));
  assert.equal(saved.adStartDate, input.adStartDate);
  assert.deepEqual(retried, saved);
  assert.equal(auditEvents.length, 1);
  await assert.rejects(
    saveNepaliCalendarYear({ ...input, adStartDate: "2023-04-16" }, client),
    { code: "NEPALI_CALENDAR_YEAR_IMMUTABLE", statusCode: 409 },
  );
  assert.equal(years.get(2080).adStartDate.toISOString().slice(0, 10), input.adStartDate);
});