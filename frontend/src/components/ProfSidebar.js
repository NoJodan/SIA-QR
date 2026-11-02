import React, { useEffect, useRef, useState } from "react";

export default function ProfSidebar({ activeTab, onSelectTab, onLogout, onGoHome, user }) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const desktopProfileMenuRef = useRef(null);
  const mobileProfileMenuRef = useRef(null);
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Profesor";
  const email = user?.email || "";

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
  const isCoursesActive =
    activeTab === "mis-cursos" || activeTab === "curso-detalle" || activeTab === "clase-detalle";
  const profileMenu = isProfileMenuOpen && (
    <div className="app-sidebar__profile-menu" role="menu" aria-label="Menú de usuario">
      <div className="app-sidebar__profile-details">
        <span className="app-sidebar__profile-name">{fullName}</span>
        <span className="app-sidebar__profile-role">Profesor</span>
        {email && <span className="app-sidebar__profile-email">{email}</span>}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setIsProfileMenuOpen(false);
          onSelectTab && onSelectTab("configuraciones");
        }}
        className="app-sidebar__profile-menu-item"
      >
        <i className="fa-solid fa-gear" aria-hidden="true"></i>
        Configuraciones
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setIsProfileMenuOpen(false);
          onLogout();
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
            aria-label="Ir a Mis Cursos"
          >
            <i className="fa-solid fa-graduation-cap" aria-hidden="true"></i>
            <h1>SIA-QR</h1>
            <p>Sistema de Asistencia</p>
          </button>

          <nav className="app-sidebar__nav">
            <button
              onClick={() => onSelectTab && onSelectTab("mis-cursos")}
              className={`app-sidebar__item${isCoursesActive ? " app-sidebar__item--active" : ""}`}
            >
              <i className="fa-solid fa-book-open" aria-hidden="true"></i>
              Mis Cursos
            </button>
            <button
              onClick={() => onSelectTab && onSelectTab("resumen")}
              className={`app-sidebar__item${activeTab === "resumen" ? " app-sidebar__item--active" : ""}`}
            >
              <i className="fa-solid fa-chart-simple" aria-hidden="true"></i>
              Resumen
            </button>
            <button
              onClick={() => onSelectTab && onSelectTab("reportes")}
              className={`app-sidebar__item${activeTab === "reportes" ? " app-sidebar__item--active" : ""}`}
            >
              <i className="fa-solid fa-file-export" aria-hidden="true"></i>
              Reportes
            </button>
          </nav>
        </div>

        <div className="app-sidebar__account" ref={desktopProfileMenuRef}>
          {profileMenu}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            className="app-sidebar__account-button"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
          >
            <span className="app-sidebar__avatar" aria-hidden="true">
              <i className="fa-solid fa-user"></i>
            </span>
            <span className="app-sidebar__account-copy">
              <span className="app-sidebar__account-name">{fullName}</span>
              <span className="app-sidebar__account-role">Profesor</span>
            </span>
            <i className="fa-solid fa-chevron-down app-sidebar__account-chevron" aria-hidden="true"></i>
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
          aria-current={isCoursesActive ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            isCoursesActive ? "sidebar-active-item text-white" : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${isCoursesActive ? "bg-white/80" : "bg-transparent"}`}></span>
          <i className="fa-solid fa-book-open text-xl" aria-hidden="true"></i>
          <span className="truncate">Mis Cursos</span>
        </button>
        <button
          onClick={() => onSelectTab && onSelectTab("resumen")}
          aria-current={activeTab === "resumen" ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            activeTab === "resumen" ? "sidebar-active-item text-white" : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${activeTab === "resumen" ? "bg-white/80" : "bg-transparent"}`}></span>
          <i className="fa-solid fa-chart-simple text-xl" aria-hidden="true"></i>
          <span className="truncate">Resumen</span>
        </button>
        <button
          onClick={() => onSelectTab && onSelectTab("reportes")}
          aria-current={activeTab === "reportes" ? "page" : undefined}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-t-xl px-1 text-xs transition-colors ${
            activeTab === "reportes" ? "sidebar-active-item text-white" : "text-red-100/80 hover:text-white"
          }`}
        >
          <span className={`absolute inset-x-4 top-0 h-1 rounded-b-full ${activeTab === "reportes" ? "bg-white/80" : "bg-transparent"}`}></span>
          <i className="fa-solid fa-file-export text-xl" aria-hidden="true"></i>
          <span className="truncate">Reportes</span>
        </button>
        <div className="app-sidebar__mobile-account" ref={mobileProfileMenuRef}>
          {profileMenu}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            aria-label={`Menú de usuario: ${fullName}`}
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            className="app-sidebar__mobile-account-button"
          >
            <i className="fa-solid fa-user" aria-hidden="true"></i>
            <span>Perfil</span>
          </button>
        </div>
      </nav>
    </>
  );
}
