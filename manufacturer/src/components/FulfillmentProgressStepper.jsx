import { ChevronLeft, ChevronRight } from "lucide-react";

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
  const progressValue = Math.min(Math.max(currentIndex + 1, 0), steps.length);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="p-4 sm:p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-500">
            Step {progressValue} of {steps.length}
          </p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
            {activeStep?.label}
          </h2>
          {activeStep?.description && (
            <p className="mt-1 text-sm leading-5 text-slate-600">
              {activeStep.description}
            </p>
          )}
        </div>

        <div
          className="mt-4 flex gap-1.5"
          role="progressbar"
          aria-label="Fulfillment progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={progressValue}
          aria-valuetext={`${progressValue} of ${steps.length} steps`}
        >
          {steps.map((step, index) => (
            <span
              key={step.key}
              className={`h-1.5 min-w-0 flex-1 rounded-full ${
                index < progressValue ? "bg-emerald-600" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      {children && (
        <div className="space-y-3 border-t border-slate-100 p-4 sm:p-6">
          {children}
        </div>
      )}

      {!(nextDisabled && previousDisabled) && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 p-3 sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={onPrevious}
            disabled={busy || previousDisabled}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={busy || nextDisabled}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            {nextLabel}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};

export default FulfillmentProgressStepper;
