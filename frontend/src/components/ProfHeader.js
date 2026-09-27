import React from "react";

export default function ProfHeader({ title, subtitle, onBack }) {
  return (
    <div className="mb-6">
      {onBack && (
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 mb-2">
          ← Volver
        </button>
      )}
      <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}
