/* eslint-disable react/prop-types */

const PartnerAnalyticsTable = ({ title, description, columns, rows, emptyMessage }) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {(title || description) && (
      <header className="border-b border-slate-100 px-5 py-4">
        {title && <h2 className="text-sm font-black text-slate-900">{title}</h2>}
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </header>
    )}
    {!rows.length ? (
      <p className="p-5 text-sm text-slate-500">{emptyMessage}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-5 py-3 ${column.numeric ? "text-right" : ""}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, rowIndex) => (
              <tr key={row.id || `${row.province}-${row.district}-${rowIndex}`} className="hover:bg-slate-50/60">
                {columns.map((column) => (
                  <td key={column.key} className={`px-5 py-3 ${column.numeric ? "text-right font-semibold tabular-nums" : ""}`}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

export default PartnerAnalyticsTable;
