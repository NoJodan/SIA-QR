import React, { useState } from "react";
import api from "../services/api";

export default function ProfConfiguraciones({ user, onSaved }) {
  const [employeeCode, setEmployeeCode] = useState(user?.employee_code || "");
  const [department, setDepartment] = useState(user?.department || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = employeeCode !== (user?.employee_code || "") || department !== (user?.department || "");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const { data } = await api.patch("/api/auth/me/", {
        employee_code: employeeCode.trim(),
        department: department.trim(),
      });
      void data;

      setSaved(true);
      if (onSaved) onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Configuraciones del Profesor</h2>
        <p className="text-sm text-gray-500 mt-1">Información de tu perfil y cuenta académica.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-base font-semibold text-gray-800">Datos Personales</h3>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Nombre
            </label>
            <p className="text-sm font-medium text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              {user?.first_name || "—"}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Apellido
            </label>
            <p className="text-sm font-medium text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              {user?.last_name || "—"}
            </p>
          </div>

          <div>
            <label
              htmlFor="employee_code"
              className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1"
            >
              Código de Empleado
            </label>
            <input
              id="employee_code"
              type="text"
              value={employeeCode}
              maxLength={50}
              onChange={(e) => setEmployeeCode(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="PROV-60467E"
            />
          </div>

          <div>
            <label
              htmlFor="department"
              className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1"
            >
              Departamento
            </label>
            <input
              id="department"
              type="text"
              value={department}
              maxLength={100}
              onChange={(e) => setDepartment(e.target.value)}
              className={inputClass}
              placeholder="No asignado"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Correo Institucional
            </label>
            <p className="text-sm font-medium text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
              {user?.email || "—"}
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition-colors"
          >
            {saving ? "Guardando..." : "Guardar Cambios"}
          </button>

          {saved && !error && <span className="text-sm text-green-700">Cambios guardados.</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      </form>
    </div>
  );
}
