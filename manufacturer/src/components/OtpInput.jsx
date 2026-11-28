import { useState } from "react";

const OtpInput = ({
  id,
  label,
  value,
  onChange,
  length = 6,
  theme = "dark",
  autoFocus = false,
  required = true,
}) => {
  const [focused, setFocused] = useState(false);
  const digitCount = Math.max(1, Math.trunc(Number(length) || 6));
  const colors = theme === "light"
    ? {
      box: "border-[#dedbd3] bg-white text-[#171717]",
      active: "border-emerald-700 ring-2 ring-emerald-700/15",
      empty: "bg-[#dedbd3]",
    }
    : {
      box: "border-slate-700 bg-slate-950 text-white",
      active: "border-emerald-400 ring-2 ring-emerald-400/20",
      empty: "bg-slate-700",
    };
  const activeIndex = Math.min(value.length, digitCount - 1);

  return (
    <div className="relative mx-auto flex min-h-12 w-full max-w-[20rem] justify-center gap-1.5 sm:gap-2">
      <div aria-hidden="true" className="flex w-full justify-center gap-1.5 sm:gap-2">
        {Array.from({ length: digitCount }, (_, index) => (
          <span
            key={index}
            className={`flex h-12 min-w-0 max-w-12 flex-1 items-center justify-center rounded-xl border font-mono text-xl font-semibold transition-colors ${
              focused && index === activeIndex ? colors.active : colors.box
            }`}
          >
            {value[index] || <span className={`h-1 w-1 rounded-full ${colors.empty}`} />}
          </span>
        ))}
      </div>
      <input
        id={id}
        aria-label={label}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${digitCount}}`}
        maxLength={digitCount}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, digitCount))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 z-10 h-full w-full cursor-text rounded-xl opacity-0"
        style={{ caretColor: "transparent" }}
        autoFocus={autoFocus}
        required={required}
      />
    </div>
  );
};

export default OtpInput;
