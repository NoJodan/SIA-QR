import React from "react";

export default function Sidebar({ activeTab, onSelectTab, onLogout, userEmail }) {
  const tabs = [
    { id: "profesores", label: "Profesores", icon: "fa-solid fa-chalkboard-user" },
    { id: "cursos", label: "Cursos", icon: "fa-regular fa-bookmark" },
    { id: "reportes", label: "Reportes", icon: "fa-solid fa-file-export" },
  ];

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
            <h1 className="text-xl font-bold tracking-tight text-white">SIA-QR Admin</h1>
            <p className="text-xs text-red-200 opacity-80 mt-0.5 truncate">{userEmail}</p>
          </div>

          <nav className="space-y-2">
            {tabs.map((t) => {
              const isActive =
                activeTab === t.id || (t.id === "cursos" && activeTab === "curso-detalle-admin");

              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTab && onSelectTab(t.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? "sidebar-active-item text-white shadow-sm"
                      : "sidebar-hover-item text-red-100 opacity-80 hover:opacity-100"
                  }`}
                >
                  <i className={`${t.icon} text-base w-5 text-center`}></i>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-6 mt-auto border-t border-red-800/40">
          <button
            onClick={onLogout}
            className="w-full sidebar-hover-item flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-100 opacity-80 hover:opacity-100 transition-all"
          >
            <i className="fa-solid fa-arrow-right-from-bracket text-base w-5 text-center"></i>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      <nav
        onPointerMove={updatePointerPosition}
        aria-label="Navegación de administración"
        className="fixed inset-x-0 bottom-0 z-40 flex min-h-[76px] items-stretch border-t border-red-200/20 sidebar-gradient sidebar-pointer-glow px-2 pt-2 pb-[env(safe-area-inset-bottom)] text-white shadow-xl md:hidden"
      >
        {tabs.map((t) => {
          const isActive =
            activeTab === t.id || (t.id === "cursos" && activeTab === "curso-detalle-admin");

          return (
            <button
              key={t.id}
              onClick={() => onSelectTab && onSelectTab(t.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
                isActive ? "sidebar-active-item text-white" : "text-red-100/80 hover:text-white"
              }`}
            >
              <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${isActive ? "bg-white/80" : "bg-transparent"}`}></span>
              <i className={`${t.icon} text-xl`} aria-hidden="true"></i>
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
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
