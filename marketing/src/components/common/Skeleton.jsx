import React from "react";

/** Skeleton loading placeholder */
export const Skeleton = ({ className = "" }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

/** Card stat skeleton */
export const StatCardSkeleton = () => (
  <div className="bg-white rounded-2xl border border-[var(--mp-line)] p-5">
    <Skeleton className="h-3 w-20 mb-3" />
    <Skeleton className="h-8 w-16 mb-2" />
    <Skeleton className="h-3 w-24" />
  </div>
);

/** Table row skeleton */
export const TableRowSkeleton = ({ cols = 5 }) => (
  <tr>
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="px-4 py-3">
        <Skeleton className="h-4 w-full" />
      </td>
    ))}
  </tr>
);

export default Skeleton;
