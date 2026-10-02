import React, { useEffect, useState, useCallback } from "react";
import api from "../services/api";

export default function Profesores() {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/auth/professors-whitelist/");
      setEmails(data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Error al cargar la lista");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const handleAddEmail = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setError("");
    try {
      await api.post("/api/auth/professors-whitelist/", { email: newEmail.trim() });

      setNewEmail("");
      loadEmails();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
  };

  const handleDeleteEmail = async (emailToDelete) => {
    if (!window.confirm(`¿Seguro que deseas revocar la autorización a ${emailToDelete}?`)) {
      return;
    }

    setError("");
    try {
      await api.delete("/api/auth/professors-whitelist/", { data: { email: emailToDelete } });

      loadEmails();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Lista Blanca de Profesores</h2>
        <p className="text-sm text-gray-500">
          Los usuarios con estos correos adquirirán automáticamente el rol de profesor al iniciar sesión.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleAddEmail} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          placeholder="correo.profesor@ut.edu.co"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="w-full min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          required
        />
        <button
          type="submit"
          className="w-full sm:w-auto px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white font-medium rounded-lg shadow-sm transition-colors"
        >
          Añadir Correo
        </button>
      </form>

      <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando profesores autorizados...</div>
        ) : emails.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay correos en la lista blanca todavía.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {emails.map((item) => (
              <li key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-all">{item.email}</p>
                  <p className="text-xs text-gray-400">
                    Autorizado el: {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  type="button"
                  title="Eliminar correo"
                  onClick={() => handleDeleteEmail(item.email)}
                  className="p-2 self-end sm:self-auto shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
