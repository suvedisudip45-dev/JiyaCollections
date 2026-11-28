/* eslint-disable react/prop-types */
import { formatNepaliDate, getNepaliMonthLength } from "../utils/nepaliDate";

const MONTH_NAMES = [
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

const getDateParts = (value) => {
  const [year, month, day] = (value || "").split("-").map(Number);
  return { year, month, day };
};

const NepaliDatePicker = ({ label, value, onChange, calendars = [] }) => {
  const { year, month, day } = getDateParts(value);
  const currentYear = Number(formatNepaliDate(new Date(), calendars).slice(0, 4));
  const years = [...new Set([
    ...calendars.map((calendar) => Number(calendar.year)),
    year,
    ...Array.from({ length: 13 }, (_, index) => currentYear - 10 + index),
  ])]
    .filter((optionYear) => Number.isInteger(optionYear) && optionYear > 0)
    .sort((left, right) => left - right);
  const monthLength = getNepaliMonthLength(year, month, calendars);
  const selectClass = "min-w-0 rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-xs font-bold text-slate-800";

  const updateDatePart = (part, nextValue) => {
    const nextYear = part === "year" ? Number(nextValue) : year;
    const nextMonth = part === "month" ? Number(nextValue) : month;
    const nextMonthLength = getNepaliMonthLength(nextYear, nextMonth, calendars);
    const nextDay = part === "day"
      ? Number(nextValue)
      : Math.min(day || 1, nextMonthLength);
    onChange(`${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="text-[10px] font-semibold text-slate-600">{label} (BS) *</legend>
      <div className="flex gap-1">
        <select
          value={year || ""}
          onChange={(event) => updateDatePart("year", event.target.value)}
          className={`${selectClass} w-[4.5rem]`}
          aria-label={`${label} BS year`}
          required
        >
          {years.map((optionYear) => (
            <option key={optionYear} value={optionYear}>{optionYear}</option>
          ))}
        </select>
        <select
          value={month || ""}
          onChange={(event) => updateDatePart("month", event.target.value)}
          className={`${selectClass} w-[5.5rem]`}
          aria-label={`${label} BS month`}
          required
        >
          {MONTH_NAMES.map((monthName, index) => (
            <option
              key={monthName}
              value={index + 1}
              disabled={!getNepaliMonthLength(year, index + 1, calendars)}
            >
              {monthName}
            </option>
          ))}
        </select>
        <select
          value={day || ""}
          onChange={(event) => updateDatePart("day", event.target.value)}
          className={`${selectClass} w-14`}
          aria-label={`${label} BS day`}
          required
        >
          {Array.from({ length: monthLength }, (_, index) => index + 1).map((optionDay) => (
            <option key={optionDay} value={optionDay}>{optionDay}</option>
          ))}
        </select>
      </div>
    </fieldset>
  );
};

export default NepaliDatePicker;
