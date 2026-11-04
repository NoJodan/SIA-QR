import React, { useState } from "react";
import Sidebar from "./Sidebar";
import AdminCursoDetalle from "../pages/AdminCursoDetalle";
import AdminCursos from "../pages/AdminCursos";
import Estudiantes from "../pages/Estudiantes";
import Profesores from "../pages/Profesores";
import Reportes from "../pages/Reportes";
import AdminResumen from "../pages/AdminResumen";

export default function AdminLayout({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("resumen");
  const [selectedGroup, setSelectedGroup] = useState(null);

  const selectTab = (tab) => {
    setSelectedGroup(null);
    setActiveTab(tab);
  };

  const backgroundVariant = {
    profesores: "mis-cursos",
    estudiantes: "curso-detalle",
    cursos: "clase-detalle",
    "curso-detalle-admin": "clase-detalle",
    reportes: "reportes",
  }[activeTab];

  return (
    <div
      className={`fixed inset-0 flex h-dvh flex-col overflow-hidden professor-app-shell ${
        backgroundVariant ? `professor-app-shell--${backgroundVariant}` : ""
      } md:flex-row`}
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={selectTab}
        onLogout={onLogout}
        onGoHome={() => selectTab("resumen")}
        user={user}
      />
      <main className="min-h-0 min-w-0 w-full max-w-7xl flex-1 overflow-y-auto bg-transparent p-4 pb-24 mx-auto md:p-8 md:pb-8">
        {activeTab === "resumen" && <AdminResumen />}
        {activeTab === "profesores" && <Profesores />}
        {activeTab === "estudiantes" && <Estudiantes user={user} />}
        {activeTab === "reportes" && <Reportes isAdmin />}
        {activeTab === "cursos" && !selectedGroup && (
          <AdminCursos
            onSelectGroup={(g) => {
              setSelectedGroup(g);
              setActiveTab("curso-detalle-admin");
            }}
          />
        )}
        {activeTab === "curso-detalle-admin" && selectedGroup && (
          <AdminCursoDetalle group={selectedGroup} onBack={() => selectTab("cursos")} />
        )}
      </main>
    </div>
  );
}
