import React, { useState } from "react";

export default function CourseForm({ initialName = "", submitLabel = "Guardar", onSubmit, onCancel }) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (clean.length > 150) {
      setError("Máximo 150 caracteres.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSubmit(clean);
    } catch (err) {
      const data = err?.response?.data;
      setError((data && (data.name?.[0] || data.detail)) || "No se pudo guardar el curso.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
      <input
        type="text"
        placeholder="Nombre del curso"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm"
        maxLength={150}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {saving ? "Guardando..." : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
