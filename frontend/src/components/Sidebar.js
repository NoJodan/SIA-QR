import React, { useEffect, useRef, useState } from "react";

export default function Sidebar({ activeTab, onSelectTab, onLogout, onGoHome, user }) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const desktopProfileMenuRef = useRef(null);
  const mobileProfileMenuRef = useRef(null);
  const email = user?.email || "";
  const tabs = [
    { id: "profesores", label: "Profesores", icon: "fa-solid fa-chalkboard-user" },
    { id: "estudiantes", label: "Estudiantes", icon: "fa-solid fa-user-graduate" },
    { id: "cursos", label: "Cursos", icon: "fa-regular fa-bookmark" },
    { id: "resumen", label: "Resumen", icon: "fa-solid fa-chart-simple" },
    { id: "reportes", label: "Reportes", icon: "fa-solid fa-file-export" },
  ];

  useEffect(() => {
    if (!isProfileMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      const inDesktopMenu = desktopProfileMenuRef.current?.contains(event.target);
      const inMobileMenu = mobileProfileMenuRef.current?.contains(event.target);
      if (!inDesktopMenu && !inMobileMenu) setIsProfileMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const updatePointerPosition = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };

  const profileMenu = isProfileMenuOpen && (
    <div className="app-sidebar__profile-menu" role="menu" aria-label="Menú de administrador">
      <div className="app-sidebar__profile-details">
        <span className="app-sidebar__profile-name">ADMIN</span>
        <span className="app-sidebar__profile-role">Administrador</span>
        {email && (
          <span className="app-sidebar__profile-email">
            <i className="fa-solid fa-envelope mr-1.5" aria-hidden="true" />
            {email}
          </span>
        )}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setIsProfileMenuOpen(false);
          onLogout && onLogout();
        }}
        className="app-sidebar__profile-menu-item"
      >
        <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
        Cerrar Sesión
      </button>
    </div>
  );

  return (
    <>
      <aside
        onPointerMove={updatePointerPosition}
        className="hidden md:flex md:w-64 md:h-dvh app-sidebar text-white flex-shrink-0 flex-col justify-between p-3 z-10"
      >
        <span className="app-sidebar__motion-gradient" aria-hidden="true"></span>
        <div className="app-sidebar__top">
          <button
            type="button"
            className="app-sidebar__brand"
            onClick={onGoHome}
            aria-label="Ir al resumen principal"
          >
            <i className="fa-solid fa-graduation-cap" aria-hidden="true"></i>
            <h1>SIA-QR</h1>
            <p>Sistema de Asistencia</p>
          </button>

          <nav className="app-sidebar__nav">
            {tabs.map((t) => {
              const isActive =
                activeTab === t.id || (t.id === "cursos" && activeTab === "curso-detalle-admin");

              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTab && onSelectTab(t.id)}
                  className={`app-sidebar__item ${
                    isActive
                      ? "app-sidebar__item--active"
                      : ""
                  }`}
                >
                  <i className={t.icon} aria-hidden="true"></i>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="app-sidebar__account" ref={desktopProfileMenuRef}>
          {profileMenu}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            className="app-sidebar__account-button"
            aria-label="Abrir menú de administrador"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
          >
            <span className="app-sidebar__avatar" aria-hidden="true">
              <i className="fa-solid fa-user"></i>
            </span>
            <span className="app-sidebar__account-copy">
              <span className="app-sidebar__account-name">ADMIN</span>
              <span className="app-sidebar__account-role">Administrador</span>
            </span>
            <i className="fa-solid fa-chevron-down app-sidebar__account-chevron" aria-hidden="true"></i>
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
        <div className="app-sidebar__mobile-account" ref={mobileProfileMenuRef}>
          {profileMenu}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            aria-label="Menú de administrador"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            className="app-sidebar__mobile-account-button"
          >
            <i className="fa-solid fa-user" aria-hidden="true"></i>
            <span>ADMIN</span>
          </button>
        </div>
      </nav>
    </>
  );
}
