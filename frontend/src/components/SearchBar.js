import React, { useId } from "react";

export default function SearchBar({ value, onChange, placeholder = "Buscar...", id }) {
  const fallbackId = useId();
  const inputId = id || fallbackId;
  const hasValue = Boolean(value);
  return (
    <div className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <svg
          className="h-4 w-4 text-slate-400"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="9" r="6" />
          <line x1="14.5" y1="14.5" x2="18" y2="18" />
        </svg>
      </span>
      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 rounded-r-xl"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ×
          </span>
        </button>
      )}
    </div>
  );
}
