import React from "react";

export default function ProfSidebar({ activeTab, onSelectTab, onLogout, userEmail }) {
  return (
    <aside className="w-64 bg-gray-900 text-gray-200 flex flex-col justify-between min-h-screen p-4">
      <div className="space-y-6">
        <div className="px-2">
          <h1 className="text-xl font-bold tracking-tight text-white">SIA-QR Profesor</h1>
          <p className="text-xs text-gray-400 truncate mt-1">{userEmail}</p>
        </div>

        <nav className="space-y-1">
          <button
            onClick={() => onSelectTab && onSelectTab("mis-cursos")}
            className={`w-full text-left px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            Mis Cursos
          </button>
          <button
            onClick={() => onSelectTab && onSelectTab("configuraciones")}
            className={`w-full text-left px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeTab === "configuraciones"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            Configuraciones
          </button>
        </nav>
      </div>

      <div className="pt-4 border-t border-gray-800">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center px-3 py-2 text-sm font-medium rounded-lg text-red-300 hover:bg-red-950/40 hover:text-red-200 transition-colors"
        >
          Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}
