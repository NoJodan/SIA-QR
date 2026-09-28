import React from "react";

export default function ProfSidebar({ activeTab, onSelectTab, onLogout, userEmail }) {
  const updatePointerPosition = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <aside
      onPointerMove={updatePointerPosition}
      className="w-full h-auto min-h-0 md:w-64 md:h-dvh sidebar-gradient sidebar-pointer-glow text-white flex-shrink-0 flex flex-col justify-between p-4 md:p-5 shadow-xl rounded-b-3xl md:rounded-b-none md:rounded-r-3xl z-10"
    >
      <div className="space-y-6">
        <div className="mb-8 pt-2 px-1">
          <h1 className="text-xl font-bold tracking-tight text-white">SIA-QR Profesor</h1>
          <p className="text-xs text-red-200 opacity-80 mt-0.5 truncate">{userEmail}</p>
        </div>

        <nav className="space-y-2">
          <button
            onClick={() => onSelectTab && onSelectTab("mis-cursos")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle"
                ? "sidebar-active-item text-white shadow-sm"
                : "sidebar-hover-item text-red-100 opacity-80 hover:opacity-100"
            }`}
          >
            <i className="fa-solid fa-book-open text-base w-5 text-center"></i>
            Mis Cursos
          </button>
          <button
            onClick={() => onSelectTab && onSelectTab("configuraciones")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === "configuraciones"
                ? "sidebar-active-item text-white shadow-sm"
                : "sidebar-hover-item text-red-100 opacity-80 hover:opacity-100"
            }`}
          >
            <i className="fa-solid fa-gear text-base w-5 text-center"></i>
            Configuraciones
          </button>
        </nav>
      </div>

      <div className="pt-6 mt-auto border-t border-red-800/40">
        <button
          onClick={onLogout}
          className="w-full sidebar-hover-item flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-100 opacity-80 hover:opacity-100 transition-all"
        >
          <i className="fa-solid fa-arrow-right-from-bracket text-base w-5 text-center"></i>
          Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}
