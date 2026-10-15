/* eslint-disable react/prop-types */
/* eslint-disable react-refresh/only-export-components */
export const NcmToolField = ({ label, ...props }) => (
  <label className="block text-xs font-semibold text-slate-600">
    {label}
    <input {...props} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400" />
  </label>
);

export const NcmToolResult = ({ title, value }) => (
  <section className="rounded-lg border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
    <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  </section>
);

export const parseIds = (value) => value
  .split(",")
  .map((part) => Number(part.trim()))
  .filter((id) => Number.isSafeInteger(id) && id > 0);
