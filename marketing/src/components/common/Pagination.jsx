import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const Pagination = ({ page, limit, total, onPageChange }) => {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--mp-line)]">
      <p className="text-xs text-[var(--mp-muted)]">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--mp-line)] text-[var(--mp-ink-2)] disabled:opacity-40 hover:bg-[var(--mp-brand-light)] hover:border-brand-300 transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="px-3 text-sm font-medium text-[var(--mp-ink)]">{page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--mp-line)] text-[var(--mp-ink-2)] disabled:opacity-40 hover:bg-[var(--mp-brand-light)] hover:border-brand-300 transition-colors"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
