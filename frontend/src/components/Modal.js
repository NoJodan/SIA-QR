import React, { useEffect } from "react";

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white rounded-xl shadow-xl p-4 sm:p-5 transform transition-transform duration-200 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
