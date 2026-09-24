import React from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

const FulfillmentProgressStepper = ({
  steps,
  currentIndex,
  onPrevious,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  previousDisabled = false,
  busy = false,
  children,
}) => {
  const activeStep = steps[currentIndex] || steps[0];

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_-35px_rgba(15,23,42,0.35)] overflow-hidden">
      <div className="bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Fulfillment workflow</p>
            <h2 className="mt-1 text-xl sm:text-2xl font-black tracking-tight text-slate-950">{activeStep?.label}</h2>
            <p className="mt-1 max-w-xl text-xs sm:text-sm text-slate-500">{activeStep?.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 border border-slate-200">
            Step {currentIndex + 1} / {steps.length}
          </span>
        </div>

        <div className="pb-1">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:min-w-[760px] sm:items-start sm:gap-0">
            {steps.map((step, index) => {
              const completed = index < currentIndex;
              const active = index === currentIndex;
              return (
                <React.Fragment key={step.key}>
                  <div className="w-auto text-center sm:w-[104px] sm:shrink-0">
                    <div className="flex items-center justify-center">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${completed ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-emerald-600 bg-white text-emerald-700 ring-4 ring-emerald-100" : "border-slate-200 bg-slate-100 text-slate-400"}`}>
                        {completed ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="text-xs font-black">{index + 1}</span>}
                      </div>
                    </div>
                    <p className={`mt-3 text-[11px] font-black leading-tight ${active ? "text-slate-950" : completed ? "text-emerald-700" : "text-slate-400"}`}>{step.shortLabel || step.label}</p>
                    <p className={`mt-1 text-[9px] font-semibold uppercase tracking-wide ${active ? "text-emerald-700" : completed ? "text-emerald-600" : "text-slate-400"}`}>
                      {completed ? "Completed" : active ? "In progress" : "Pending"}
                    </p>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`hidden sm:block mt-5 h-0.5 min-w-5 flex-1 ${index < currentIndex ? "bg-emerald-600" : "bg-slate-200"}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-6 sm:px-8 sm:py-8">
        {children}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
        <button type="button" onClick={onPrevious} disabled={busy || previousDisabled} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <button type="button" onClick={onNext} disabled={busy || nextDisabled} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
          {nextLabel} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
};

export default FulfillmentProgressStepper;
