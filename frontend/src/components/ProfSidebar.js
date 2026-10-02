import React from "react";

export default function ProfSidebar({ activeTab, onSelectTab, onLogout, userEmail }) {
  const updatePointerPosition = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <>
      <aside
        onPointerMove={updatePointerPosition}
        className="hidden md:flex md:w-64 md:h-dvh sidebar-gradient sidebar-pointer-glow text-white flex-shrink-0 flex-col justify-between p-5 shadow-xl rounded-r-3xl z-10"
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
              onClick={() => onSelectTab && onSelectTab("reportes")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === "reportes"
                  ? "sidebar-active-item text-white shadow-sm"
                  : "sidebar-hover-item text-red-100 opacity-80 hover:opacity-100"
              }`}
            >
              <i className="fa-solid fa-file-export text-base w-5 text-center"></i>
              Reportes
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

      <nav
        onPointerMove={updatePointerPosition}
        aria-label="Navegación del profesor"
        className="fixed inset-x-0 bottom-0 z-40 flex min-h-[76px] items-stretch border-t border-red-200/20 sidebar-gradient sidebar-pointer-glow px-2 pt-2 pb-[env(safe-area-inset-bottom)] text-white shadow-xl md:hidden"
      >
        <button
          onClick={() => onSelectTab && onSelectTab("mis-cursos")}
          aria-current={activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle" ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle"
              ? "sidebar-active-item text-white"
              : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${
            activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle" ? "bg-white/80" : "bg-transparent"
          }`}></span>
          <i className="fa-solid fa-book-open text-xl" aria-hidden="true"></i>
          <span className="truncate">Mis Cursos</span>
        </button>
        <button
          onClick={() => onSelectTab && onSelectTab("reportes")}
          aria-current={activeTab === "reportes" ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            activeTab === "reportes"
              ? "sidebar-active-item text-white"
              : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${activeTab === "reportes" ? "bg-white/80" : "bg-transparent"}`}></span>
          <i className="fa-solid fa-file-export text-xl" aria-hidden="true"></i>
          <span className="truncate">Reportes</span>
        </button>
        <button
          onClick={() => onSelectTab && onSelectTab("configuraciones")}
          aria-current={activeTab === "configuraciones" ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            activeTab === "configuraciones"
              ? "sidebar-active-item text-white"
              : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${activeTab === "configuraciones" ? "bg-white/80" : "bg-transparent"}`}></span>
          <i className="fa-solid fa-gear text-xl" aria-hidden="true"></i>
          <span className="truncate">Configuraciones</span>
        </button>
        <button
          onClick={onLogout}
          className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs text-red-100/80 transition-colors hover:text-white"
        >
          <i className="fa-solid fa-arrow-right-from-bracket text-xl" aria-hidden="true"></i>
          <span>Salir</span>
        </button>
      </nav>
    </>
  );
}
