import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ensureCsrf } from "../services/api";
import { adminLogin } from "../services/auth";

export default function AdminLogin({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ensureCsrf().catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await ensureCsrf();
      const normalizedEmail = String(email || "")
        .trim()
        .toLowerCase();
      const data = await adminLogin(normalizedEmail, password);
      if (onSuccess) {
        onSuccess(data);
      } else {
        window.location.href = "/";
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 400 && err?.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        // Mensaje genérico: no revela si el fallo fue por email, password o rol.
        setError("Credenciales inválidas");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white p-5 sm:p-8 rounded-xl shadow-md border border-gray-100 flex flex-col items-center space-y-6">
        <h2 className="text-2xl font-bold text-gray-800">Acceso de administrador</h2>
        <p className="text-sm text-gray-600 text-center">
          Uso interno. Inicia sesión con tu correo y contraseña de administrador.
        </p>

        {error && (
          <div className="w-full p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B3200E]"
              placeholder="correo"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#B3200E]"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#B3200E] hover:bg-[#941B0B] disabled:opacity-60 text-white font-medium rounded-lg text-center shadow transition-colors"
          >
            {loading ? "Verificando..." : "Iniciar sesión"}
          </button>
        </form>

        <Link to="/" className="text-sm text-[#B3200E] hover:text-[#941B0B] hover:underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
