/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const MONTHS = [
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
const EMPTY_MONTH_DAYS = Array(12).fill("");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GREGORIAN_MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});
const GREGORIAN_YEAR_FORMATTER = new Intl.DateTimeFormat("en", {
  year: "numeric",
  timeZone: "UTC",
});

const getWeekday = (date) => {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? "" : WEEKDAYS[parsed.getUTCDay()];
};

const getAdEndDate = (startDate, totalDays) => {
  const endDate = new Date(`${startDate}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + totalDays - 1);
  return endDate.toISOString().slice(0, 10);
};

const getGregorianMonthLabel = (startDate, daysInMonth) => {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + daysInMonth - 1);
  const startMonth = GREGORIAN_MONTH_FORMATTER.format(start);
  const endMonth = GREGORIAN_MONTH_FORMATTER.format(end);
  const startYear = GREGORIAN_YEAR_FORMATTER.format(start);
  const endYear = GREGORIAN_YEAR_FORMATTER.format(end);
  if (startMonth === endMonth && startYear === endYear) return `${startMonth} ${startYear}`;
  if (startYear === endYear) return `${startMonth}/${endMonth} ${startYear}`;
  return `${startMonth} ${startYear}/${endMonth} ${endYear}`;
};

const getCalendarMonths = (calendarYear) => {
  let yearDayOffset = 0;
  return calendarYear.monthDays.map((daysInMonth, monthIndex) => {
    const monthStart = new Date(`${calendarYear.adStartDate}T00:00:00.000Z`);
    monthStart.setUTCDate(monthStart.getUTCDate() + yearDayOffset);
    const firstWeekday = monthStart.getUTCDay();
    const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
      const nepaliDay = index - firstWeekday + 1;
      if (nepaliDay < 1 || nepaliDay > daysInMonth) return null;
      const adDate = new Date(monthStart);
      adDate.setUTCDate(adDate.getUTCDate() + nepaliDay - 1);
      return {
        nepaliDay,
        adDay: adDate.getUTCDate(),
      };
    });
    yearDayOffset += daysInMonth;
    return {
      name: MONTHS[monthIndex],
      gregorianMonth: getGregorianMonthLabel(monthStart.toISOString().slice(0, 10), daysInMonth),
      cells,
    };
  });
};

const NepaliCalendar = ({ token }) => {
  const [years, setYears] = useState([]);
  const [currentBsDate, setCurrentBsDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewingYear, setViewingYear] = useState(null);
  const [year, setYear] = useState("");
  const [adStartDate, setAdStartDate] = useState("");
  const [monthDays, setMonthDays] = useState(EMPTY_MONTH_DAYS);

  const totalDays = useMemo(
    () => monthDays.reduce((total, days) => total + (Number(days) || 0), 0),
    [monthDays],
  );
  const viewingCalendar = years.find((calendarYear) => calendarYear.year === viewingYear);
  const viewingMonths = viewingCalendar ? getCalendarMonths(viewingCalendar) : [];

  const loadCalendar = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${backendUrl}/api/finance/nepali-calendar/years`, {
        headers: { token },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Could not load calendar years.");
      setYears(response.data.years || []);
      setCurrentBsDate(response.data.currentDate || "");
    } catch (error) {
      console.error("Load Nepali calendar error:", error);
      toast.error(error.response?.data?.message || error.message || "Could not load calendar years.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const handleSave = async (event) => {
    event.preventDefault();
    const numericYear = Number(year);
    const numericMonthDays = monthDays.map(Number);
    if (!Number.isInteger(numericYear) || numericYear < 1 || numericYear > 9998) {
      toast.error("Enter a valid BS year.");
      return;
    }
    if (numericMonthDays.some((days) => !Number.isInteger(days) || days < 29 || days > 32)) {
      toast.error("Enter between 29 and 32 days for each month.");
      return;
    }
    if (![365, 366].includes(totalDays)) {
      toast.error("All 12 months must total 365 or 366 days.");
      return;
    }
    if (!adStartDate) {
      toast.error("Enter the AD date when Baisakh 1 begins.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        year: numericYear,
        adStartDate,
        monthDays: numericMonthDays,
      };
      const response = await axios.post(`${backendUrl}/api/finance/nepali-calendar/years`, payload, {
        headers: { token },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Could not save calendar year.");
      toast.success(`BS ${numericYear} calendar saved.`);
      await loadCalendar();
      setYear(String(numericYear + 1));
      setAdStartDate("");
      setMonthDays([...EMPTY_MONTH_DAYS]);
    } catch (error) {
      console.error("Save Nepali calendar year error:", error);
      toast.error(error.response?.data?.message || error.message || "Could not save calendar year.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Calendar Settings</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Nepali Calendar</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Define each Bikram Sambat year with its Gregorian Baisakh 1 date and month lengths.
          Dates advance one day at a time, so their weekday always matches the linked Gregorian date.
        </p>
      </header>

      <form onSubmit={handleSave} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Add a BS year</h2>
            <p className="mt-1 text-xs text-slate-500">
              The AD weekday is calculated from the date. Saved mappings are immutable, so verify all entries before saving.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Bikram Sambat year
            <input
              type="number"
              min="1"
              max="9998"
              required
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2083"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Gregorian date of Baisakh 1 (AD)
            <input
              type="date"
              required
              value={adStartDate}
              onChange={(event) => setAdStartDate(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
            {adStartDate && (
              <span className="text-[11px] font-normal text-slate-500">
                {getWeekday(adStartDate)} — weekday is linked automatically
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MONTHS.map((month, index) => (
            <label key={month} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
              <span>{String(index + 1).padStart(2, "0")}. {month}</span>
              <span className="flex items-center gap-2 font-normal text-slate-500">
                Days
                <input
                  type="number"
                  min="29"
                  max="32"
                  required
                  value={monthDays[index]}
                  onChange={(event) => setMonthDays((days) => days.map((value, monthIndex) => (
                    monthIndex === index ? event.target.value : value
                  )))}
                  className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-center text-sm font-bold text-slate-900"
                  aria-label={`${month} number of days`}
                />
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className={`text-xs font-semibold ${[365, 366].includes(totalDays) ? "text-emerald-700" : "text-amber-700"}`}>
            Year length: {totalDays} days (must be 365 or 366)
          </p>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save calendar year"}
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-base font-bold text-slate-900">Configured years</h2>
          <p className="mt-1 text-xs text-slate-500">
            Current Nepali date: {currentBsDate ? `BS ${currentBsDate}` : "Loading"}
          </p>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Loading calendar years...</p>
        ) : years.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No custom BS years are configured. The existing Nepali calendar remains in use.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {years.map((calendarYear) => (
              <div key={calendarYear.year} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-bold text-slate-900">BS {calendarYear.year}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Baisakh 1: {calendarYear.adStartDate} ({getWeekday(calendarYear.adStartDate)}) ·
                    {" "}ends {getAdEndDate(calendarYear.adStartDate, calendarYear.totalDays)} ·
                    {" "}{calendarYear.totalDays} days
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {calendarYear.monthDays.map((days, index) => `${MONTHS[index]} ${days}`).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewingYear((yearInView) => (
                      yearInView === calendarYear.year ? null : calendarYear.year
                    ))}
                    aria-expanded={viewingYear === calendarYear.year}
                    className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    {viewingYear === calendarYear.year ? "Hide calendar" : "View calendar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {viewingCalendar && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">BS {viewingCalendar.year} calendar</h2>
              <p className="mt-1 text-xs text-slate-500">
                Weekday columns follow the Gregorian date. The small date at the bottom of each cell is AD.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViewingYear(null)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close calendar
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
            {viewingMonths.map((month, monthIndex) => (
              <div key={month.name} className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
                  {String(monthIndex + 1).padStart(2, "0")}. {month.name}
                  <span className="ml-1 font-normal text-slate-500">({month.gregorianMonth})</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-center">
                    <thead>
                      <tr>
                        {WEEKDAYS.map((weekday) => (
                          <th key={weekday} scope="col" className="py-2 text-[10px] font-semibold text-slate-500">
                            {weekday.slice(0, 3)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: month.cells.length / 7 }, (_, weekIndex) => (
                        <tr key={weekIndex}>
                          {month.cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((cell, dayIndex) => (
                            <td key={dayIndex} className="h-[66px] border-t border-slate-100 p-1 align-top">
                              {cell && (
                                <div className={`relative h-full rounded-md ${currentBsDate === `${viewingCalendar.year}-${String(monthIndex + 1).padStart(2, "0")}-${String(cell.nepaliDay).padStart(2, "0")}` ? "bg-emerald-50" : ""}`}>
                                  <span className="absolute right-1.5 top-1 text-sm font-bold text-slate-800">
                                    {cell.nepaliDay}
                                  </span>
                                  <span className="absolute bottom-1 left-1.5 text-[9px] leading-none text-slate-500">
                                    {cell.adDay}
                                  </span>
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default NepaliCalendar;
