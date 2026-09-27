import assert from "node:assert/strict";
import test from "node:test";
import nepaliDateModule from "nepali-date-converter";
import { getNepaliFiscalPeriod } from "../services/nepaliFiscalCalendar.js";

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