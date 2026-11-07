/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { isValidNepaliDate } from "../utils/nepaliDate";
import NepaliDatePicker from "./NepaliDatePicker";

const NepaliDateRangePicker = ({ startDate, endDate, onApply, calendars = [] }) => {
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
  }, [startDate, endDate]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isValidNepaliDate(draftStart, calendars) || !isValidNepaliDate(draftEnd, calendars)) {
      setError("Enter valid dates for the configured Nepali calendar.");
      return;
    }
    if (draftStart > draftEnd) {
      setError("From date must be on or before To date.");
      return;
    }
    setError("");
    onApply({ startDate: draftStart, endDate: draftEnd });
  };

  const updateStart = (value) => {
    setDraftStart(value);
    setError("");
  };
  const updateEnd = (value) => {
    setDraftEnd(value);
    setError("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <NepaliDatePicker
        label="From"
        value={draftStart}
        onChange={updateStart}
        calendars={calendars}
      />
      <NepaliDatePicker
        label="To"
        value={draftEnd}
        onChange={updateEnd}
        calendars={calendars}
      />
      <button
        type="submit"
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
      >
        Apply
      </button>
      {error && <p role="alert" className="w-full text-[10px] text-rose-700">{error}</p>}
    </form>
  );
};

export default NepaliDateRangePicker;
