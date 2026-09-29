import React from "react";
import { Link } from "react-router-dom";
import { API_BASE, googleLoginUrl } from "../services/api";

export default function Login() {
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  const next = urlParams.get("next");

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="relative max-w-md w-full bg-white p-8 rounded-xl shadow-md border border-gray-100 flex flex-col items-center space-y-6">
        <h2 className="text-2xl font-bold text-gray-800">SIA-QR Login</h2>
        <p className="text-sm text-gray-600 text-center">
          Accede únicamente con tu cuenta de correo institucional (@ut.edu.co).
        </p>

        {error === "domain_not_allowed" && (
          <div className="w-full p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
            Error: Solo se permiten correos del dominio institucional autorizado.
          </div>
        )}

        <a
          href={googleLoginUrl(next || undefined)}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-center shadow transition-colors"
        >
          Iniciar sesión con Google Institucional
        </a>
        <p className="text-xs text-gray-400">{API_BASE}</p>
      </div>

      <Link
        to="/admin-login"
        aria-label="Acceso de administrador"
        className="absolute bottom-2 right-4 p-2 text-[11px] text-gray-300 hover:text-gray-500 focus-visible:text-gray-500 hover:underline"
      >
        Administrador
      </Link>
    </div>
  );
}
