import React, { useState } from "react";
import Sidebar from "./Sidebar";
import AdminCursoDetalle from "../pages/AdminCursoDetalle";
import AdminCursos from "../pages/AdminCursos";
import Profesores from "../pages/Profesores";

export default function AdminLayout({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("profesores");
  const [selectedGroup, setSelectedGroup] = useState(null);

  const selectTab = (tab) => {
    setSelectedGroup(null);
    setActiveTab(tab);
  };

  return (
    <div className="fixed inset-0 flex h-dvh flex-col overflow-hidden bg-brand-lightBg md:flex-row">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={selectTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main className="min-h-0 min-w-0 w-full max-w-7xl flex-1 overflow-y-auto p-4 mx-auto md:p-8">
        {activeTab === "profesores" && <Profesores />}
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
