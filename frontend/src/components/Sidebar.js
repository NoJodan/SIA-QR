import React from "react";

export default function Sidebar({ activeTab, onSelectTab, onLogout, userEmail }) {
  const tabs = [
    { id: "profesores", label: "Profesores", icon: "fa-solid fa-chalkboard-user" },
    { id: "cursos", label: "Cursos", icon: "fa-regular fa-bookmark" },
  ];
  return (
    <aside className="w-full md:w-64 sidebar-gradient text-white flex-shrink-0 flex flex-col justify-between p-5 md:min-h-screen shadow-xl rounded-r-3xl z-10">
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
  );
}
