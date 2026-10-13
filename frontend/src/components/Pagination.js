import React from "react";

export default function Pagination({ page, totalPages, onChange, countLabel }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex justify-end items-center gap-2 mt-4">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Página anterior"
        className="px-3 py-1 text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
      >
        ←
      </button>
      <span className="text-sm text-slate-600" aria-live="polite">
        {page} / {totalPages}
        {countLabel ? ` · ${countLabel}` : null}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Página siguiente"
        className="px-3 py-1 text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
      >
        →
      </button>
    </div>
  );
}
