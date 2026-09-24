/* oxlint-disable react/prop-types */

const Pagination = ({ page, totalPages, total, limit = 10, onPageChange, loading = false }) => {
  if (!total || totalPages <= 1) return null;
  const firstPage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => firstPage + index);
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <nav className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-4" aria-label="Pagination">
      <span className="text-xs text-slate-500">Showing {start}-{end} of {total}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={loading || page === 1} onClick={() => onPageChange(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold disabled:opacity-40">Previous</button>
        {pages.map((pageNumber) => <button type="button" key={pageNumber} disabled={loading} onClick={() => onPageChange(pageNumber)} className={`min-w-8 px-2 py-1.5 rounded-lg text-xs font-bold ${pageNumber === page ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600"}`}>{pageNumber}</button>)}
        <button type="button" disabled={loading || page === totalPages} onClick={() => onPageChange(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold disabled:opacity-40">Next</button>
      </div>
    </nav>
  );
};

export default Pagination;
