import React, { useEffect, useRef } from "react";

export default function Modal({ title, onClose, children, icon }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    window.addEventListener("keydown", onKey);
    // AutoFocus primer input: espera al montaje del panel
    const t = setTimeout(() => {
      const el =
        panelRef.current?.querySelector(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
        ) || null;
      if (el && typeof el.focus === "function") el.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      // Retorno foco al elemento que abrió el modal
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className="w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white rounded-2xl shadow-xl p-4 sm:p-6 transform transition-transform duration-200 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#B3200E]/10 text-[#B3200E]"
            >
              {icon || (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="14" height="13" rx="2" />
                  <line x1="3" y1="8" x2="17" y2="8" />
                  <line x1="7" y1="2" x2="7" y2="6" />
                  <line x1="13" y1="2" x2="13" y2="6" />
                </svg>
              )}
            </span>
            <h3 className="font-bold text-slate-800 truncate">{title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
